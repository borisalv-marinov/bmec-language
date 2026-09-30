import type { CoreExpr, CoreFunction, CoreStatement } from "../core/analysis.js";
import type { TypeRef } from "../types/type-ref.js";

interface SafeArray extends Array<SafeValue> {}
interface SafeObject { [key: string]: SafeValue }
type SafeValue = null | boolean | number | bigint | string | SafeArray | SafeObject;
type Environment = Map<string, SafeValue>;
type Budget = { steps: number; depth: number };

const MAX_STEPS = 20_000;
const MAX_DEPTH = 32;
const MAX_LIST_ITEMS = 1_000;
const MAX_STRING_LENGTH = 50_000;
const MAX_ARGUMENT_NODES = 5_000;
const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;
const fail = (message: string): never => { throw new Error(message); };

function integer(value: bigint): bigint {
  if (value < INT_MIN || value > INT_MAX) fail("Integer overflow (BMEC integers are signed 64-bit values).");
  return value;
}

function equal(left: SafeValue, right: SafeValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]!));
  return false;
}

function step(budget: Budget): void {
  budget.steps += 1;
  if (budget.steps > MAX_STEPS) fail("The program reached the 20,000-step limit.");
}

function valueOf(expression: CoreExpr, env: Environment, functions: Map<string, CoreFunction>, budget: Budget): SafeValue {
  step(budget);
  switch (expression.kind) {
    case "literal":
      if (expression.typeRef.kind === "primitive" && expression.typeRef.name === "integer") {
        const raw = expression.value;
        if (typeof raw === "string") return integer(BigInt(raw));
        if (typeof raw === "number") return integer(BigInt(raw));
        return fail("The integer literal is not supported by the playground.");
      }
      if (typeof expression.value === "string" || typeof expression.value === "number" || typeof expression.value === "boolean") return expression.value;
      return fail("This literal type is not supported by the playground.");
    case "none": return null;
    case "identifier": {
      const name = expression.name;
      if (!name) return fail("The selected function contains an unnamed value.");
      if (!env.has(name)) return fail(`Unknown value "${name}" in the selected function.`);
      return env.get(name)!;
    }
    case "list": {
      const elements = expression.elements ?? [];
      if (elements.length > MAX_LIST_ITEMS) fail("The playground limits lists to 1,000 items.");
      return elements.map(item => valueOf(item, env, functions, budget));
    }
    case "unary": {
      const value = valueOf(expression.operand!, env, functions, budget);
      if (expression.operator === "not" && typeof value === "boolean") return !value;
      if (expression.operator === "-" && typeof value === "bigint") return integer(-value);
      if (expression.operator === "-" && typeof value === "number" && Number.isFinite(value)) return -value;
      if (expression.operator === "+" && (typeof value === "bigint" || typeof value === "number")) return value;
      return fail(`Unary operator "${expression.operator ?? "?"}" is not supported for this value.`);
    }
    case "binary": {
      const operator = expression.operator;
      const left = valueOf(expression.left!, env, functions, budget);
      if (operator === "and" && typeof left === "boolean" && !left) return false;
      if (operator === "or" && typeof left === "boolean" && left) return true;
      const right = valueOf(expression.right!, env, functions, budget);
      if (operator === "and" && typeof left === "boolean" && typeof right === "boolean") return left && right;
      if (operator === "or" && typeof left === "boolean" && typeof right === "boolean") return left || right;
      if (operator === "==") return equal(left, right);
      if (operator === "!=") return !equal(left, right);
      if (typeof left === "string" && typeof right === "string") {
        if (operator === "+") {
          if (left.length + right.length > MAX_STRING_LENGTH) fail("The playground limits text values to 50,000 characters.");
          return left + right;
        }
        if (operator === "<") return left < right;
        if (operator === "<=") return left <= right;
        if (operator === ">") return left > right;
        if (operator === ">=") return left >= right;
      }
      if (typeof left === "bigint" && typeof right === "bigint") {
        if ((operator === "/" || operator === "%") && right === 0n) fail("Division by zero.");
        switch (operator) {
          case "+": return integer(left + right);
          case "-": return integer(left - right);
          case "*": return integer(left * right);
          case "/": return integer(left / right);
          case "%": return integer(left % right);
          case "<": return left < right;
          case "<=": return left <= right;
          case ">": return left > right;
          case ">=": return left >= right;
        }
      }
      if (typeof left === "number" && typeof right === "number") {
        if ((operator === "/" || operator === "%") && right === 0) fail("Division by zero.");
        const result = operator === "+" ? left + right : operator === "-" ? left - right : operator === "*" ? left * right : operator === "/" ? left / right : operator === "%" ? left % right : undefined;
        if (result !== undefined) {
          if (!Number.isFinite(result)) fail("The numeric result is not finite.");
          return result;
        }
        if (operator === "<") return left < right;
        if (operator === "<=") return left <= right;
        if (operator === ">") return left > right;
        if (operator === ">=") return left >= right;
      }
      if (Array.isArray(left) && Array.isArray(right) && operator === "+") {
        if (left.length + right.length > MAX_LIST_ITEMS) fail("The playground limits lists to 1,000 items.");
        return [...left, ...right];
      }
      return fail(`Operator "${operator ?? "?"}" is not supported for these values.`);
    }
    case "index": {
      const object = valueOf(expression.object!, env, functions, budget);
      const index = valueOf(expression.index!, env, functions, budget);
      if (!Array.isArray(object)) return fail("The playground can index lists only.");
      if (typeof index !== "bigint" || index < 0n || index > BigInt(Number.MAX_SAFE_INTEGER)) return fail("The playground supports indexing lists with a non-negative integer.");
      const result = object[Number(index)];
      if (result === undefined) fail("List index is out of range.");
      return result;
    }
    case "call": {
      const name = expression.callee ?? "";
      const args = (expression.args ?? []).map(item => valueOf(item, env, functions, budget));
      const target = functions.get(expression.calleeId ?? name) ?? functions.get(name);
      if (target) return invoke(target, args, functions, budget);
      return pureBuiltin(name, args);
    }
    default: return fail(`The playground cannot run ${expression.kind} expressions yet. Try a pure function using values, arithmetic, lists, and conditions.`);
  }
}

function pureBuiltin(name: string, args: SafeValue[]): SafeValue {
  if (name === "length" && args.length === 1 && (typeof args[0] === "string" || Array.isArray(args[0]))) return BigInt(args[0].length);
  if (name === "uppercase" && args.length === 1 && typeof args[0] === "string") return checkedText(args[0].toUpperCase());
  if (name === "lowercase" && args.length === 1 && typeof args[0] === "string") return checkedText(args[0].toLowerCase());
  if (name === "trim" && args.length === 1 && typeof args[0] === "string") return checkedText(args[0].trim());
  if (name === "absInt" && args.length === 1 && typeof args[0] === "bigint") return integer(args[0] < 0n ? -args[0] : args[0]);
  if ((name === "minInt" || name === "maxInt") && args.length === 2 && typeof args[0] === "bigint" && typeof args[1] === "bigint") return name === "minInt" ? (args[0] < args[1] ? args[0] : args[1]) : (args[0] > args[1] ? args[0] : args[1]);
  if (name === "range" && args.length === 2 && typeof args[0] === "bigint" && typeof args[1] === "bigint") {
    const start = args[0] as bigint, end = args[1] as bigint;
    const size = end - start;
    if (size < 0n || size > 1_000n) fail("The playground limits range() to 1,000 items.");
    return Array.from({ length: Number(size) }, (_, index) => integer(start + BigInt(index)));
  }
  return fail(`The playground does not run "${name}" here. Only listed pure functions are available; host and capability functions stay off.`);
}

function checkedText(value: string): string {
  if (value.length > MAX_STRING_LENGTH) fail("The playground limits text values to 50,000 characters.");
  return value;
}

function checkedArgument(value: unknown, state: { nodes: number }, depth = 0): SafeValue {
  if (depth > MAX_DEPTH) fail("The playground limits argument nesting to 32 levels.");
  if (++state.nodes > MAX_ARGUMENT_NODES) fail("The playground limits JSON arguments to 5,000 values.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return checkedText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Number arguments must be finite numbers.");
    return value;
  }
  if (typeof value === "bigint") return integer(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST_ITEMS) fail("The playground limits lists to 1,000 items.");
    return value.map(item => checkedArgument(item, state, depth + 1));
  }
  return fail("The playground accepts JSON values only; object arguments are not available here.");
}

function runStatements(body: CoreStatement[], env: Environment, functions: Map<string, CoreFunction>, budget: Budget): { returned: boolean; value?: SafeValue; control?: "break" | "continue" } {
  for (const statement of body) {
    step(budget);
    switch (statement.kind) {
      case "let": env.set(statement.name, valueOf(statement.value, env, functions, budget)); break;
      case "assign": env.set(statement.name, valueOf(statement.value, env, functions, budget)); break;
      case "return": return { returned: true, value: valueOf(statement.value, env, functions, budget) };
      case "if": {
        const condition = valueOf(statement.condition, env, functions, budget);
        if (typeof condition !== "boolean") fail("An if condition must be true or false.");
        const branch = condition ? statement.thenBody : statement.elseBody ?? [];
        const result = runStatements(branch, new Map(env), functions, budget);
        if (result.returned || result.control) return result;
        break;
      }
      case "for": {
        const items = valueOf(statement.iterable, env, functions, budget);
        if (!Array.isArray(items)) return fail("The playground's for loop needs a list.");
        if (items.length > 1_000) fail("The playground limits a loop to 1,000 items.");
        for (const item of items) {
          const loopEnv = new Map(env); loopEnv.set(statement.name, item);
          const result = runStatements(statement.body, loopEnv, functions, budget);
          if (result.returned) return result;
          if (result.control === "break") break;
        }
        break;
      }
      case "repeat": {
        const count = valueOf(statement.count, env, functions, budget);
        if (typeof count !== "bigint") return fail("The playground repeat count must be an integer.");
        if (count < 0n || count > 1_000n) return fail("The playground limits repeat to 1,000 iterations.");
        for (let index = 0n; index < count; index += 1n) {
          const result = runStatements(statement.body, new Map(env), functions, budget);
          if (result.returned) return result;
          if (result.control === "break") break;
        }
        break;
      }
      case "while": {
        let loops = 0;
        while (true) {
          const condition = valueOf(statement.condition, env, functions, budget);
          if (typeof condition !== "boolean") fail("A while condition must be true or false.");
          if (!condition) break;
          if (++loops > 1_000) fail("The playground limits a loop to 1,000 iterations.");
          const result = runStatements(statement.body, env, functions, budget);
          if (result.returned) return result;
          if (result.control === "break") break;
        }
        break;
      }
      case "break": return { returned: false, control: "break" };
      case "continue": return { returned: false, control: "continue" };
      default: return fail(`The playground cannot run ${statement.kind} statements because they may need host capabilities.`);
    }
  }
  return { returned: false };
}

function invoke(fn: CoreFunction, args: SafeValue[], functions: Map<string, CoreFunction>, budget: Budget): SafeValue {
  if (fn.async) fail("Async functions are not available in the local playground runner.");
  if (fn.parameters.some(parameter => parameter.typeRef.kind === "capability") || fn.constraints?.length || fn.typeParameters?.length) fail("This function needs capabilities or generic constraints that the local runner does not provide.");
  if (args.length !== fn.parameters.length) fail(`Function ${fn.name} needs ${fn.parameters.length} argument(s).`);
  if (++budget.depth > MAX_DEPTH) fail("The program reached the 32-call depth limit.");
  try {
    const env = new Map<string, SafeValue>();
    fn.parameters.forEach((parameter, index) => env.set(parameter.name, coerceArgument(args[index], parameter.typeRef)));
    const result = runStatements(fn.body, env, functions, budget);
    if (!result.returned) fail(`Function ${fn.name} did not return a value.`);
    return result.value ?? null;
  } finally { budget.depth -= 1; }
}

function coerceArgument(value: SafeValue, type: TypeRef): SafeValue {
  if (type.kind === "primitive" && type.name === "integer") {
    if (typeof value === "bigint") return integer(value);
    if (typeof value === "number" && Number.isSafeInteger(value)) return integer(BigInt(value));
    return fail("Integer arguments must be safe whole numbers.");
  }
  if (type.kind === "primitive" && type.name === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return fail("Number arguments must be finite numbers.");
  }
  if (type.kind === "primitive" && type.name === "text" && typeof value === "string") return checkedText(value);
  if (type.kind === "primitive" && type.name === "boolean" && typeof value === "boolean") return value;
  if (type.kind === "list" && Array.isArray(value)) {
    if (value.length > MAX_LIST_ITEMS) fail("The playground limits lists to 1,000 items.");
    return value.map(item => coerceArgument(item, type.element));
  }
  return fail(`The playground runner does not accept ${type.kind === "primitive" ? type.name : type.kind} arguments yet.`);
}

export function runPureFunction(functions: CoreFunction[], functionName: string, rawArguments: unknown[]): SafeValue {
  if (!Array.isArray(rawArguments) || rawArguments.length > 16) fail("Supply a JSON array with no more than 16 arguments.");
  const argumentState = { nodes: 0 };
  const args = rawArguments.map(value => checkedArgument(value, argumentState));
  const indexed = new Map<string, CoreFunction>();
  for (const fn of functions) { indexed.set(fn.id, fn); indexed.set(fn.name, fn); }
  const target = indexed.get(functionName);
  if (!target) fail(`Function "${functionName}" is not declared in this source.`);
  return invoke(target!, args, indexed, { steps: 0, depth: 0 });
}
