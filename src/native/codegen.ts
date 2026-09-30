import type { CoreExpr, CoreFunction, CoreStatement } from "../core/analysis.js";
import type { ProjectIR } from "../ir/ir.js";
import { isSameType, type TypeRef } from "../types/type-ref.js";
import { nativeJsonRuntime } from "./json-runtime.js";
import { nativeMoneyRuntime } from "./money-runtime.js";
import { nativeRyuRuntime } from "./ryu-runtime.js";

export class NativeLoweringError extends Error {
  readonly code = "PIPE-NATIVE-001";
  constructor(message: string) {
    super(message);
    this.name = "NativeLoweringError";
  }
}

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const nativeMapTypes = [
  { name: "integer", cType: "int64_t" },
  { name: "number", cType: "double" },
  { name: "boolean", cType: "bool" },
  { name: "text", cType: "bmec_text" },
] as const;

const nativeJsonListEncoders = [
  { name: "integer", listType: "bmec_integer_list", encode: "bmec_json_encode_integer" },
  { name: "number", listType: "bmec_number_list", encode: "bmec_json_encode_number" },
  { name: "boolean", listType: "bmec_boolean_list", encode: "bmec_json_encode_boolean" },
  { name: "text", listType: "bmec_text_list", encode: "bmec_json_encode_text" },
].map(({ name, listType, encode }) => `static bmec_text bmec_json_encode_${name}_list(${listType} input) { static const unsigned char prefix[] = "{\\\"version\\\":1,\\\"kind\\\":\\\"list\\\",\\\"elementType\\\":{\\\"kind\\\":\\\"primitive\\\",\\\"name\\\":\\\"${name}\\\"},\\\"items\\\":["; size_t prefix_length = sizeof(prefix) - 1; if (input.length > SIZE_MAX / sizeof(bmec_text)) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); bmec_text *items = input.length ? (bmec_text *)bmec_arena_alloc(input.length * sizeof(bmec_text)) : NULL; size_t total = prefix_length + 2; for (size_t i = 0; i < input.length; ++i) { items[i] = ${encode}(input.data[i]); size_t extra = items[i].length + (i ? 1 : 0); if (extra > SIZE_MAX - total) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); total += extra; } unsigned char *output = (unsigned char *)bmec_arena_alloc(total); size_t at = 0; memcpy(output + at, prefix, prefix_length); at += prefix_length; for (size_t i = 0; i < input.length; ++i) { if (i) output[at++] = ','; memcpy(output + at, items[i].data, items[i].length); at += items[i].length; } output[at++] = ']'; output[at++] = '}'; return (bmec_text){ output, at }; }`);

function nativeMapHelper(input: (typeof nativeMapTypes)[number], output: (typeof nativeMapTypes)[number]): string {
  const name = input.name === output.name ? `bmec_${input.name}_map` : `bmec_${input.name}_to_${output.name}_map`;
  return `static bmec_${output.name}_list ${name}(bmec_${input.name}_list input, ${output.cType} (*transform)(${input.cType})) { if (!input.length) return (bmec_${output.name}_list){ NULL, 0 }; if (input.length > SIZE_MAX / sizeof(${output.cType})) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); ${output.cType} *items = (${output.cType} *)bmec_arena_alloc(input.length * sizeof(${output.cType})); for (size_t i = 0; i < input.length; ++i) items[i] = transform(input.data[i]); return (bmec_${output.name}_list){ items, input.length }; }`;
}

function cName(prefix: string, identity: string): string {
  const bytes = new TextEncoder().encode(identity);
  return `${prefix}_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function cStringLiteral(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `"${[...bytes].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("")}"`;
}

function typeName(type: TypeRef, owner: string): string {
  if (type.kind === "primitive" && type.name === "integer") return "int64_t";
  if (type.kind === "primitive" && type.name === "boolean") return "bool";
  if (type.kind === "primitive" && type.name === "number") return "double";
  if (type.kind === "primitive" && type.name === "money") return "bmec_money";
  if (type.kind === "primitive" && type.name === "text") return "bmec_text";
  if (type.kind === "list" && type.element.kind === "primitive") {
    if (type.element.name === "text") return "bmec_text_list";
    if (type.element.name === "integer") return "bmec_integer_list";
    if (type.element.name === "number") return "bmec_number_list";
    if (type.element.name === "boolean") return "bmec_boolean_list";
  }
  if (type.kind === "capability" && type.name === "filesystem") return "bmec_filesystem";
  if (type.kind === "record") return cName("bmec_record", type.symbol);
  if (type.kind === "enum") return cName("bmec_enum", type.symbol);
  if (type.kind === "optional") return cName("bmec_optional", JSON.stringify(type));
  if (type.kind === "result") return cName("bmec_result_type", JSON.stringify(type));
  throw new NativeLoweringError(
    `Native primitive slice does not support ${type.kind === "primitive" ? type.name : type.kind} in ${owner}`,
  );
}

function functionForCalls(ir: ProjectIR, entry: CoreFunction): CoreFunction[] {
  const byId = new Map(ir.functions.map((fn) => [String(fn.id), fn]));
  const selected = new Map<string, CoreFunction>();
  const visitExpr = (expr: CoreExpr, owner: CoreFunction) => {
    if (expr.kind === "call") {
      if (["some", "isSome", "isNone", "ok", "err", "isOk", "isErr", "length", "textLength", "textContains", "textIndexOf", "startsWith", "endsWith", "substring", "split", "join", "map", "filter", "fold", "sort", "encodeJson", "decodeJson", "base64Encode", "base64Decode", "readTextFile", "writeTextFile"].includes(expr.callee ?? "")) {
        for (const arg of expr.args ?? []) visitExpr(arg, owner);
        return;
      }
      const identity = expr.implementationFunctionId ?? expr.calleeId;
      if (!identity)
        throw new NativeLoweringError(
          `Native primitive slice supports only direct BMEC calls in ${owner.id}; found ${expr.callee ?? "indirect call"}`,
        );
      const target = byId.get(String(identity));
      if (!target)
        throw new NativeLoweringError(
          `Native lowering could not resolve canonical function ${identity} from ${owner.id}`,
        );
      visitFunction(target);
      for (const arg of expr.args ?? []) visitExpr(arg, owner);
      return;
    }
    for (const value of [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee])
      if (value) visitExpr(value, owner);
    for (const value of expr.args ?? []) visitExpr(value, owner);
    for (const value of expr.elements ?? []) visitExpr(value, owner);
    for (const value of expr.fields ?? []) visitExpr(value.value, owner);
    for (const arm of expr.arms ?? []) visitExpr(arm.value, owner);
    if (expr.kind === "lambda") {
      if (!expr.lambda) throw new NativeLoweringError(`Native lambda has no typed function body in ${owner.id}`);
      if ((expr.captures?.length ?? 0) || (expr.lambda.captures?.length ?? 0))
        throw new NativeLoweringError(`Native primitive slice does not support captured closures in ${owner.id}`);
      visitFunction(expr.lambda);
      return;
    }
  };
  const visitStatements = (statements: CoreStatement[], owner: CoreFunction) => {
    for (const statement of statements) {
      if (statement.kind === "let" || statement.kind === "assign" || statement.kind === "return")
        visitExpr(statement.value, owner);
      else if (statement.kind === "expect") {
        visitExpr(statement.actual, owner);
        visitExpr(statement.expected, owner);
      } else if (statement.kind === "if") {
        visitExpr(statement.condition, owner);
        visitStatements(statement.thenBody, owner);
        if (statement.elseBody) visitStatements(statement.elseBody, owner);
      } else if (statement.kind === "for") {
        visitExpr(statement.iterable, owner);
        visitStatements(statement.body, owner);
      } else if (statement.kind === "while") {
        visitExpr(statement.condition, owner);
        visitStatements(statement.body, owner);
      } else if (statement.kind === "repeat") {
        visitExpr(statement.count, owner);
        visitStatements(statement.body, owner);
      }
    }
  };
  const visitFunction = (fn: CoreFunction) => {
    const key = String(fn.id);
    if (selected.has(key)) return;
    selected.set(key, fn);
    if (fn.async) throw new NativeLoweringError(`Native primitive slice does not support async function ${fn.id}`);
    if (fn.typeParameters?.length)
      throw new NativeLoweringError(`Native primitive slice requires a concrete specialization for ${fn.id}`);
    if (fn.parameters.some((parameter) => parameter.typeRef.kind === "model") || fn.returnTypeRef.kind === "model")
      throw new NativeLoweringError(`Native model values are not supported in ${fn.id}`);
    for (const parameter of fn.parameters) typeName(parameter.typeRef, String(fn.id));
    typeName(fn.returnTypeRef, String(fn.id));
    visitStatements(fn.body, fn);
  };
  visitFunction(entry);
  return [...selected.values()];
}

function localIdentity(functionId: string, ordinal: number): string {
  return `${functionId}:local:${ordinal}`;
}

function alwaysReturns(statements: CoreStatement[]): boolean {
  for (const statement of statements) {
    if (statement.kind === "return") return true;
    if (
      statement.kind === "if" &&
      statement.elseBody &&
      alwaysReturns(statement.thenBody) &&
      alwaysReturns(statement.elseBody)
    )
      return true;
  }
  return false;
}

function nativeSafePrimitiveCondition(expr: CoreExpr): boolean {
  const supportedPrimitive = (type: TypeRef) =>
    type.kind === "primitive" && ["integer", "number", "boolean", "text", "money"].includes(type.name);
  if (expr.kind === "literal" || expr.kind === "identifier") return supportedPrimitive(expr.typeRef);
  if (expr.kind === "unary")
    return expr.operator === "not" && expr.typeRef.kind === "primitive" && expr.typeRef.name === "boolean" &&
      Boolean(expr.operand && nativeSafePrimitiveCondition(expr.operand));
  if (expr.kind !== "binary" || !expr.left || !expr.right) return false;
  if (expr.operator === "and" || expr.operator === "or")
    return expr.typeRef.kind === "primitive" && expr.typeRef.name === "boolean" &&
      nativeSafePrimitiveCondition(expr.left) && nativeSafePrimitiveCondition(expr.right);
  if (["==", "!=", "<", "<=", ">", ">="].includes(expr.operator ?? ""))
    return supportedPrimitive(expr.left.typeRef) && supportedPrimitive(expr.right.typeRef) &&
      nativeSafePrimitiveCondition(expr.left) && nativeSafePrimitiveCondition(expr.right);
  if (expr.operator === "%" && expr.left.typeRef.kind === "primitive" && expr.left.typeRef.name === "integer" &&
      expr.right.typeRef.kind === "primitive" && expr.right.typeRef.name === "integer" && expr.right.kind === "literal") {
    try {
      return BigInt(String(expr.right.value)) !== 0n && nativeSafePrimitiveCondition(expr.left);
    } catch {
      return false;
    }
  }
  return false;
}

function canCombineIfStepWithBranch(statement: CoreStatement): statement is Extract<CoreStatement, { kind: "if" }> {
  if (statement.kind !== "if" || !statement.elseBody?.length || !statement.thenBody.length ||
      !nativeSafePrimitiveCondition(statement.condition)) return false;
  const branchStartsWithStatement = (body: CoreStatement[]) =>
    body[0]?.kind === "let" || body[0]?.kind === "assign";
  return branchStartsWithStatement(statement.thenBody) && branchStartsWithStatement(statement.elseBody);
}

function requiresSharedStepCounter(statements: CoreStatement[]): boolean {
  const expressionHasCall = (expr: CoreExpr): boolean => (expr.kind === "call" && expr.callee !== "textContains") ||
    [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee].some((child) => child ? expressionHasCall(child) : false) ||
    (expr.args ?? []).some(expressionHasCall) || (expr.elements ?? []).some(expressionHasCall) ||
    (expr.fields ?? []).some((field) => expressionHasCall(field.value)) ||
    (expr.arms ?? []).some((arm) => expressionHasCall(arm.value));
  const bodyHasCall = (body: CoreStatement[]): boolean => body.some((statement) => {
    if (statement.kind === "let" || statement.kind === "assign" || statement.kind === "return")
      return expressionHasCall(statement.value);
    if (statement.kind === "expect") return expressionHasCall(statement.actual) || expressionHasCall(statement.expected);
    if (statement.kind === "if") return expressionHasCall(statement.condition) || bodyHasCall(statement.thenBody) || bodyHasCall(statement.elseBody ?? []);
    if (statement.kind === "while") return expressionHasCall(statement.condition) || bodyHasCall(statement.body);
    if (statement.kind === "for") return expressionHasCall(statement.iterable) || bodyHasCall(statement.body);
    if (statement.kind === "repeat") return expressionHasCall(statement.count) || bodyHasCall(statement.body);
    return false;
  });
  return bodyHasCall(statements);
}

export function lowerNativeC(ir: ProjectIR, entryName = "main"): string {
  const entries = ir.functions.filter((fn) => fn.name === entryName);
  if (entries.length !== 1)
    throw new NativeLoweringError(
      entries.length === 0
        ? `Native build requires one entry function named "${entryName}"`
        : `Native build found multiple entry functions named "${entryName}"`,
    );
  const entry = entries[0]!;
  const filesystemEntry = entry.parameters[0]?.typeRef.kind === "capability";
  if (filesystemEntry) {
    if (entry.parameters[0]!.typeRef.kind !== "capability" || entry.parameters[0]!.typeRef.name !== "filesystem" ||
        entry.parameters.slice(1).some(parameter => parameter.typeRef.kind !== "primitive" || parameter.typeRef.name !== "text"))
      throw new NativeLoweringError(`Native entry function ${entry.id} supports only a leading filesystem capability followed by text arguments`);
    if (entry.returnTypeRef.kind !== "result" || entry.returnTypeRef.ok.kind !== "primitive" || !["boolean", "text"].includes(entry.returnTypeRef.ok.name) ||
        entry.returnTypeRef.error.kind !== "primitive" || entry.returnTypeRef.error.name !== "text")
      throw new NativeLoweringError(`Native filesystem entry ${entry.id} must return result<boolean,text> or result<text,text>`);
  } else {
    if (entry.parameters.length !== 0)
      throw new NativeLoweringError(`Native entry function ${entry.id} must not require parameters`);
    if (entry.returnTypeRef.kind !== "primitive" || !["integer", "number", "boolean"].includes(entry.returnTypeRef.name))
      throw new NativeLoweringError(`Native entry function ${entry.id} must return a supported primitive value`);
  }
  const functions = functionForCalls(ir, entry);
  for (const fn of functions)
    if (!alwaysReturns(fn.body))
      throw new NativeLoweringError(
        `Native primitive slice requires every path in ${fn.id} to return a value`,
      );
  const names = new Map(functions.map((fn) => [String(fn.id), cName("bmec_fn", String(fn.id))]));
  const optionalTypes = new Map<string, Extract<TypeRef, { kind: "optional" }>>();
  const resultTypes = new Map<string, Extract<TypeRef, { kind: "result" }>>();
  const enumTypes = new Map<string, Extract<TypeRef, { kind: "enum" }>>();
  const jsonDecodeTypes = new Map<string, Extract<TypeRef, { kind: "result" }>>();
  const jsonEncodeRecordTypes = new Map<string, Extract<TypeRef, { kind: "record" }>>();
  let numberJsonEncodingNeeded = false;
  let moneyJsonEncodingNeeded = false;
  const base64DecodeTypes = new Map<string, Extract<TypeRef, { kind: "result" }>>();
  let nativeMoneyNeeded = false;
  const filesystemBuiltinTypes = new Map<string, Extract<TypeRef, { kind: "result" }>>();
  const nativeMapSignatures = new Map<string, [(typeof nativeMapTypes)[number], (typeof nativeMapTypes)[number]]>();
  const nativePayloadSupported = (type: TypeRef) => type.kind === "record" ||
    (type.kind === "list" && type.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.element.name)) ||
    (type.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.name)) ||
    (type.kind === "optional" && type.inner.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.inner.name)) ||
    (type.kind === "result" && type.ok.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.ok.name) && type.error.kind === "primitive" && type.error.name === "text");
  const rememberType = (type: TypeRef, owner: string) => {
    if (type.kind === "primitive" && type.name === "money") {
      nativeMoneyNeeded = true;
    } else if (type.kind === "optional") {
      if (!nativePayloadSupported(type.inner))
        throw new NativeLoweringError(`Native optional payload ${type.inner.kind === "primitive" ? type.inner.name : type.inner.kind} is unsupported in ${owner}`);
      optionalTypes.set(JSON.stringify(type), type);
    } else if (type.kind === "result") {
      for (const payload of [type.ok, type.error]) if (!nativePayloadSupported(payload))
        throw new NativeLoweringError(`Native Result payload ${payload.kind === "primitive" ? payload.name : payload.kind} is unsupported in ${owner}`);
      for (const payload of [type.ok, type.error]) if (payload.kind === "optional" || payload.kind === "result") rememberType(payload, owner);
      resultTypes.set(JSON.stringify(type), type);
    } else if (type.kind === "enum") {
      if (type.typeArguments?.length || type.variants.some((variant) => variant.payload?.kind === "typeParameter"))
        throw new NativeLoweringError(`Native generic enum ${type.name} is unsupported in ${owner}`);
      for (const variant of type.variants) if (variant.payload &&
          (variant.payload.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(variant.payload.name)))
        throw new NativeLoweringError(`Native enum ${type.name}.${variant.name} supports only integer, number, boolean, or text payloads in ${owner}`);
      enumTypes.set(type.symbol, type);
    } else if (type.kind === "list" && (type.element.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(type.element.name))) {
      throw new NativeLoweringError(`Native list element ${type.element.kind === "primitive" ? type.element.name : type.element.kind} is unsupported in ${owner}`);
    }
  };
  const rememberExprTypes = (expr: CoreExpr, owner: string) => {
    rememberType(expr.typeRef, owner);
    if (expr.callee === "map" && expr.args?.[0]?.typeRef.kind === "list" && expr.args[0].typeRef.element.kind === "primitive" &&
        expr.typeRef.kind === "list" && expr.typeRef.element.kind === "primitive") {
      const inputName = expr.args[0].typeRef.element.name;
      const outputName = expr.typeRef.element.name;
      const input = nativeMapTypes.find((type) => type.name === inputName);
      const output = nativeMapTypes.find((type) => type.name === outputName);
      if (input && output) nativeMapSignatures.set(`${input.name}->${output.name}`, [input, output]);
    }
    if ((expr.callee === "readTextFile" || expr.callee === "writeTextFile") && expr.typeRef.kind === "result")
      filesystemBuiltinTypes.set(expr.callee, expr.typeRef);
    if (expr.callee === "decodeJson" && expr.typeRef.kind === "result")
      jsonDecodeTypes.set(JSON.stringify(expr.typeRef), expr.typeRef);
    if (expr.callee === "encodeJson") {
      const valueType = expr.args?.[0]?.typeRef;
      if (valueType?.kind === "primitive" && valueType.name === "money")
        moneyJsonEncodingNeeded = true;
      if (valueType?.kind === "record" ||
          valueType?.kind === "primitive" && valueType.name === "number" ||
          valueType?.kind === "list" && valueType.element.kind === "primitive" && valueType.element.name === "number")
        numberJsonEncodingNeeded = true;
    }
    if (expr.callee === "base64Decode" && expr.typeRef.kind === "result")
      base64DecodeTypes.set(JSON.stringify(expr.typeRef), expr.typeRef);
    for (const value of [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee]) if (value) rememberExprTypes(value, owner);
    for (const value of expr.args ?? []) rememberExprTypes(value, owner);
    for (const value of expr.elements ?? []) rememberExprTypes(value, owner);
    for (const field of expr.fields ?? []) rememberExprTypes(field.value, owner);
    for (const arm of expr.arms ?? []) rememberExprTypes(arm.value, owner);
  };
  const rememberStatementTypes = (statements: CoreStatement[], owner: string) => {
    for (const statement of statements) {
      if (statement.kind === "let" || statement.kind === "assign" || statement.kind === "return") {
        if (statement.kind === "let" && statement.declaredTypeRef) rememberType(statement.declaredTypeRef, owner);
        rememberExprTypes(statement.value, owner);
      } else if (statement.kind === "expect") { rememberExprTypes(statement.actual, owner); rememberExprTypes(statement.expected, owner); }
      else if (statement.kind === "if") { rememberExprTypes(statement.condition, owner); rememberStatementTypes(statement.thenBody, owner); if (statement.elseBody) rememberStatementTypes(statement.elseBody, owner); }
      else if (statement.kind === "for") { rememberExprTypes(statement.iterable, owner); rememberStatementTypes(statement.body, owner); }
      else if (statement.kind === "while") { rememberExprTypes(statement.condition, owner); rememberStatementTypes(statement.body, owner); }
      else if (statement.kind === "repeat") { rememberExprTypes(statement.count, owner); rememberStatementTypes(statement.body, owner); }
    }
  };
  for (const fn of functions) {
    for (const parameter of fn.parameters) rememberType(parameter.typeRef, String(fn.id));
    rememberType(fn.returnTypeRef, String(fn.id));
    rememberStatementTypes(fn.body, String(fn.id));
  }
  for (const fn of functions) for (const schema of Object.values(fn.recordSchemas ?? {}))
    for (const [field, fieldType] of Object.entries(schema.fields))
      if (fieldType.kind === "optional" && fieldType.inner.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.inner.name))
        rememberType(fieldType, `record ${String(schema.symbol)}.${field}`);
  const orderedOptionalTypes = [...optionalTypes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const optionalDefinition = (type: Extract<TypeRef, { kind: "optional" }>) =>
    `typedef struct { bool present; ${typeName(type.inner, typeName(type, "optional"))} value; } ${typeName(type, "optional")};`;
  const optionalScalarDefinitions = orderedOptionalTypes.filter(([, type]) => type.inner.kind === "primitive")
    .map(([, type]) => optionalDefinition(type));
  const optionalCompositeDefinitions = orderedOptionalTypes.filter(([, type]) => type.inner.kind !== "primitive")
    .map(([, type]) => optionalDefinition(type));
  const typeDependencyDepth = (type: TypeRef): number =>
    type.kind === "result" ? 1 + Math.max(typeDependencyDepth(type.ok), typeDependencyDepth(type.error)) :
    type.kind === "optional" ? 1 + typeDependencyDepth(type.inner) : 0;
  const resultDefinitions = [...resultTypes.entries()].sort(([a, left], [b, right]) =>
    typeDependencyDepth(left) - typeDependencyDepth(right) || a.localeCompare(b),
  ).map(([, type]) =>
    `typedef struct { bool is_ok; union { ${typeName(type.ok, "Result.ok")} ok; ${typeName(type.error, "Result.error")} error; } payload; } ${typeName(type, "Result")};`,
  );
  const enumDefinitions = [...enumTypes.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((type) => {
    const payloads = type.variants.flatMap((variant) => variant.payload
      ? [`${typeName(variant.payload, `${type.name}.${variant.name}`)} ${cName("bmec_variant", variant.name)};`]
      : []);
    const payloadUnion = payloads.length ? ` union { ${payloads.join(" ")} } payload;` : "";
    return `typedef struct { uint32_t tag;${payloadUnion} } ${typeName(type, type.name)};`;
  });
  const resultAccessors = [...resultTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, type]) => {
    const alias = typeName(type, "Result");
    const valueName = cName("bmec_result_value", JSON.stringify(type));
    const errorName = cName("bmec_result_error", JSON.stringify(type));
    return [
      `static ${typeName(type.ok, "Result.ok")} ${valueName}(${alias} value) { if (!value.is_ok) bmec_fail(\"PIPE-RUNTIME-002: Cannot extract Result.value from err\"); return value.payload.ok; }`,
      `static ${typeName(type.error, "Result.error")} ${errorName}(${alias} value) { if (value.is_ok) bmec_fail(\"PIPE-RUNTIME-002: Cannot extract Result.error from ok\"); return value.payload.error; }`,
    ];
  });
  const textIndexHelpers = [...optionalTypes.values()]
    .filter((type) => type.inner.kind === "primitive" && type.inner.name === "integer")
    .map((type) => {
      const alias = typeName(type, "textIndexOf");
      return `static ${alias} bmec_text_index_of(bmec_text text, bmec_text needle) { if (!needle.length) return (${alias}){ .present = true, .value = 0 }; size_t byte_index = bmec_text_find(text, needle, 0); if (byte_index == SIZE_MAX) return (${alias}){ .present = false }; bmec_text prefix = { text.data, byte_index }; return (${alias}){ .present = true, .value = bmec_text_length_codepoints(prefix) }; }`;
    });
  const schemas = new Map<string, { name: string; kind: "record" | "model"; fields: Record<string, TypeRef> }>();
  for (const fn of functions) for (const [name, schema] of Object.entries(fn.recordSchemas ?? {}))
    schemas.set(schema.symbol, { name, kind: schema.kind, fields: schema.fields });
  for (const [symbol] of jsonEncodeRecordTypes) {
    const schema = schemas.get(symbol);
    if (schema?.kind === "record" && Object.values(schema.fields).some((fieldType) => fieldType.kind === "primitive" && fieldType.name === "money"))
      moneyJsonEncodingNeeded = true;
  }
  const jsonDecodeHelpers = [...jsonDecodeTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, type]) => {
    if (type.ok.kind === "record") {
      if (type.error.kind !== "primitive" || type.error.name !== "text")
        throw new NativeLoweringError(`Native decodeJson currently requires result<Record,text> for record payload decoding in ${identity}`);
      const schema = schemas.get(type.ok.symbol);
      if (!schema || schema.kind !== "record")
        throw new NativeLoweringError(`Native decodeJson record schema ${type.ok.symbol} is unavailable in ${identity}`);
      const fields = Object.entries(schema.fields);
      if (!fields.length) throw new NativeLoweringError(`Native decodeJson does not support empty record ${schema.name} in ${identity}`);
      const alias = typeName(type, "decodeJson");
      const recordAlias = typeName(type.ok, "decodeJson.record");
      const functionName = cName("bmec_json_decode", identity);
      const allowed = fields.map(([field]) => cStringLiteral(field)).join(", ");
      const fieldCaptures = `const char *record_field_keys[] = { ${allowed} }; bmec_text record_field_values[${fields.length}] = {{0}}; if (!bmec_json_object_get_many(decoded.record_fields, record_field_keys, ${fields.length}, record_field_values, true)) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("record", "record") };`;
      const fieldReads = fields.map(([field, fieldType], index) => {
        if (fieldType.kind === "optional" && fieldType.inner.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.inner.name)) {
          const kind = fieldType.inner.name === "integer" ? 1 : fieldType.inner.name === "number" ? 2 : fieldType.inner.name === "boolean" ? 3 : 4;
          const raw = `field_raw_${index}`;
          const variable = `field_${index}`;
          return `bmec_text ${raw} = record_field_values[${index}]; bmec_json_scalar ${variable}; int status_${index} = bmec_json_scalar_parse(${raw}, &${variable}); if (status_${index} == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status_${index} != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(${variable}.error) }; if (${variable}.kind != 6 && ${variable}.kind != ${kind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("optional", bmec_json_kind_name(${variable}.kind)) };`;
        }
        if (fieldType.kind === "list" && fieldType.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.element.name)) {
          const element = fieldType.element.name;
          const kind = element === "integer" ? 1 : element === "number" ? 2 : element === "boolean" ? 3 : 4;
          const ctype = typeName(fieldType.element, `decodeJson record ${schema.name}.${field}`);
          const raw = `field_raw_${index}`;
          const variable = `field_${index}`;
          if (element === "integer") {
            return `bmec_text ${raw} = record_field_values[${index}]; bmec_json_scalar ${variable} = {0}; int64_t *${variable}_items = NULL; size_t ${variable}_length = 0; const char *${variable}_fast_error = NULL; int ${variable}_fast_status = bmec_json_fast_integer_list(${raw}, &${variable}_items, &${variable}_length, &${variable}_fast_error); if (${variable}_fast_status == 2) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(${variable}_fast_error) }; if (${variable}_fast_status == 1) { ${variable}.kind = 8; ${variable}.list_length = ${variable}_length; } else { int status_${index} = bmec_json_scalar_parse(${raw}, &${variable}); if (status_${index} == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status_${index} != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(${variable}.error) }; if (${variable}.kind != 8) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(${variable}.kind)) }; ${variable}_items = ${variable}.list_length ? (int64_t *)bmec_arena_alloc(${variable}.list_length * sizeof(int64_t)) : NULL; for (size_t item_${index} = 0; item_${index} < ${variable}.list_length; ++item_${index}) { if (${variable}.list_items[item_${index}].kind != ${kind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(${variable}.list_items[item_${index}].kind)) }; ${variable}_items[item_${index}] = ${variable}.list_items[item_${index}].integer; } }`;
          }
          return `bmec_text ${raw} = record_field_values[${index}]; bmec_json_scalar ${variable}; int status_${index} = bmec_json_scalar_parse(${raw}, &${variable}); if (status_${index} == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status_${index} != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(${variable}.error) }; if (${variable}.kind != 8) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(${variable}.kind)) }; ${ctype} *field_${index}_items = ${variable}.list_length ? (${ctype} *)bmec_arena_alloc(${variable}.list_length * sizeof(${ctype})) : NULL; for (size_t item_${index} = 0; item_${index} < ${variable}.list_length; ++item_${index}) { if (${variable}.list_items[item_${index}].kind != ${kind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(${variable}.list_items[item_${index}].kind)) }; field_${index}_items[item_${index}] = ${variable}.list_items[item_${index}].${element}; }`;
        }
        if (fieldType.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(fieldType.name))
          throw new NativeLoweringError(`Native decodeJson record ${schema.name}.${field} has unsupported field type ${fieldType.kind === "primitive" ? fieldType.name : fieldType.kind} in ${identity}`);
        const kind = fieldType.name === "integer" ? 1 : fieldType.name === "number" ? 2 : fieldType.name === "boolean" ? 3 : 4;
        const variable = `field_${index}`;
        const raw = `field_raw_${index}`;
        return `bmec_text ${raw} = record_field_values[${index}]; bmec_json_scalar ${variable}; int status_${index} = bmec_json_scalar_parse(${raw}, &${variable}); if (status_${index} == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status_${index} != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(${variable}.error) }; if (${variable}.kind != ${kind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("record", bmec_json_kind_name(${variable}.kind)) };`;
      }).join(" ");
      const initializers = fields.map(([field, fieldType], index) => fieldType.kind === "list"
        ? `.${cName("bmec_field", field)} = { field_${index}_items, field_${index}.list_length }`
        : fieldType.kind === "optional" && fieldType.inner.kind === "primitive"
          ? `.${cName("bmec_field", field)} = { field_${index}.kind != 6, field_${index}.${fieldType.inner.name} }`
        : `.${cName("bmec_field", field)} = field_${index}.${fieldType.kind === "primitive" ? fieldType.name : "text"}`).join(", ");
      const fastRecordEligible = fields.every(([, fieldType]) =>
        (fieldType.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.name)) ||
        (fieldType.kind === "list" && fieldType.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.element.name)),
      );
      const fastRecord = fastRecordEligible
        ? (() => {
            const prefix = `{"version":1,"kind":"record","type":{"kind":"record","name":${JSON.stringify(schema.name)},"symbol":${JSON.stringify(type.ok.symbol)}},"fields":{`;
            const fieldDecls = fields.map(([, fieldType], index) =>
              fieldType.kind === "primitive" && fieldType.name === "text"
                ? `bmec_text fast_record_field_${index} = {0};`
                : fieldType.kind === "primitive"
                ? `${fieldType.name === "integer" ? "int64_t" : fieldType.name === "number" ? "double" : "bool"} fast_record_field_${index} = 0;`
                : `void *fast_record_field_${index}_items = NULL; size_t fast_record_field_${index}_length = 0;`,
            ).join(" ");
            const fastReads = fields.map(([field, fieldType], index) => {
              const key = `if (fast_record_matches && !bmec_json_fast_take(source, &fast_record_cursor, ${cStringLiteral(`${index === 0 ? "" : ","}${JSON.stringify(field)}:`)})) fast_record_matches = false; `;
              const read = fieldType.kind === "primitive"
                ? fieldType.name === "integer"
                  ? `if (fast_record_matches) { int status = bmec_json_fast_list_integer_item(source, &fast_record_cursor, source.length, &fast_record_field_${index}, &fast_record_error); if (status != 1) fast_record_matches = false; }`
                  : fieldType.name === "number"
                    ? `if (fast_record_matches && bmec_json_fast_number_item(source, &fast_record_cursor, source.length, &fast_record_field_${index}) != 1) fast_record_matches = false;`
                    : fieldType.name === "boolean"
                      ? `if (fast_record_matches && bmec_json_fast_boolean_item(source, &fast_record_cursor, source.length, &fast_record_field_${index}) != 1) fast_record_matches = false;`
                      : `if (fast_record_matches && bmec_json_fast_text_item(source, &fast_record_cursor, source.length, &fast_record_field_${index}) != 1) fast_record_matches = false;`
                : fieldType.kind === "list"
                  ? `if (fast_record_matches) { int status = bmec_json_fast_primitive_list_at(source, &fast_record_cursor, ${fieldType.element.kind === "primitive" ? fieldType.element.name === "integer" ? 1 : fieldType.element.name === "number" ? 2 : fieldType.element.name === "boolean" ? 3 : 4 : 0}, &fast_record_field_${index}_items, &fast_record_field_${index}_length, &fast_record_error); if (status != 1) fast_record_matches = false; }`
                  : "";
              return key + read;
            }).join(" ");
            const fastInitializers = fields.map(([field, fieldType], index) => fieldType.kind === "primitive"
              ? `.${cName("bmec_field", field)} = fast_record_field_${index}`
              : `.${cName("bmec_field", field)} = { fast_record_field_${index}_items, fast_record_field_${index}_length }`).join(", ");
            return `size_t fast_record_cursor = 0; const char *fast_record_error = NULL; ${fieldDecls} if (bmec_json_fast_take(source, &fast_record_cursor, ${cStringLiteral(prefix)})) { bool fast_record_matches = true; ${fastReads} if (fast_record_matches && bmec_json_fast_take(source, &fast_record_cursor, "}}") && fast_record_cursor == source.length) return (${alias}){ .is_ok = true, .payload.ok = (${recordAlias}){ ${fastInitializers} } }; }`;
          })()
        : "";
      return `static ${alias} ${functionName}(bmec_text source) { ${fastRecord} bmec_json_scalar decoded; int status = bmec_json_scalar_parse(source, &decoded); if (status == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(decoded.error) }; if (decoded.kind != 9 || !bmec_json_record_type_matches(decoded.record_type, ${cStringLiteral(schema.name)}, ${cStringLiteral(type.ok.symbol)})) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("record", bmec_json_kind_name(decoded.kind)) }; ${fieldCaptures} ${fieldReads} return (${alias}){ .is_ok = true, .payload.ok = (${recordAlias}){ ${initializers} } }; }`;
    }
    if (type.ok.kind === "list") {
      if (type.ok.element.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(type.ok.element.name) || type.error.kind !== "primitive" || type.error.name !== "text")
        throw new NativeLoweringError(`Native decodeJson currently requires result<list<integer|number|boolean|text>,text> for list payload decoding in ${identity}`);
      const alias = typeName(type, "decodeJson");
      const functionName = cName("bmec_json_decode", identity);
      const element = type.ok.element.name;
      const kind = element === "integer" ? 1 : element === "number" ? 2 : element === "boolean" ? 3 : 4;
      const ctype = typeName(type.ok.element, "decodeJson.list");
      const listAlias = typeName(type.ok, "decodeJson.list");
      const integerFastPath = element === "integer"
        ? `int64_t *fast_items = NULL; size_t fast_length = 0; const char *fast_error = NULL; int fast_status = bmec_json_fast_integer_list(source, &fast_items, &fast_length, &fast_error); if (fast_status == 1) return (${alias}){ .is_ok = true, .payload.ok = (${listAlias}){ fast_items, fast_length } }; if (fast_status == 2) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", "list") };`
        : "";
      const textListFastPath = element === "text"
        ? `size_t fast_cursor = 0; void *fast_items = NULL; size_t fast_length = 0; const char *fast_error = NULL; int fast_status = bmec_json_fast_primitive_list_at(source, &fast_cursor, 4, &fast_items, &fast_length, &fast_error); if (fast_status == 1 && fast_cursor == source.length) return (${alias}){ .is_ok = true, .payload.ok = (${listAlias}){ (${ctype} *)fast_items, fast_length } };`
        : "";
      return `static ${alias} ${functionName}(bmec_text source) { ${integerFastPath} ${textListFastPath} bmec_json_scalar decoded; int status = bmec_json_scalar_parse(source, &decoded); if (status == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(decoded.error) }; if (decoded.kind != 8) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(decoded.kind)) }; ${ctype} *items = decoded.list_length ? (${ctype} *)bmec_arena_alloc(decoded.list_length * sizeof(${ctype})) : NULL; for (size_t i = 0; i < decoded.list_length; ++i) { if (decoded.list_items[i].kind != ${kind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("list", bmec_json_kind_name(decoded.list_items[i].kind)) }; items[i] = decoded.list_items[i].${element}; } return (${alias}){ .is_ok = true, .payload.ok = (${listAlias}){ items, decoded.list_length } }; }`;
    }
    if (type.ok.kind === "result") {
      const inner = type.ok;
      if (type.error.kind !== "primitive" || type.error.name !== "text" || inner.error.kind !== "primitive" || inner.error.name !== "text" || inner.ok.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(inner.ok.name))
        throw new NativeLoweringError(`Native decodeJson currently requires result<scalar-result,text> for result payload decoding in ${identity}`);
      const alias = typeName(type, "decodeJson");
      const innerAlias = typeName(inner, "decodeJson.inner");
      const functionName = cName("bmec_json_decode", identity);
      const member = inner.ok.name;
      const expectedKind = inner.ok.name === "integer" ? 1 : inner.ok.name === "number" ? 2 : inner.ok.name === "boolean" ? 3 : 4;
      return `static ${alias} ${functionName}(bmec_text source) { bmec_json_scalar decoded; int status = bmec_json_scalar_parse(source, &decoded); if (status == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text(decoded.error) }; if (decoded.kind != 7 || !decoded.result_payload) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("result", bmec_json_kind_name(decoded.kind)) }; if (decoded.result_ok) { if (decoded.result_payload->kind != ${expectedKind}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("${inner.ok.name}", bmec_json_kind_name(decoded.result_payload->kind)) }; return (${alias}){ .is_ok = true, .payload.ok = (${innerAlias}){ .is_ok = true, .payload.ok = decoded.result_payload->${member} } }; } if (decoded.result_payload->kind != 4) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("text", bmec_json_kind_name(decoded.result_payload->kind)) }; return (${alias}){ .is_ok = true, .payload.ok = (${innerAlias}){ .is_ok = false, .payload.error = decoded.result_payload->text } }; }`;
    }
    const isOptional = type.ok.kind === "optional";
    const decodedType: TypeRef = isOptional ? type.ok.inner : type.ok;
    if (type.error.kind !== "primitive" || type.error.name !== "text" || decodedType.kind !== "primitive" || !["integer", "number", "boolean", "text"].includes(decodedType.name))
      throw new NativeLoweringError(`Native decodeJson currently requires result<integer|number|boolean|text|optional-scalar,text> in ${identity}`);
    const alias = typeName(type, "decodeJson");
    const functionName = cName("bmec_json_decode", identity);
    const kind = isOptional ? 5 : decodedType.name === "integer" ? 1 : decodedType.name === "number" ? 2 : decodedType.name === "boolean" ? 3 : 4;
    const member = decodedType.name;
    const expected = decodedType.name;
    const success = isOptional
      ? `.payload.ok = (${typeName(type.ok, "optional")}){ .present = decoded.optional_present, .value = decoded.${member} }`
      : `.payload.ok = decoded.${member}`;
    const innerMismatch = isOptional ? ` || (decoded.kind == 5 && (!decoded.optional_present || decoded.optional_kind != ${decodedType.name === "integer" ? 1 : decodedType.name === "number" ? 2 : decodedType.name === "boolean" ? 3 : 4}))` : "";
    const kindMismatch = isOptional ? "decoded.kind != 5 && decoded.kind != 6" : `decoded.kind != ${kind}`;
    const integerFastPath = !isOptional && decodedType.name === "integer"
      ? `int64_t fast_value; const char *fast_error = NULL; int fast_status = bmec_json_fast_integer(source, &fast_value, &fast_error); if (fast_status == 1) return (${alias}){ .is_ok = true, .payload.ok = fast_value }; if (fast_status == 2) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("${expected}", "integer") };`
      : "";
    return `static ${alias} ${functionName}(bmec_text source) { ${integerFastPath} bmec_json_scalar decoded; int status = bmec_json_scalar_parse(source, &decoded); if (status == 1) return (${alias}){ .is_ok = false, .payload.error = bmec_json_error_text("PIPE-JSON-001: invalid JSON") }; if (status != 0) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("${expected}", bmec_json_kind_name(decoded.kind)) }; if (${kindMismatch}${innerMismatch}) return (${alias}){ .is_ok = false, .payload.error = bmec_json_type_mismatch("${expected}", bmec_json_kind_name(decoded.kind)) }; return (${alias}){ .is_ok = true, ${success} }; }`;
  });
  const base64DecodeHelpers = [...base64DecodeTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, type]) => {
    if (type.ok.kind !== "primitive" || type.ok.name !== "text" || type.error.kind !== "primitive" || type.error.name !== "text")
      throw new NativeLoweringError(`Native base64Decode currently requires result<text,text> in ${identity}`);
    const alias = typeName(type, "base64Decode");
    const functionName = cName("bmec_base64_decode", identity);
    return `static int bmec_base64_value(unsigned char c) { if (c >= 'A' && c <= 'Z') return c - 'A'; if (c >= 'a' && c <= 'z') return c - 'a' + 26; if (c >= '0' && c <= '9') return c - '0' + 52; if (c == '+') return 62; if (c == '/') return 63; return -1; } static ${alias} ${functionName}(bmec_text input) { if (input.length % 4) return (${alias}){ .is_ok = false, .payload.error = { (const unsigned char *)"invalid_base64", 14 } }; size_t groups = input.length / 4; size_t padding = input.length && input.data[input.length - 1] == '=' ? (input.length > 1 && input.data[input.length - 2] == '=' ? 2 : 1) : 0; if (groups > SIZE_MAX / 3) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); size_t length = groups * 3 - padding; unsigned char *output = (unsigned char *)bmec_arena_alloc(length ? length : 1); size_t out = 0; for (size_t g = 0; g < groups; ++g) { const unsigned char *p = input.data + g * 4; bool last = g + 1 == groups; int a = bmec_base64_value(p[0]), b = bmec_base64_value(p[1]); int c = p[2] == '=' ? 0 : bmec_base64_value(p[2]); int d = p[3] == '=' ? 0 : bmec_base64_value(p[3]); if (a < 0 || b < 0 || c < 0 || d < 0 || (!last && (p[2] == '=' || p[3] == '=')) || (p[2] == '=' && p[3] != '=') || (p[2] == '=' && (b & 15)) || (p[3] == '=' && p[2] != '=' && (c & 3))) return (${alias}){ .is_ok = false, .payload.error = { (const unsigned char *)"invalid_base64", 14 } }; uint32_t bits = ((uint32_t)a << 18) | ((uint32_t)b << 12) | ((uint32_t)c << 6) | (uint32_t)d; output[out++] = (unsigned char)(bits >> 16); if (p[2] != '=') output[out++] = (unsigned char)(bits >> 8); if (p[3] != '=') output[out++] = (unsigned char)bits; } if (!bmec_utf8_valid(output, length)) return (${alias}){ .is_ok = false, .payload.error = { (const unsigned char *)"invalid_base64", 14 } }; return (${alias}){ .is_ok = true, .payload.ok = { output, length } }; }`;
  });
  const filesystemResultHelpers: string[] = [];
  for (const [name, type] of filesystemBuiltinTypes) {
    const alias = typeName(type, `filesystem ${name}`);
    const functionName = name === "readTextFile" ? "bmec_builtin_readTextFile" : "bmec_builtin_writeTextFile";
    if (name === "readTextFile") {
      if (type.ok.kind !== "primitive" || type.ok.name !== "text" || type.error.kind !== "primitive" || type.error.name !== "text")
        throw new NativeLoweringError("Native readTextFile requires result<text,text>");
      filesystemResultHelpers.push(`static ${alias} ${functionName}(bmec_filesystem capability, bmec_text path) { const char *error = NULL; bmec_text value = bmec_fs_read_file(capability, path, &error); if (error) return (${alias}){ .is_ok = false, .payload.error = bmec_fs_error_text(error) }; return (${alias}){ .is_ok = true, .payload.ok = value }; }`);
    } else {
      if (type.ok.kind !== "primitive" || type.ok.name !== "boolean" || type.error.kind !== "primitive" || type.error.name !== "text")
        throw new NativeLoweringError("Native writeTextFile requires result<boolean,text>");
      filesystemResultHelpers.push(`static ${alias} ${functionName}(bmec_filesystem capability, bmec_text path, bmec_text contents) { const char *error = bmec_fs_write_file(capability, path, contents); if (error) return (${alias}){ .is_ok = false, .payload.error = bmec_fs_error_text(error) }; return (${alias}){ .is_ok = true, .payload.ok = true }; }`);
    }
  }
  const referencedRecords = new Set<string>();
  for (const fn of functions) {
    for (const parameter of fn.parameters) if (parameter.typeRef.kind === "record") referencedRecords.add(parameter.typeRef.symbol);
    if (fn.returnTypeRef.kind === "record") referencedRecords.add(fn.returnTypeRef.symbol);
  }
  const findExprRecords = (expr: CoreExpr) => {
    if (expr.typeRef.kind === "record") referencedRecords.add(expr.typeRef.symbol);
    if (expr.callee === "encodeJson" && expr.args?.[0]?.typeRef.kind === "record") {
      jsonEncodeRecordTypes.set(expr.args[0].typeRef.symbol, expr.args[0].typeRef);
      const schema = schemas.get(expr.args[0].typeRef.symbol);
      if (schema?.kind === "record" && Object.values(schema.fields).some((fieldType) => fieldType.kind === "primitive" && fieldType.name === "money"))
        moneyJsonEncodingNeeded = true;
    }
    for (const value of [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee]) if (value) findExprRecords(value);
    for (const value of expr.args ?? []) findExprRecords(value);
    for (const value of expr.elements ?? []) findExprRecords(value);
    for (const field of expr.fields ?? []) findExprRecords(field.value);
    for (const arm of expr.arms ?? []) findExprRecords(arm.value);
  };
  const findStatementRecords = (statements: CoreStatement[]) => {
    for (const statement of statements) {
      if (statement.kind === "let" || statement.kind === "assign" || statement.kind === "return") {
        if (statement.kind === "let" && statement.declaredTypeRef?.kind === "record") referencedRecords.add(statement.declaredTypeRef.symbol);
        if (statement.kind === "let" && statement.value.typeRef.kind === "list" && statement.value.typeRef.element.kind === "record")
          throw new NativeLoweringError(`Native record lists are not supported in ${statement.name}`);
        findExprRecords(statement.value);
      } else if (statement.kind === "expect") { findExprRecords(statement.actual); findExprRecords(statement.expected); }
      else if (statement.kind === "if") { findExprRecords(statement.condition); findStatementRecords(statement.thenBody); if (statement.elseBody) findStatementRecords(statement.elseBody); }
      else if (statement.kind === "for") { findExprRecords(statement.iterable); findStatementRecords(statement.body); }
      else if (statement.kind === "while") { findExprRecords(statement.condition); findStatementRecords(statement.body); }
      else if (statement.kind === "repeat") { findExprRecords(statement.count); findStatementRecords(statement.body); }
    }
  };
  for (const fn of functions) findStatementRecords(fn.body);
  for (const type of optionalTypes.values()) if (type.inner.kind === "record") referencedRecords.add(type.inner.symbol);
  for (const type of resultTypes.values()) {
    if (type.ok.kind === "record") referencedRecords.add(type.ok.symbol);
    if (type.error.kind === "record") referencedRecords.add(type.error.symbol);
  }
  const pureRecordFieldValue = (expr: CoreExpr): boolean => {
    if (expr.kind === "record") return Boolean(expr.fields?.every((field) => pureRecordFieldValue(field.value)));
    if (expr.kind === "literal" || expr.kind === "identifier") return true;
    if (expr.kind === "unary") return Boolean(expr.operand && pureRecordFieldValue(expr.operand));
    if (expr.kind === "binary") return Boolean(expr.left && expr.right && pureRecordFieldValue(expr.left) && pureRecordFieldValue(expr.right));
    if (expr.kind === "field") return Boolean(expr.object && pureRecordFieldValue(expr.object));
    return false;
  };
  const recordAliases = new Map<string, string>();
  const recordDefinitions: string[] = [];
  const orderedRecords: string[] = [];
  const visitingRecords = new Set<string>();
  const visitedRecords = new Set<string>();
  const visitRecord = (symbol: string) => {
    if (visitedRecords.has(symbol)) return;
    if (visitingRecords.has(symbol)) throw new NativeLoweringError(`Native record ${symbol} contains a recursive by-value field`);
    visitingRecords.add(symbol);
    const schema = schemas.get(symbol);
    if (!schema || schema.kind !== "record") throw new NativeLoweringError(`Native record schema ${symbol} is unavailable or is not a plain record`);
    for (const fieldType of Object.values(schema.fields)) if (fieldType.kind === "record") visitRecord(fieldType.symbol);
    visitingRecords.delete(symbol);
    visitedRecords.add(symbol);
    orderedRecords.push(symbol);
  };
  for (const symbol of [...referencedRecords].sort()) visitRecord(symbol);
  for (const symbol of orderedRecords) {
    const schema = schemas.get(symbol);
    if (!schema || schema.kind !== "record") throw new NativeLoweringError(`Native record schema ${symbol} is unavailable or is not a plain record`);
    const alias = cName("bmec_record", symbol);
    recordAliases.set(symbol, alias);
    const fields = Object.entries(schema.fields);
    if (!fields.length) throw new NativeLoweringError(`Native record ${schema.name} must have at least one field`);
    const declarations = fields.map(([field, type]) => {
      if (type.kind === "list" && type.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.element.name))
        return `  ${typeName(type, schema.name)} ${cName("bmec_field", field)};`;
      if (type.kind === "optional" && type.inner.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(type.inner.name))
        return `  ${typeName(type, schema.name)} ${cName("bmec_field", field)};`;
      if (type.kind === "record")
        return `  ${typeName(type, schema.name)} ${cName("bmec_field", field)};`;
      if (type.kind !== "primitive" || !["integer", "number", "boolean", "text", "money"].includes(type.name))
        throw new NativeLoweringError(`Native record ${schema.name}.${field} has unsupported field type ${type.kind === "primitive" ? type.name : type.kind}`);
      return `  ${typeName(type, schema.name)} ${cName("bmec_field", field)};`;
    });
    recordDefinitions.push(`typedef struct {\n${declarations.join("\n")}\n} ${alias};`);
  }
  const jsonEncodeOptionalTypes = new Map<string, Extract<TypeRef, { kind: "optional" }>>();
  for (const [symbol] of jsonEncodeRecordTypes) {
    const schema = schemas.get(symbol);
    if (!schema || schema.kind !== "record") continue;
    for (const fieldType of Object.values(schema.fields))
      if (fieldType.kind === "optional" && fieldType.inner.kind === "primitive" &&
          ["integer", "number", "boolean", "text"].includes(fieldType.inner.name))
        jsonEncodeOptionalTypes.set(JSON.stringify(fieldType), fieldType);
  }
  const optionalJsonEncodeHelpers = [...jsonEncodeOptionalTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, optionalType]) => {
    if (optionalType.inner.kind !== "primitive") throw new NativeLoweringError("Native optional JSON encoder requires a primitive payload");
    const name = optionalType.inner.name;
    const alias = typeName(optionalType, `encodeJson optional ${name}`);
    return `static bmec_text bmec_json_encode_optional_${name}(${alias} value) { static const unsigned char absent[] = "{\\\"version\\\":1,\\\"kind\\\":\\\"none\\\"}"; if (!value.present) return (bmec_text){ absent, sizeof(absent) - 1 }; return bmec_json_encode_${name}(value.value); }`;
  });
  const recordJsonEncodeHelpers = [...jsonEncodeRecordTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, recordType]) => {
    if (recordType.typeArguments?.length)
      throw new NativeLoweringError(`Native encodeJson does not support generic record ${recordType.name}`);
    const schema = schemas.get(symbol);
    if (!schema || schema.kind !== "record")
      throw new NativeLoweringError(`Native encodeJson record schema ${symbol} is unavailable`);
    const fields = Object.entries(schema.fields);
    if (!fields.length) throw new NativeLoweringError(`Native encodeJson does not support empty record ${schema.name}`);
    const alias = typeName(recordType, `encodeJson ${schema.name}`);
    const valueName = "value";
    const encoders = fields.map(([field, fieldType], index) => {
      const member = `${valueName}.${cName("bmec_field", field)}`;
      let encoder: string;
      if (fieldType.kind === "primitive" && fieldType.name === "money")
        encoder = `bmec_json_encode_money(${member})`;
      else if (fieldType.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.name))
        encoder = `bmec_json_encode_${fieldType.name}(${member})`;
      else if (fieldType.kind === "list" && fieldType.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.element.name))
        encoder = `bmec_json_encode_${fieldType.element.name}_list(${member})`;
      else if (fieldType.kind === "optional" && fieldType.inner.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(fieldType.inner.name))
        encoder = `bmec_json_encode_optional_${fieldType.inner.name}(${member})`;
      else throw new NativeLoweringError(`Native encodeJson record ${schema.name}.${field} has unsupported field type ${fieldType.kind === "primitive" ? fieldType.name : fieldType.kind}`);
      return `items[${index}] = ${encoder};`;
    });
    const keys = fields.map(([field], index) => `static const unsigned char key_${index}[] = ${cStringLiteral(JSON.stringify(field))};`).join(" ");
    const fieldSizing = fields.map((_, index) => `size_t key_length_${index} = sizeof(key_${index}) - 1; size_t extra_${index} = key_length_${index} + 1 + items[${index}].length${index ? " + 1" : ""}; if (extra_${index} > SIZE_MAX - total) bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded"); total += extra_${index};`).join(" ");
    const fieldWriting = fields.map((_, index) => `${index ? "output[at++] = ','; " : ""}memcpy(output + at, key_${index}, key_length_${index}); at += key_length_${index}; output[at++] = ':'; memcpy(output + at, items[${index}].data, items[${index}].length); at += items[${index}].length;`).join(" ");
    return `static bmec_text ${cName("bmec_json_encode_record", symbol)}(${alias} ${valueName}) { static const unsigned char prefix[] = "{\\\"version\\\":1,\\\"kind\\\":\\\"record\\\",\\\"type\\\":"; static const unsigned char type[] = ${cStringLiteral(JSON.stringify(recordType))}; static const unsigned char middle[] = ",\\\"fields\\\":{"; ${keys} bmec_text items[${fields.length}]; ${encoders.join(" ")} size_t total = sizeof(prefix) - 1 + sizeof(type) - 1 + sizeof(middle) - 1 + 2; ${fieldSizing} unsigned char *output = (unsigned char *)bmec_arena_alloc(total); size_t at = 0; memcpy(output + at, prefix, sizeof(prefix) - 1); at += sizeof(prefix) - 1; memcpy(output + at, type, sizeof(type) - 1); at += sizeof(type) - 1; memcpy(output + at, middle, sizeof(middle) - 1); at += sizeof(middle) - 1; ${fieldWriting} output[at++] = '}'; output[at++] = '}'; return (bmec_text){ output, at }; }`;
  });
  const filesystemRuntime = String.raw`
#if defined(__linux__) && !defined(_WIN32)
typedef char bmec_native_arg;
static bool bmec_fs_arg_equal(const char *argument, const char *ascii) { return strcmp(argument, ascii) == 0; }
static char *bmec_fs_argument_utf8(const char *argument) { size_t length = strlen(argument); if (length == SIZE_MAX) return NULL; char *copy = (char *)malloc(length + 1); if (copy) memcpy(copy, argument, length + 1); return copy; }
static void bmec_fs_close_root(void) { if (bmec_fs_root_fd >= 0) { close(bmec_fs_root_fd); bmec_fs_root_fd = -1; } }
static int bmec_fs_init_root(const char *path) { bmec_fs_root_fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC); return bmec_fs_root_fd >= 0 ? 0 : -1; }
static int bmec_fs_openat(bmec_filesystem capability, bmec_text path, int flags, mode_t mode) {
  if (capability.root_fd < 0 || path.length == 0 || !path.data || memchr(path.data, 0, path.length)) { errno = EINVAL; return -1; }
  char *name = (char *)malloc(path.length + 1);
  if (!name) { errno = ENOMEM; return -1; }
  memcpy(name, path.data, path.length); name[path.length] = 0;
  struct open_how how = { .flags = (uint64_t)flags, .mode = (uint64_t)mode, .resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS };
#if defined(SYS_openat2)
  int fd = (int)syscall(SYS_openat2, (int)capability.root_fd, name, &how, sizeof(how));
#else
  errno = ENOSYS; int fd = -1;
#endif
  free(name); return fd;
}
static const char *bmec_fs_errno_error(int error, const char *fallback) {
  if (error == ENOENT) return "not_found";
  if (error == EXDEV || error == ELOOP) return "path_outside_root";
  if (error == ENOSYS) return "native_filesystem_unsupported";
  return fallback;
}
static bmec_text bmec_fs_read_file(bmec_filesystem capability, bmec_text path, const char **error) {
  if (!path.length || (path.data && memchr(path.data, 0, path.length))) { *error = "read_failed"; return (bmec_text){ NULL, 0 }; }
  int fd = bmec_fs_openat(capability, path, O_RDONLY | O_CLOEXEC, 0);
  if (fd < 0) { *error = bmec_fs_errno_error(errno, "read_failed"); return (bmec_text){ NULL, 0 }; }
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || info.st_size < 0 || (uintmax_t)info.st_size > SIZE_MAX) { close(fd); *error = "read_failed"; return (bmec_text){ NULL, 0 }; }
  size_t capacity = (size_t)info.st_size;
  unsigned char *buffer = capacity ? (unsigned char *)bmec_arena_alloc(capacity) : NULL;
  size_t length = 0;
  while (length < capacity) {
    ssize_t received = read(fd, buffer + length, capacity - length);
    if (received < 0 && errno == EINTR) continue;
    if (received < 0) { close(fd); *error = "read_failed"; return (bmec_text){ NULL, 0 }; }
    if (received == 0) break;
    length += (size_t)received;
  }
  unsigned char extra;
  ssize_t trailing = read(fd, &extra, 1);
  close(fd);
  if (trailing < 0 && errno != EINTR) { *error = "read_failed"; return (bmec_text){ NULL, 0 }; }
  if (trailing > 0 || !bmec_utf8_valid(buffer, length)) { *error = trailing > 0 ? "read_failed" : "invalid_utf8"; return (bmec_text){ NULL, 0 }; }
  return (bmec_text){ buffer, length };
}
static const char *bmec_fs_write_file(bmec_filesystem capability, bmec_text path, bmec_text contents) {
  if (!path.length || (path.data && memchr(path.data, 0, path.length)) || !bmec_utf8_valid(contents.data, contents.length)) return "write_failed";
  int fd = bmec_fs_openat(capability, path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0666);
  if (fd < 0) return bmec_fs_errno_error(errno, "write_failed");
  size_t written = 0;
  while (written < contents.length) {
    ssize_t amount = write(fd, contents.data + written, contents.length - written);
    if (amount < 0 && errno == EINTR) continue;
    if (amount <= 0) { close(fd); return "write_failed"; }
    written += (size_t)amount;
  }
  if (close(fd) != 0) return "write_failed";
  return NULL;
}
#elif defined(_WIN32)
typedef wchar_t bmec_native_arg;
static bool bmec_fs_arg_equal(const wchar_t *argument, const char *ascii) { size_t i = 0; while (ascii[i] && argument[i] == (wchar_t)(unsigned char)ascii[i]) ++i; return !ascii[i] && !argument[i]; }
static char *bmec_fs_argument_utf8(const wchar_t *argument) { int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argument, -1, NULL, 0, NULL, NULL); if (count <= 0) return NULL; char *value = (char *)malloc((size_t)count); if (!value) return NULL; if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argument, -1, value, count, NULL, NULL) != count) { free(value); return NULL; } return value; }
typedef NTSTATUS (NTAPI *bmec_nt_create_file_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
static intptr_t bmec_fs_ntstatus_to_error(NTSTATUS status) { typedef ULONG (WINAPI *convert_fn)(NTSTATUS); HMODULE module = GetModuleHandleW(L"ntdll.dll"); convert_fn convert = module ? (convert_fn)(void *)GetProcAddress(module, "RtlNtStatusToDosError") : NULL; return convert ? (intptr_t)convert(status) : ERROR_GEN_FAILURE; }
static bmec_nt_create_file_fn bmec_fs_get_nt_create_file(void) { HMODULE module = GetModuleHandleW(L"ntdll.dll"); return module ? (bmec_nt_create_file_fn)(void *)GetProcAddress(module, "NtCreateFile") : NULL; }
static void bmec_fs_close_root(void) { if (bmec_fs_root_fd != -1) { CloseHandle((HANDLE)bmec_fs_root_fd); bmec_fs_root_fd = -1; } }
static int bmec_fs_init_root(const wchar_t *path) { HANDLE root = CreateFileW(path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL); if (root == INVALID_HANDLE_VALUE) return -1; FILE_ATTRIBUTE_TAG_INFO info; if (!GetFileInformationByHandleEx(root, FileAttributeTagInfo, &info, sizeof(info)) || !(info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) { CloseHandle(root); return -1; } bmec_fs_root_fd = (intptr_t)root; return 0; }
static int bmec_fs_utf8_to_wide(bmec_text text, wchar_t **output, size_t *wide_length) { if (text.length > INT_MAX || !bmec_utf8_valid(text.data, text.length) || (text.length && memchr(text.data, 0, text.length))) return -1; int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)text.data, (int)text.length, NULL, 0); if (count <= 0 || (size_t)count > (SIZE_MAX / sizeof(wchar_t)) - 1) return -1; wchar_t *wide = (wchar_t *)malloc(((size_t)count + 1) * sizeof(wchar_t)); if (!wide) return -1; if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)text.data, (int)text.length, wide, count) != count) { free(wide); return -1; } wide[count] = 0; *output = wide; *wide_length = (size_t)count; return 0; }
static NTSTATUS bmec_fs_nt_open(HANDLE parent, const wchar_t *component, size_t length, ACCESS_MASK access, ULONG disposition, ULONG options, HANDLE *result) { if (!length || length > USHRT_MAX / sizeof(wchar_t)) return (NTSTATUS)0xC0000033L; bmec_nt_create_file_fn create_file = bmec_fs_get_nt_create_file(); if (!create_file) return (NTSTATUS)0xC0000002L; UNICODE_STRING name; name.Length = (USHORT)(length * sizeof(wchar_t)); name.MaximumLength = name.Length; name.Buffer = (PWSTR)component; OBJECT_ATTRIBUTES attributes; memset(&attributes, 0, sizeof(attributes)); attributes.Length = sizeof(attributes); attributes.RootDirectory = parent; attributes.ObjectName = &name; attributes.Attributes = OBJ_CASE_INSENSITIVE; IO_STATUS_BLOCK io; memset(&io, 0, sizeof(io)); return create_file(result, access, &attributes, &io, NULL, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, disposition, options | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT, NULL, 0); }
static bool bmec_fs_component_safe(HANDLE handle, bool directory) { FILE_ATTRIBUTE_TAG_INFO info; if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info))) return false; if (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) return false; return ((info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) == directory; }
static const char *bmec_fs_windows_error(NTSTATUS status, const char *fallback) { intptr_t error = bmec_fs_ntstatus_to_error(status); if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return "not_found"; if (error == ERROR_CANT_ACCESS_FILE || error == ERROR_REPARSE_TAG_INVALID) return "path_outside_root"; if (error == ERROR_INVALID_NAME || error == ERROR_BAD_PATHNAME) return "path_outside_root"; return fallback; }
static HANDLE bmec_fs_open_relative(bmec_filesystem capability, bmec_text path, bool write, const char **error) { wchar_t *wide = NULL; size_t length = 0; if (capability.root_fd == -1 || !path.length || bmec_fs_utf8_to_wide(path, &wide, &length) != 0) { *error = "read_failed"; return INVALID_HANDLE_VALUE; } if (wide[0] == L'/' || wide[0] == L'\\' || (length >= 2 && wide[1] == L':')) { free(wide); *error = "path_outside_root"; return INVALID_HANDLE_VALUE; } HANDLE current = (HANDLE)capability.root_fd; bool owns_current = false; size_t start = 0; HANDLE file = INVALID_HANDLE_VALUE; for (size_t i = 0; i <= length; ++i) { if (i != length && wide[i] != L'/' && wide[i] != L'\\') { if (wide[i] == L':') { *error = "path_outside_root"; goto done; } continue; } if (i == start) { if (i == length) { *error = "read_failed"; goto done; } start = i + 1; continue; } size_t part_length = i - start; bool final = i == length; if (part_length == 1 && wide[start] == L'.') { if (final) { *error = write ? "write_failed" : "read_failed"; goto done; } start = i + 1; continue; } if (part_length == 2 && wide[start] == L'.' && wide[start + 1] == L'.') { *error = "path_outside_root"; goto done; } if (i < length) wide[i] = 0; if (!final) { HANDLE next = NULL; NTSTATUS status = bmec_fs_nt_open(current, wide + start, part_length, FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_OPEN, FILE_DIRECTORY_FILE, &next); if (status < 0) { *error = bmec_fs_windows_error(status, "read_failed"); goto done; } if (!bmec_fs_component_safe(next, true)) { CloseHandle(next); *error = "path_outside_root"; goto done; } if (owns_current) CloseHandle(current); current = next; owns_current = true; start = i + 1; continue; } NTSTATUS status = bmec_fs_nt_open(current, wide + start, part_length, write ? FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE : FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_OPEN, FILE_NON_DIRECTORY_FILE, &file); if (status < 0 && write && (ULONG)status == 0xC0000034u) status = bmec_fs_nt_open(current, wide + start, part_length, FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, FILE_CREATE, FILE_NON_DIRECTORY_FILE, &file); if (status < 0) { *error = bmec_fs_windows_error(status, write ? "write_failed" : "read_failed"); file = INVALID_HANDLE_VALUE; goto done; } if (!bmec_fs_component_safe(file, false)) { CloseHandle(file); file = INVALID_HANDLE_VALUE; *error = "path_outside_root"; goto done; } }
done: if (owns_current) CloseHandle(current); free(wide); return file; }
static bmec_text bmec_fs_read_file(bmec_filesystem capability, bmec_text path, const char **error) { HANDLE file = bmec_fs_open_relative(capability, path, false, error); if (file == INVALID_HANDLE_VALUE) return (bmec_text){ NULL, 0 }; LARGE_INTEGER size; if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || (uint64_t)size.QuadPart > SIZE_MAX) { CloseHandle(file); *error = "read_failed"; return (bmec_text){ NULL, 0 }; } size_t capacity = (size_t)size.QuadPart; unsigned char *buffer = capacity ? (unsigned char *)bmec_arena_alloc(capacity) : NULL; size_t length = 0; while (length < capacity) { DWORD request = capacity - length > MAXDWORD ? MAXDWORD : (DWORD)(capacity - length); DWORD received = 0; if (!ReadFile(file, buffer + length, request, &received, NULL) || !received) { CloseHandle(file); *error = "read_failed"; return (bmec_text){ NULL, 0 }; } length += received; } unsigned char extra; DWORD trailing = 0; BOOL extra_read = ReadFile(file, &extra, 1, &trailing, NULL); CloseHandle(file); if (!extra_read || trailing || !bmec_utf8_valid(buffer, length)) { *error = trailing ? "read_failed" : extra_read ? "invalid_utf8" : "read_failed"; return (bmec_text){ NULL, 0 }; } return (bmec_text){ buffer, length }; }
static const char *bmec_fs_write_file(bmec_filesystem capability, bmec_text path, bmec_text contents) { if (!bmec_utf8_valid(contents.data, contents.length)) return "write_failed"; const char *error = NULL; HANDLE file = bmec_fs_open_relative(capability, path, true, &error); if (file == INVALID_HANDLE_VALUE) return error ? error : "write_failed"; LARGE_INTEGER zero; zero.QuadPart = 0; if (!SetFilePointerEx(file, zero, NULL, FILE_BEGIN) || !SetEndOfFile(file)) { CloseHandle(file); return "write_failed"; } size_t written = 0; while (written < contents.length) { DWORD request = contents.length - written > MAXDWORD ? MAXDWORD : (DWORD)(contents.length - written); DWORD amount = 0; if (!WriteFile(file, contents.data + written, request, &amount, NULL) || !amount) { CloseHandle(file); return "write_failed"; } written += amount; } return CloseHandle(file) ? NULL : "write_failed"; }
#else
typedef char bmec_native_arg;
static bool bmec_fs_arg_equal(const char *argument, const char *ascii) { return strcmp(argument, ascii) == 0; }
static char *bmec_fs_argument_utf8(const char *argument) { size_t length = strlen(argument); if (length == SIZE_MAX) return NULL; char *copy = (char *)malloc(length + 1); if (copy) memcpy(copy, argument, length + 1); return copy; }
static void bmec_fs_close_root(void) {}
static int bmec_fs_init_root(const char *path) { (void)path; return -1; }
static bmec_text bmec_fs_read_file(bmec_filesystem capability, bmec_text path, const char **error) { (void)capability; (void)path; *error = "native_filesystem_unsupported"; return (bmec_text){ NULL, 0 }; }
static const char *bmec_fs_write_file(bmec_filesystem capability, bmec_text path, bmec_text contents) { (void)capability; (void)path; (void)contents; return "native_filesystem_unsupported"; }
#endif
#if defined(__linux__) && !defined(_WIN32) || defined(_WIN32)
static bmec_text bmec_fs_error_text(const char *error) { return (bmec_text){ (const unsigned char *)error, strlen(error) }; }
#endif
`.trim().split("\n");
  const lines: string[] = [
    "#define _GNU_SOURCE",
    "#include <stdbool.h>",
    "#include <stddef.h>",
    "#include <inttypes.h>",
    "#include <stdint.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <limits.h>",
    "#include <math.h>",
    "#include <string.h>",
    "#if defined(_MSC_VER)\n#include <intrin.h>\n#pragma intrinsic(_mul128)\n#endif",
    "#if defined(__linux__) && !defined(_WIN32)",
    "#include <errno.h>",
    "#include <fcntl.h>",
    "#include <linux/openat2.h>",
    "#include <sys/stat.h>",
    "#include <sys/syscall.h>",
    "#include <unistd.h>",
    "#endif",
    "#if defined(_WIN32)",
    "#define WIN32_LEAN_AND_MEAN",
    "#define NOMINMAX",
    "#include <windows.h>",
    "#include <winternl.h>",
    "#endif",
    "",
    "typedef struct { const unsigned char *data; size_t length; } bmec_text;",
    "typedef struct { bmec_text digits; bool negative; } bmec_money;",
    ...(moneyJsonEncodingNeeded ? ["static bmec_text bmec_json_encode_money(bmec_money value);"] : []),
    "typedef struct { bmec_text *data; size_t length; } bmec_text_list;",
    "typedef struct { int64_t *data; size_t length; } bmec_integer_list;",
    "typedef struct { double *data; size_t length; } bmec_number_list;",
    "typedef struct { bool *data; size_t length; } bmec_boolean_list;",
    "typedef struct { intptr_t root_fd; } bmec_filesystem;",
    "typedef union { long double long_double_value; void *pointer_value; int64_t integer_value; double number_value; } bmec_max_align_t;",
    "static bool bmec_utf8_valid(const unsigned char *data, size_t length) { size_t i = 0; while (i < length) { unsigned char a = data[i++]; if (a <= 0x7f) continue; if (a >= 0xc2 && a <= 0xdf) { if (i >= length) return false; unsigned char b = data[i++]; if ((b & 0xc0) != 0x80) return false; continue; } if (a >= 0xe0 && a <= 0xef) { if (i + 1 >= length) return false; unsigned char b = data[i++]; unsigned char c = data[i++]; if ((c & 0xc0) != 0x80 || (a == 0xe0 ? b < 0xa0 || b > 0xbf : a == 0xed ? b < 0x80 || b > 0x9f : (b & 0xc0) != 0x80)) return false; continue; } if (a >= 0xf0 && a <= 0xf4) { if (i + 2 >= length) return false; unsigned char b = data[i++]; unsigned char c = data[i++]; unsigned char d = data[i++]; if ((c & 0xc0) != 0x80 || (d & 0xc0) != 0x80 || (a == 0xf0 ? b < 0x90 || b > 0xbf : a == 0xf4 ? b < 0x80 || b > 0x8f : (b & 0xc0) != 0x80)) return false; continue; } return false; } return true; }",
    "static intptr_t bmec_fs_root_fd = -1;",
    "",
    ...optionalScalarDefinitions,
    ...(optionalScalarDefinitions.length ? [""] : []),
    ...recordDefinitions,
    ...(recordDefinitions.length ? [""] : []),
    ...enumDefinitions,
    ...(enumDefinitions.length ? [""] : []),
    ...optionalCompositeDefinitions,
    ...(optionalCompositeDefinitions.length ? [""] : []),
    ...resultDefinitions,
    ...(resultDefinitions.length ? [""] : []),
    "typedef struct bmec_arena_node { struct bmec_arena_node *next; size_t capacity; size_t used; bmec_max_align_t data_alignment; unsigned char data[]; } bmec_arena_node;",
    "static bmec_arena_node *bmec_arena = NULL;",
    "static size_t bmec_arena_bytes = 0;",
    "static void bmec_fs_close_root(void);",
    "#ifndef BMEC_NATIVE_ARENA_LIMIT",
    "#define BMEC_NATIVE_ARENA_LIMIT 67108864",
    "#endif",
    "static const size_t bmec_arena_limit = BMEC_NATIVE_ARENA_LIMIT;",
    "#ifdef BMEC_NATIVE_ARENA_METRICS",
    "static size_t bmec_arena_allocation_count = 0;",
    "static size_t bmec_arena_total_allocated = 0;",
    "static size_t bmec_arena_peak_bytes = 0;",
    "static void bmec_arena_report(void) { fprintf(stderr, \"BMEC_NATIVE_ARENA_METRICS allocations=%zu allocated_bytes=%zu peak_bytes=%zu\\n\", bmec_arena_allocation_count, bmec_arena_total_allocated, bmec_arena_peak_bytes); }",
    "#else",
    "#define bmec_arena_report() ((void)0)",
    "#endif",
    "static void bmec_arena_release(void) { while (bmec_arena) { bmec_arena_node *node = bmec_arena; bmec_arena = node->next; free(node); } bmec_arena_bytes = 0; }",
    "static void bmec_fail(const char *message);",
    "static void *bmec_arena_alloc(size_t bytes) { if (bytes > bmec_arena_limit - bmec_arena_bytes) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); size_t actual = bytes ? bytes : 1; size_t alignment = _Alignof(bmec_max_align_t); bmec_arena_node *node = bmec_arena; size_t offset = node && node->used <= SIZE_MAX - (alignment - 1) ? (node->used + alignment - 1) & ~(alignment - 1) : SIZE_MAX; if (!node || offset > node->capacity || actual > node->capacity - offset) { if (actual > SIZE_MAX - sizeof(bmec_arena_node)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); size_t capacity = actual > 16384 ? actual : 16384; if (capacity > SIZE_MAX - sizeof(bmec_arena_node)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); node = (bmec_arena_node *)malloc(sizeof(bmec_arena_node) + capacity); if (!node) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation failed\"); node->next = bmec_arena; node->capacity = capacity; node->used = 0; bmec_arena = node; offset = 0; } void *result = node->data + offset; node->used = offset + actual; bmec_arena_bytes += bytes;\n#ifdef BMEC_NATIVE_ARENA_METRICS\n++bmec_arena_allocation_count; bmec_arena_total_allocated += bytes; if (bmec_arena_bytes > bmec_arena_peak_bytes) bmec_arena_peak_bytes = bmec_arena_bytes;\n#endif\nreturn result; }",
    ...(numberJsonEncodingNeeded ? nativeRyuRuntime : [
      'static void d2s_buffered(double value, char *result) { (void)value; (void)result; bmec_fail("PIPE-NATIVE-003: number JSON formatter is unavailable in this program"); }',
    ]),
    ...(jsonDecodeTypes.size ? nativeJsonRuntime : []),
    "static bool bmec_text_equal(bmec_text left, bmec_text right) { return left.length == right.length && (left.length == 0 || memcmp(left.data, right.data, left.length) == 0); }",
    "static bmec_text bmec_text_concat(bmec_text left, bmec_text right) { if (!left.length) return right; if (!right.length) return left; if (right.length > SIZE_MAX - left.length) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); size_t length = left.length + right.length; unsigned char *data = (unsigned char *)bmec_arena_alloc(length); memcpy(data, left.data, left.length); memcpy(data + left.length, right.data, right.length); return (bmec_text){ data, length }; }",
    "static uint32_t bmec_text_next_codepoint(bmec_text text, size_t *cursor) { unsigned char first = text.data[(*cursor)++]; if (first < 0x80) return first; unsigned char second = text.data[(*cursor)++] & 0x3F; if (first < 0xE0) return ((uint32_t)(first & 0x1F) << 6) | second; unsigned char third = text.data[(*cursor)++] & 0x3F; if (first < 0xF0) return ((uint32_t)(first & 0x0F) << 12) | ((uint32_t)second << 6) | third; unsigned char fourth = text.data[(*cursor)++] & 0x3F; return ((uint32_t)(first & 0x07) << 18) | ((uint32_t)second << 12) | ((uint32_t)third << 6) | fourth; }",
    "static int bmec_text_compare_utf16(bmec_text left, bmec_text right) { size_t common = left.length < right.length ? left.length : right.length, i = 0; const uint64_t high_bits = UINT64_C(0x8080808080808080); while (common - i >= sizeof(uint64_t)) { uint64_t lw, rw; memcpy(&lw, left.data + i, sizeof(lw)); memcpy(&rw, right.data + i, sizeof(rw)); if (lw == rw && !((lw | rw) & high_bits)) { i += sizeof(uint64_t); continue; } for (size_t k = 0; k < sizeof(uint64_t); ++k) { unsigned char l = left.data[i + k], r = right.data[i + k]; if ((l | r) >= 0x80) { i += k; goto bmec_text_ascii_prefix_done; } if (l != r) return l < r ? -1 : 1; } i += sizeof(uint64_t); } for (; i < common; ++i) { unsigned char l = left.data[i], r = right.data[i]; if ((l | r) >= 0x80) break; if (l != r) return l < r ? -1 : 1; } bmec_text_ascii_prefix_done: if (i == common) return left.length < right.length ? -1 : left.length > right.length ? 1 : 0; size_t li = i, ri = i; while (li < left.length && ri < right.length) { uint32_t lc = bmec_text_next_codepoint(left, &li), rc = bmec_text_next_codepoint(right, &ri); uint32_t lu = lc <= 0xFFFF ? lc : 0xD800 + ((lc - 0x10000) >> 10); uint32_t ru = rc <= 0xFFFF ? rc : 0xD800 + ((rc - 0x10000) >> 10); if (lu < ru) return -1; if (lu > ru) return 1; if (lc != rc) return lc < rc ? -1 : 1; } return li < left.length ? 1 : ri < right.length ? -1 : 0; }",
    "static int bmec_text_qsort_compare(const void *left, const void *right) { return bmec_text_compare_utf16(*(const bmec_text *)left, *(const bmec_text *)right); }",
    "static bmec_text_list bmec_text_sort(bmec_text_list input) { if (!input.length) return (bmec_text_list){ NULL, 0 }; if (input.length > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *items = (bmec_text *)bmec_arena_alloc(input.length * sizeof(bmec_text)); memcpy(items, input.data, input.length * sizeof(bmec_text)); qsort(items, input.length, sizeof(bmec_text), bmec_text_qsort_compare); return (bmec_text_list){ items, input.length }; }",
    "static bmec_text bmec_json_encode_scalar(const char *kind, bmec_text value, bool quoted) { static const unsigned char prefix[] = \"{\\\"version\\\":1,\\\"kind\\\":\\\"\"; static const unsigned char middle[] = \"\\\",\\\"value\\\":\"; size_t kind_length = strlen(kind), escaped = value.length; if (quoted) for (size_t i = 0; i < value.length; ++i) { unsigned char c = value.data[i]; if (c == '\\\"' || c == '\\\\' || c == '\\b' || c == '\\t' || c == '\\n' || c == '\\f' || c == '\\r') ++escaped; else if (c < 0x20) { if (escaped > SIZE_MAX - 5) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); escaped += 5; } } size_t quote_bytes = quoted ? 2 : 0; size_t base = sizeof(prefix) - 1; if (kind_length > SIZE_MAX - base) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); base += kind_length; if (sizeof(middle) - 1 > SIZE_MAX - base) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); base += sizeof(middle) - 1; if (quote_bytes > SIZE_MAX - base) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); base += quote_bytes; if (base > SIZE_MAX - 2 || escaped > SIZE_MAX - base - 2) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); size_t total = base + escaped + 2; unsigned char *out = (unsigned char *)bmec_arena_alloc(total); size_t at = 0; memcpy(out + at, prefix, sizeof(prefix) - 1); at += sizeof(prefix) - 1; memcpy(out + at, kind, kind_length); at += kind_length; memcpy(out + at, middle, sizeof(middle) - 1); at += sizeof(middle) - 1; if (quoted) out[at++] = '\\\"'; static const char hex[] = \"0123456789abcdef\"; for (size_t i = 0; i < value.length; ++i) { unsigned char c = value.data[i]; if (!quoted) out[at++] = c; else if (c == '\\\"' || c == '\\\\') { out[at++] = '\\\\'; out[at++] = c; } else if (c == '\\b') { out[at++] = '\\\\'; out[at++] = 'b'; } else if (c == '\\t') { out[at++] = '\\\\'; out[at++] = 't'; } else if (c == '\\n') { out[at++] = '\\\\'; out[at++] = 'n'; } else if (c == '\\f') { out[at++] = '\\\\'; out[at++] = 'f'; } else if (c == '\\r') { out[at++] = '\\\\'; out[at++] = 'r'; } else if (c < 0x20) { out[at++] = '\\\\'; out[at++] = 'u'; out[at++] = '0'; out[at++] = '0'; out[at++] = hex[c >> 4]; out[at++] = hex[c & 15]; } else out[at++] = c; } if (quoted) out[at++] = '\\\"'; static const unsigned char suffix[] = \"}\"; memcpy(out + at, suffix, sizeof(suffix) - 1); at += sizeof(suffix) - 1; out[at] = 0; return (bmec_text){ out, at }; }",
    "static bmec_text bmec_json_encode_integer(int64_t value) { char buffer[32]; int length = snprintf(buffer, sizeof(buffer), \"%lld\", (long long)value); return bmec_json_encode_scalar(\"integer\", (bmec_text){ (const unsigned char *)buffer, (size_t)length }, true); }",
    "static bmec_text bmec_json_format_number(double value) { if (!isfinite(value)) bmec_fail(\"PIPE-CONTRACT-001: number must be finite\"); if (value == 0.0) return (bmec_text){ (const unsigned char *)\"0\", 1 }; char shortest[64]; d2s_buffered(value, shortest); char digits[32]; size_t count = 0; bool negative = shortest[0] == '-'; const char *cursor = shortest + (negative ? 1 : 0); int before_decimal = 0; bool saw_decimal = false; int exponent = 0; while (*cursor && *cursor != 'e' && *cursor != 'E') { if (*cursor == '.') { saw_decimal = true; } else { digits[count++] = *cursor; if (!saw_decimal) ++before_decimal; } ++cursor; } if (*cursor) exponent = (int)strtol(cursor + 1, NULL, 10); int decimal = before_decimal + exponent; size_t leading = 0; while (leading + 1 < count && digits[leading] == '0') ++leading; if (leading) { memmove(digits, digits + leading, count - leading); count -= leading; decimal -= (int)leading; } while (count > 1 && digits[count - 1] == '0') --count; digits[count] = 0; char output[400]; size_t at = 0; if (negative) output[at++] = '-'; if (decimal > 0 && decimal <= 21) { if ((size_t)decimal >= count) { memcpy(output + at, digits, count); at += count; for (int i = (int)count; i < decimal; ++i) output[at++] = '0'; } else { memcpy(output + at, digits, (size_t)decimal); at += (size_t)decimal; output[at++] = '.'; memcpy(output + at, digits + decimal, count - (size_t)decimal); at += count - (size_t)decimal; } } else if (decimal <= 0 && decimal > -6) { output[at++] = '0'; output[at++] = '.'; for (int i = 0; i < -decimal; ++i) output[at++] = '0'; memcpy(output + at, digits, count); at += count; } else { output[at++] = digits[0]; if (count > 1) { output[at++] = '.'; memcpy(output + at, digits + 1, count - 1); at += count - 1; } int scientific_exponent = decimal - 1; output[at++] = 'e'; if (scientific_exponent >= 0) output[at++] = '+'; int written = snprintf(output + at, sizeof(output) - at, \"%d\", scientific_exponent); if (written <= 0 || (size_t)written >= sizeof(output) - at) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); at += (size_t)written; } unsigned char *stored = (unsigned char *)bmec_arena_alloc(at); memcpy(stored, output, at); return (bmec_text){ stored, at }; }",
    "static bool bmec_json_try_format_quarter(double value, bmec_text *result) { const double limit = 2251799813685248.0; if (!isfinite(value) || value < -limit || value > limit) return false; double scaled = value * 4.0; if (scaled != trunc(scaled)) return false; int64_t numerator = (int64_t)scaled; bool negative = numerator < 0; uint64_t magnitude = negative ? (uint64_t)(-(numerator + 1)) + UINT64_C(1) : (uint64_t)numerator; uint64_t whole = magnitude / UINT64_C(4); unsigned remainder = (unsigned)(magnitude % UINT64_C(4)); char output[64]; int length = snprintf(output, sizeof(output), \"%s%llu\", negative ? \"-\" : \"\", (unsigned long long)whole); if (length <= 0 || (size_t)length >= sizeof(output)) bmec_fail(\"PIPE-RUNTIME-005: Invalid numeric value\"); size_t at = (size_t)length; if (remainder) { output[at++] = '.'; if (remainder == 1 || remainder == 3) output[at++] = remainder == 1 ? '2' : '7'; if (remainder == 2) output[at++] = '5'; else if (remainder == 1) output[at++] = '5'; else if (remainder == 3) { output[at++] = '5'; } } unsigned char *stored = (unsigned char *)bmec_arena_alloc(at); memcpy(stored, output, at); *result = (bmec_text){ stored, at }; return true; }",
    "static bmec_text bmec_json_encode_number(double value) { bmec_text formatted; if (!isfinite(value)) bmec_fail(\"PIPE-CONTRACT-001: number must be finite\"); if (value == 0.0) formatted = (bmec_text){ (const unsigned char *)\"0\", 1 }; else if (!bmec_json_try_format_quarter(value, &formatted)) formatted = bmec_json_format_number(value); return bmec_json_encode_scalar(\"number\", formatted, false); }",
    "static bmec_text bmec_json_encode_boolean(bool value) { const char *text = value ? \"true\" : \"false\"; return bmec_json_encode_scalar(\"boolean\", (bmec_text){ (const unsigned char *)text, strlen(text) }, false); }",
    "static bmec_text bmec_json_encode_text(bmec_text value) { return bmec_json_encode_scalar(\"text\", value, true); }",
    ...optionalJsonEncodeHelpers,
    ...nativeJsonListEncoders,
    ...recordJsonEncodeHelpers,
    "static bmec_text bmec_base64_encode(bmec_text value) { static const unsigned char alphabet[] = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\"; if (!value.length) return (bmec_text){ NULL, 0 }; size_t groups = value.length / 3 + (value.length % 3 != 0); if (groups > SIZE_MAX / 4) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); size_t length = groups * 4; unsigned char *output = (unsigned char *)bmec_arena_alloc(length); size_t in = 0, out = 0; while (in < value.length) { size_t remaining = value.length - in; uint32_t chunk = (uint32_t)value.data[in++] << 16; if (remaining > 1) chunk |= (uint32_t)value.data[in++] << 8; if (remaining > 2) chunk |= value.data[in++]; output[out++] = alphabet[(chunk >> 18) & 63]; output[out++] = alphabet[(chunk >> 12) & 63]; output[out++] = remaining > 1 ? alphabet[(chunk >> 6) & 63] : '='; output[out++] = remaining > 2 ? alphabet[chunk & 63] : '='; } return (bmec_text){ output, length }; }",
    "static size_t bmec_text_find(bmec_text text, bmec_text needle, size_t start) { if (needle.length == 0 || start > text.length || needle.length > text.length - start) return SIZE_MAX; size_t last = text.length - needle.length; size_t cursor = start; if (needle.length < 5) { while (cursor <= last) { const unsigned char *found = (const unsigned char *)memchr(text.data + cursor, needle.data[0], last - cursor + 1); if (!found) return SIZE_MAX; size_t index = (size_t)(found - text.data); if (memcmp(found, needle.data, needle.length) == 0) return index; cursor = index + 1; } return SIZE_MAX; } size_t anchor = needle.length / 2; while (cursor <= last) { const unsigned char *found = (const unsigned char *)memchr(text.data + cursor + anchor, needle.data[anchor], last - cursor + 1); if (!found) return SIZE_MAX; size_t index = (size_t)(found - text.data) - anchor; if (memcmp(text.data + index, needle.data, needle.length) == 0) return index; cursor = index + 1; } return SIZE_MAX; }",
    "static inline bool bmec_text_contains(bmec_text haystack, bmec_text needle) { if (needle.length == 0) return true; return bmec_text_find(haystack, needle, 0) != SIZE_MAX; }",
    "static inline bool bmec_text_starts_with(bmec_text text, bmec_text prefix) { return prefix.length <= text.length && (prefix.length == 0 || memcmp(text.data, prefix.data, prefix.length) == 0); }",
    "static inline bool bmec_text_ends_with(bmec_text text, bmec_text suffix) { return suffix.length <= text.length && (suffix.length == 0 || memcmp(text.data + text.length - suffix.length, suffix.data, suffix.length) == 0); }",
    "static int64_t bmec_text_length_codepoints(bmec_text text) { size_t points = 0; for (size_t index = 0; index < text.length; ++index) { if ((text.data[index] & 0xC0) == 0x80) continue; if ((uint64_t)points == (uint64_t)INT64_MAX) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); ++points; } return (int64_t)points; }",
    ...textIndexHelpers,
    "static size_t bmec_text_byte_offset(bmec_text text, int64_t codepoint_index) { if (codepoint_index <= 0) return 0; uint64_t seen = 0; for (size_t index = 0; index < text.length; ++index) { if ((text.data[index] & 0xC0) == 0x80) continue; if (seen == (uint64_t)codepoint_index) return index; ++seen; } return text.length; }",
    "static bmec_text bmec_text_substring(bmec_text text, int64_t start, int64_t end) { if (start < 0 || end < start) bmec_fail(\"PIPE-RUNTIME-002: substring expects text and non-negative start/end integers with start <= end\"); size_t begin = bmec_text_byte_offset(text, start); size_t limit = bmec_text_byte_offset(text, end); return (bmec_text){ text.data ? text.data + begin : NULL, limit - begin }; }",
    "static bmec_text_list bmec_text_split_empty(bmec_text text) { if (!text.length) return (bmec_text_list){ NULL, 0 }; size_t count = 0; for (size_t i = 0; i < text.length; ++i) { unsigned char byte = text.data[i]; if ((byte & 0xC0) != 0x80) { if ((byte & 0xF8) == 0xF0) bmec_fail(\"PIPE-NATIVE-003: split with an empty separator cannot represent UTF-16 surrogate units\"); ++count; } } if (count > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *items = (bmec_text *)bmec_arena_alloc(count * sizeof(bmec_text)); size_t index = 0, start = 0; for (size_t i = 0; i < text.length; ++i) if ((text.data[i] & 0xC0) != 0x80) { if (index) items[index - 1].length = i - start; items[index++] = (bmec_text){ text.data + i, 0 }; start = i; } if (index) items[index - 1].length = text.length - start; return (bmec_text_list){ items, index }; }",
    "static bmec_text_list bmec_text_split_byte(bmec_text text, unsigned char separator) { size_t count = 1, cursor = 0; while (cursor < text.length) { const unsigned char *found = (const unsigned char *)memchr(text.data + cursor, separator, text.length - cursor); if (!found) break; if (count == SIZE_MAX) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); ++count; cursor = (size_t)(found - text.data) + 1; } if (count > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *items = (bmec_text *)bmec_arena_alloc(count * sizeof(bmec_text)); cursor = 0; size_t index = 0; while (cursor < text.length) { const unsigned char *found = (const unsigned char *)memchr(text.data + cursor, separator, text.length - cursor); if (!found) break; size_t end = (size_t)(found - text.data); items[index++] = (bmec_text){ text.data + cursor, end - cursor }; cursor = end + 1; } items[index++] = (bmec_text){ text.data ? text.data + cursor : NULL, text.length - cursor }; return (bmec_text_list){ items, index }; }",
    "static bmec_text_list bmec_text_split(bmec_text text, bmec_text separator) { if (!separator.length) return bmec_text_split_empty(text); if (separator.length == 1) return bmec_text_split_byte(text, separator.data[0]); size_t count = 1, cursor = 0, found; while ((found = bmec_text_find(text, separator, cursor)) != SIZE_MAX) { if (count == SIZE_MAX) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); ++count; cursor = found + separator.length; } if (count > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *items = (bmec_text *)bmec_arena_alloc(count * sizeof(bmec_text)); cursor = 0; size_t index = 0; while ((found = bmec_text_find(text, separator, cursor)) != SIZE_MAX) { items[index++] = (bmec_text){ text.data ? text.data + cursor : NULL, found - cursor }; cursor = found + separator.length; } items[index++] = (bmec_text){ text.data ? text.data + cursor : NULL, text.length - cursor }; return (bmec_text_list){ items, index }; }",
    "static bmec_text_list bmec_text_list_copy(const bmec_text *items, size_t length) { if (!length) return (bmec_text_list){ NULL, 0 }; if (length > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *copy = (bmec_text *)bmec_arena_alloc(length * sizeof(bmec_text)); memcpy(copy, items, length * sizeof(bmec_text)); return (bmec_text_list){ copy, length }; }",
    "static int bmec_integer_qsort_compare(const void *left, const void *right) { int64_t a = *(const int64_t *)left, b = *(const int64_t *)right; return a < b ? -1 : a > b ? 1 : 0; }",
    "static bmec_integer_list bmec_integer_sort(bmec_integer_list input) { if (!input.length) return (bmec_integer_list){ NULL, 0 }; if (input.length > SIZE_MAX / sizeof(int64_t)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); int64_t *items = (int64_t *)bmec_arena_alloc(input.length * sizeof(int64_t)); memcpy(items, input.data, input.length * sizeof(int64_t)); qsort(items, input.length, sizeof(int64_t), bmec_integer_qsort_compare); return (bmec_integer_list){ items, input.length }; }",
    "static void bmec_number_heap_sift(double *items, size_t root, size_t length) { while (root < length / 2) { size_t child = root * 2 + 1; if (child + 1 < length && items[child] < items[child + 1]) ++child; if (!(items[root] < items[child])) return; double value = items[root]; items[root] = items[child]; items[child] = value; root = child; } }",
    "static void bmec_number_heap_sort(double *items, size_t length) { for (size_t start = length / 2; start > 0;) bmec_number_heap_sift(items, --start, length); for (size_t end = length; end > 1;) { --end; double value = items[0]; items[0] = items[end]; items[end] = value; bmec_number_heap_sift(items, 0, end); } }",
    "static double bmec_number_median(double a, double b, double c) { if (a < b) { if (b < c) return b; return a < c ? c : a; } if (a < c) return a; return b < c ? c : b; }",
    "static void bmec_number_intro_range(double *items, size_t lo, size_t hi, size_t depth) { while (hi - lo > 16) { if (!depth) { bmec_number_heap_sort(items + lo, hi - lo); return; } --depth; double pivot = bmec_number_median(items[lo], items[lo + (hi - lo) / 2], items[hi - 1]); size_t less = lo, cursor = lo, greater = hi; while (cursor < greater) { if (items[cursor] < pivot) { double value = items[less]; items[less++] = items[cursor]; items[cursor++] = value; } else if (items[cursor] > pivot) { double value = items[--greater]; items[greater] = items[cursor]; items[cursor] = value; } else ++cursor; } if (less - lo < hi - greater) { bmec_number_intro_range(items, lo, less, depth); lo = greater; } else { bmec_number_intro_range(items, greater, hi, depth); hi = less; } } for (size_t i = lo + 1; i < hi; ++i) { double value = items[i]; size_t j = i; while (j > lo && value < items[j - 1]) { items[j] = items[j - 1]; --j; } items[j] = value; } }",
    "static void bmec_number_intro_sort(double *items, size_t length) { size_t depth = 0; for (size_t n = length; n > 1; n >>= 1) depth += 2; bmec_number_intro_range(items, 0, length, depth); }",
    "static int bmec_number_qsort_compare(const void *left, const void *right) { double a = *(const double *)left, b = *(const double *)right; return a < b ? -1 : a > b ? 1 : 0; }",
    "static bmec_number_list bmec_number_sort(bmec_number_list input) { if (!input.length) return (bmec_number_list){ NULL, 0 }; if (input.length > SIZE_MAX / sizeof(double)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); double *items = (double *)bmec_arena_alloc(input.length * sizeof(double)); memcpy(items, input.data, input.length * sizeof(double)); bmec_number_intro_sort(items, input.length); return (bmec_number_list){ items, input.length }; }",
    ...[...nativeMapSignatures.values()].map(([input, output]) => nativeMapHelper(input, output)),
    "static bmec_text_list bmec_text_filter(bmec_text_list input, bool (*predicate)(bmec_text)) { if (!input.length) return (bmec_text_list){ NULL, 0 }; if (input.length > SIZE_MAX / sizeof(bmec_text)) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); bmec_text *items = (bmec_text *)bmec_arena_alloc(input.length * sizeof(bmec_text)); size_t count = 0; for (size_t i = 0; i < input.length; ++i) if (predicate(input.data[i])) items[count++] = input.data[i]; return (bmec_text_list){ items, count }; }",
    "static int64_t bmec_text_fold_integer(bmec_text_list input, int64_t accumulator, int64_t (*callback)(int64_t, bmec_text)) { for (size_t i = 0; i < input.length; ++i) accumulator = callback(accumulator, input.data[i]); return accumulator; }",
    "static bmec_text bmec_text_join(bmec_text_list list, bmec_text separator) { size_t total = 0; for (size_t i = 0; i < list.length; ++i) { if (list.data[i].length > SIZE_MAX - total) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); total += list.data[i].length; if (i && separator.length > SIZE_MAX - total) bmec_fail(\"PIPE-RUNTIME-007: Native invocation allocation limit exceeded\"); if (i) total += separator.length; } if (!total) return (bmec_text){ NULL, 0 }; unsigned char *buffer = (unsigned char *)bmec_arena_alloc(total); size_t offset = 0; for (size_t i = 0; i < list.length; ++i) { if (i && separator.length) { memcpy(buffer + offset, separator.data, separator.length); offset += separator.length; } if (list.data[i].length) { memcpy(buffer + offset, list.data[i].data, list.data[i].length); offset += list.data[i].length; } } return (bmec_text){ buffer, total }; }",
    "",
    "static int64_t bmec_steps = 0;",
    "static int64_t bmec_depth = 0;",
    "static void bmec_fail(const char *message) { bmec_arena_report(); bmec_arena_release(); bmec_fs_close_root(); fputs(message, stderr); fputc('\\n', stderr); exit(70); }",
    ...resultAccessors,
    ...jsonDecodeHelpers,
    ...filesystemRuntime,
    ...base64DecodeHelpers,
    "static void bmec_json_text(bmec_text text) { putchar('\\\"'); for (size_t i = 0; i < text.length; ++i) { unsigned char c = text.data[i]; if (c == '\\\"' || c == '\\\\') { putchar('\\\\'); putchar(c); } else if (c == '\\n') fputs(\"\\\\n\", stdout); else if (c == '\\r') fputs(\"\\\\r\", stdout); else if (c == '\\t') fputs(\"\\\\t\", stdout); else if (c < 0x20) printf(\"\\\\u%04x\", c); else putchar(c); } putchar('\\\"'); }",
    ...filesystemResultHelpers,
    "#define bmec_step() do { if (++bmec_steps > 100000) bmec_fail(\"PIPE-RUNTIME-006: Maximum execution steps exceeded\"); } while (0)",
    "static void bmec_step_many(int64_t count) { if (count < 1 || count > 100000 || bmec_steps > 100000 - count) bmec_fail(\"PIPE-RUNTIME-006: Maximum execution steps exceeded\"); bmec_steps += count; }",
    "#if defined(_MSC_VER)\nstatic int64_t bmec_add(int64_t a, int64_t b) { if ((b > 0 && a > INT64_MAX - b) || (b < 0 && a < INT64_MIN - b)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return a + b; }\nstatic int64_t bmec_sub(int64_t a, int64_t b) { if ((b < 0 && a > INT64_MAX + b) || (b > 0 && a < INT64_MIN + b)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return a - b; }\nstatic int64_t bmec_mul(int64_t a, int64_t b) { int64_t high; int64_t low = _mul128(a, b, &high); if (high != (low < 0 ? -1 : 0)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return low; }\n#else\nstatic int64_t bmec_add(int64_t a, int64_t b) { int64_t out; if (__builtin_add_overflow(a, b, &out)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return out; }\nstatic int64_t bmec_sub(int64_t a, int64_t b) { int64_t out; if (__builtin_sub_overflow(a, b, &out)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return out; }\nstatic int64_t bmec_mul(int64_t a, int64_t b) { int64_t out; if (__builtin_mul_overflow(a, b, &out)) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return out; }\n#endif",
    "static int64_t bmec_mul3_add1(int64_t value) { const int64_t low = INT64_MIN / 3; const int64_t high = (INT64_MAX - 1) / 3; const uint64_t offset = (uint64_t)value - (uint64_t)low; const uint64_t width = (uint64_t)high - (uint64_t)low; if (offset > width) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return value * 3 + 1; }",
    "static int64_t bmec_div(int64_t a, int64_t b) { if (!b) bmec_fail(\"PIPE-RUNTIME-003: Division by zero\"); if (a == INT64_MIN && b == -1) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\"); return a / b; }",
    "static int64_t bmec_mod(int64_t a, int64_t b) { if (!b) bmec_fail(\"PIPE-RUNTIME-003: Division by zero\"); if (a == INT64_MIN && b == -1) return 0; return a % b; }",
    ...(nativeMoneyNeeded ? nativeMoneyRuntime : []),
    ...(moneyJsonEncodingNeeded ? [String.raw`static bmec_text bmec_json_encode_money(bmec_money value) {
  static const unsigned char prefix[] = "{\"version\":1,\"kind\":\"money\",\"minor\":\"";
  static const unsigned char suffix[] = "\",\"scale\":2}";
  static const unsigned char positive_limit[] = "9223372036854775807";
  static const unsigned char negative_limit[] = "9223372036854775808";
  size_t digits_length = value.digits.length ? value.digits.length : 1;
  bool negative = value.negative && !(value.digits.length == 0 || (value.digits.length == 1 && value.digits.data[0] == '0'));
  const unsigned char *limit = negative ? negative_limit : positive_limit;
  if (value.digits.length > sizeof(positive_limit) - 1 ||
      (value.digits.length == sizeof(positive_limit) - 1 && memcmp(value.digits.data, limit, sizeof(positive_limit) - 1) > 0))
    bmec_fail("PIPE-CONTRACT-001: integer outside signed int64 range");
  size_t prefix_length = sizeof(prefix) - 1, suffix_length = sizeof(suffix) - 1;
  size_t sign_length = negative ? 1 : 0;
  if (prefix_length > SIZE_MAX - suffix_length || sign_length > SIZE_MAX - prefix_length - suffix_length || digits_length > SIZE_MAX - prefix_length - suffix_length - sign_length)
    bmec_fail("PIPE-RUNTIME-007: Native invocation allocation limit exceeded");
  size_t length = prefix_length + sign_length + digits_length + suffix_length;
  unsigned char *output = (unsigned char *)bmec_arena_alloc(length);
  size_t at = 0;
  memcpy(output + at, prefix, prefix_length); at += prefix_length;
  if (negative) output[at++] = '-';
  if (value.digits.length) { memcpy(output + at, value.digits.data, value.digits.length); at += value.digits.length; }
  else output[at++] = '0';
  memcpy(output + at, suffix, suffix_length); at += suffix_length;
  return (bmec_text){ output, at };
}`] : []),
    "static double bmec_number(double value) { if (!isfinite(value)) bmec_fail(\"PIPE-RUNTIME-005: Invalid numeric value\"); return value; }",
    "static double bmec_number_add(double a, double b) { return bmec_number(a + b); }",
    "static double bmec_number_sub(double a, double b) { return bmec_number(a - b); }",
    "static double bmec_number_mul(double a, double b) { return bmec_number(a * b); }",
    "static double bmec_number_div(double a, double b) { if (b == 0.0) bmec_fail(\"PIPE-RUNTIME-003: Division by zero\"); return bmec_number(a / b); }",
    "static double bmec_number_mod(double a, double b) { if (b == 0.0) bmec_fail(\"PIPE-RUNTIME-003: Division by zero\"); return bmec_number(fmod(a, b)); }",
    "",
  ];
  for (const fn of functions) {
    const result = typeName(fn.returnTypeRef, String(fn.id));
    const params = fn.parameters.map((parameter, index) => `${typeName(parameter.typeRef, String(fn.id))} ${cName("bmec_v", `${fn.id}:parameter:${index}`)}`).join(", ") || "void";
    const inline = String(fn.id).startsWith("LAMBDA-") ? "static inline " : "";
    lines.push(`${inline}${result} ${names.get(String(fn.id))}(${params});`);
  }
  lines.push("");

  for (const fn of functions) {
    const identity = String(fn.id);
    const resultType = typeName(fn.returnTypeRef, identity);
    const parameterCNames = new Map(fn.parameters.map((parameter, index) => [parameter.name, cName("bmec_v", `${identity}:parameter:${index}`)]));
    const slotTypes = new Map<string, TypeRef>();
    fn.parameters.forEach((parameter, index) => slotTypes.set(`${identity}:parameter:${index}`, parameter.typeRef));
    const paramList = fn.parameters.map((parameter, index) => `${typeName(parameter.typeRef, identity)} ${cName("bmec_v", `${identity}:parameter:${index}`)}`).join(", ") || "void";
    const localIds = new WeakMap<CoreStatement, string>();
    let localOrdinal = 0;
    const collectLocals = (statements: CoreStatement[]) => {
      for (const statement of statements) {
        if (statement.kind === "let" || statement.kind === "for") localIds.set(statement, localIdentity(identity, ++localOrdinal));
        if (statement.kind === "if") {
          collectLocals(statement.thenBody);
          if (statement.elseBody) collectLocals(statement.elseBody);
        } else if (statement.kind === "for" || statement.kind === "while" || statement.kind === "repeat") collectLocals(statement.body);
      }
    };
    collectLocals(fn.body);
    let tempOrdinal = 0;
    const variableFor = (id: string) => cName("bmec_v", id);
    const preparedExpressions = new WeakMap<CoreExpr, string>();
    const identifierAliases = new Map<string, string>();
    const intLiteral = (raw: string | number | boolean | undefined) => {
      if (typeof raw !== "string" && typeof raw !== "number")
        throw new NativeLoweringError(`Native integer literal is invalid in ${identity}`);
      let value: bigint;
      try { value = BigInt(raw); } catch { throw new NativeLoweringError(`Native integer literal ${raw} is invalid in ${identity}`); }
      if (value < I64_MIN || value > I64_MAX) throw new NativeLoweringError(`Native integer literal ${raw} is outside signed int64 in ${identity}`);
      return value === I64_MIN ? "INT64_MIN" : value === I64_MAX ? "INT64_MAX" : `INT64_C(${value})`;
    };
    const constantNumber = (value: CoreExpr): number | undefined => {
      if (value.typeRef.kind !== "primitive" || value.typeRef.name !== "number") return undefined;
      if (value.kind === "literal") {
        const number = Number(value.value);
        return Number.isFinite(number) ? number : undefined;
      }
      if (value.kind === "unary" && value.operator === "-") {
        const operand = value.operand ? constantNumber(value.operand) : undefined;
        return operand === undefined ? undefined : -operand;
      }
      if (value.kind !== "binary" || !value.left || !value.right) return undefined;
      const left = constantNumber(value.left);
      const right = constantNumber(value.right);
      if (left === undefined || right === undefined) return undefined;
      let result: number;
      switch (value.operator) {
        case "+": result = left + right; break;
        case "-": result = left - right; break;
        case "*": result = left * right; break;
        case "/": if (right === 0) return undefined; result = left / right; break;
        case "%": if (right === 0) return undefined; result = left % right; break;
        default: return undefined;
      }
      return Number.isFinite(result) ? result : undefined;
    };
    const emitExpr = (expr: CoreExpr, expectedType?: TypeRef): string => {
      const prepared = preparedExpressions.get(expr);
      if (prepared) return prepared;
      if (expr.kind === "none") {
        if (expectedType?.kind !== "optional") throw new NativeLoweringError(`Native none requires an optional context in ${identity}`);
        return `((${typeName(expectedType, identity)}){ .present = false })`;
      }
      if (expr.kind === "literal") {
        if (expr.typeRef.kind !== "primitive") throw new NativeLoweringError(`Native literal type is unsupported in ${identity}`);
        if (expr.typeRef.name === "integer") return intLiteral(expr.value);
        if (expr.typeRef.name === "money") {
          let minor: bigint;
          try { minor = BigInt(String(expr.value)); }
          catch { throw new NativeLoweringError(`Native money literal ${String(expr.value)} is invalid in ${identity}`); }
          const negative = minor < 0n;
          const digits = (negative ? -minor : minor).toString();
          return `(bmec_money){ .digits = { (const unsigned char *)${cStringLiteral(digits)}, ${digits.length} }, .negative = ${negative ? "true" : "false"} }`;
        }
        if (expr.typeRef.name === "text") {
          if (typeof expr.value !== "string") throw new NativeLoweringError(`Native text literal is invalid in ${identity}`);
          const bytes = new TextEncoder().encode(expr.value);
          const literal = [...bytes].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
          return `((bmec_text){ .data = (const unsigned char *)"${literal}", .length = ${bytes.length} })`;
        }
        if (expr.typeRef.name === "number") {
          const value = Number(expr.value);
          if (!Number.isFinite(value)) throw new NativeLoweringError(`Native number literal ${expr.value} is invalid in ${identity}`);
          const literal = String(value);
          return /[.eE]/.test(literal) ? literal : `${literal}.0`;
        }
        if (expr.typeRef.name === "boolean" && typeof expr.value === "boolean") return expr.value ? "true" : "false";
        throw new NativeLoweringError(`Native primitive slice does not support ${expr.typeRef.name} literals in ${identity}`);
      }
      if (expr.kind === "identifier") {
        if (!expr.symbolId) throw new NativeLoweringError(`Native identifier ${expr.name ?? "?"} has no canonical binding in ${identity}`);
        const id = String(expr.symbolId);
        const alias = identifierAliases.get(id);
        if (alias) return alias;
        const variable = variableFor(id);
        const slotType = slotTypes.get(id);
        if (slotType?.kind === "optional" && expr.typeRef.kind !== "optional") return `(${variable}).value`;
        return variable;
      }
      if (expr.kind === "enum") {
        if (expr.typeRef.kind !== "enum" || !expr.variant)
          throw new NativeLoweringError(`Native enum construction has no canonical enum TypeRef in ${identity}`);
        const variantIndex = expr.typeRef.variants.findIndex((variant) => variant.name === expr.variant);
        const variant = expr.typeRef.variants[variantIndex];
        if (!variant || variantIndex < 0)
          throw new NativeLoweringError(`Native enum ${expr.typeRef.name} has no variant ${expr.variant} in ${identity}`);
        const args = expr.args ?? [];
        if ((variant.payload === undefined && args.length !== 0) || (variant.payload !== undefined && args.length !== 1))
          throw new NativeLoweringError(`Native enum variant ${expr.variant} has an invalid payload shape in ${identity}`);
        const tag = `.tag = ${variantIndex}`;
        if (!variant.payload) return `((${typeName(expr.typeRef, identity)}){ ${tag} })`;
        if (!isSameType(args[0]!.typeRef, variant.payload))
          throw new NativeLoweringError(`Native enum variant ${expr.variant} payload has a mismatched TypeRef in ${identity}`);
        const field = cName("bmec_variant", expr.variant);
        return `((${typeName(expr.typeRef, identity)}){ ${tag}, .payload.${field} = ${emitExpr(args[0]!, variant.payload)} })`;
      }
      if (expr.kind === "record") {
        if (expr.typeRef.kind !== "record") throw new NativeLoweringError(`Native record construction has no plain-record TypeRef in ${identity}`);
        const alias = recordAliases.get(expr.typeRef.symbol);
        const schema = schemas.get(expr.typeRef.symbol);
        if (!alias || !schema) throw new NativeLoweringError(`Native record schema ${expr.typeRef.symbol} is unavailable in ${identity}`);
        const supplied = new Map((expr.fields ?? []).map((field) => [field.name, field.value]));
        const initializers = Object.entries(schema.fields).map(([field, type]) => {
          const value = supplied.get(field);
          if (!value) throw new NativeLoweringError(`Native record ${schema.name} is missing field ${field} in ${identity}`);
          if (!pureRecordFieldValue(value))
            throw new NativeLoweringError(`Native record constructor fields must be side-effect-free scalars in ${identity}`);
          if (!isSameType(value.typeRef, type)) throw new NativeLoweringError(`Native record field ${schema.name}.${field} has a mismatched typed IR value in ${identity}`);
          return `.${cName("bmec_field", field)} = ${emitExpr(value)}`;
        });
        if (supplied.size !== Object.keys(schema.fields).length) throw new NativeLoweringError(`Native record ${schema.name} has an unsupported field set in ${identity}`);
        return `((${alias}){ ${initializers.join(", ")} })`;
      }
      if (expr.kind === "field") {
        const schemaType = expr.object?.typeRef;
        if (schemaType?.kind === "result") {
          if (expr.field === "value") return `${cName("bmec_result_value", JSON.stringify(schemaType))}(${emitExpr(expr.object!)})`;
          if (expr.field === "error") return `${cName("bmec_result_error", JSON.stringify(schemaType))}(${emitExpr(expr.object!)})`;
          throw new NativeLoweringError(`Native Result has no field ${expr.field ?? "?"} in ${identity}`);
        }
        if (schemaType?.kind !== "record") throw new NativeLoweringError(`Native field access requires a plain record in ${identity}`);
        const schema = schemas.get(schemaType.symbol);
        if (!schema || !(expr.field! in schema.fields)) throw new NativeLoweringError(`Native record field ${expr.field ?? "?"} is unavailable in ${identity}`);
        return `(${emitExpr(expr.object!) }).${cName("bmec_field", expr.field!)}`;
      }
      if (expr.kind === "unary") {
        const operand = emitExpr(expr.operand!);
        if (expr.operator === "not") return `(!(${operand}))`;
        if (expr.operator === "-" && expr.operand!.typeRef.kind === "primitive" && expr.operand!.typeRef.name === "money")
          return `bmec_money_negate(${operand})`;
        if (expr.operator === "-") return expr.operand!.typeRef.kind === "primitive" && expr.operand!.typeRef.name === "number"
          ? `(-(${operand}))`
          : `bmec_sub(INT64_C(0), ${operand})`;
        throw new NativeLoweringError(`Native unary operator ${expr.operator} is not supported in ${identity}`);
      }
      if (expr.kind === "binary") {
        const leftType = expr.left!.typeRef;
        const rightType = expr.right!.typeRef;
        if (expr.typeRef.kind === "primitive" && expr.typeRef.name === "number" &&
            ["+", "-", "*", "/", "%"].includes(expr.operator ?? "")) {
          const folded = constantNumber(expr);
          if (folded !== undefined) {
            const literal = Object.is(folded, -0) ? "-0.0" : String(folded);
            return /[.eE]/.test(literal) ? literal : `${literal}.0`;
          }
        }
        if (expr.operator === "==" || expr.operator === "!=") {
          if (leftType.kind === "none" && rightType.kind === "none") return expr.operator === "==" ? "true" : "false";
          const optionalExpr = leftType.kind === "optional" ? expr.left! : rightType.kind === "optional" ? expr.right! : undefined;
          const otherType = optionalExpr === expr.left ? rightType : optionalExpr === expr.right ? leftType : undefined;
          if (optionalExpr && otherType?.kind === "none") {
            const present = `((${emitExpr(optionalExpr)}).present)`;
            return expr.operator === "==" ? `(!${present})` : present;
          }
          if (leftType.kind === "optional" && rightType.kind === "optional") {
            if (expr.left!.kind !== "identifier" || expr.right!.kind !== "identifier")
              throw new NativeLoweringError(`Native optional equality currently requires local identifiers in ${identity}`);
            if (!isSameType(leftType, rightType)) throw new NativeLoweringError(`Native optional equality has mismatched TypeRefs in ${identity}`);
            const leftName = emitExpr(expr.left!);
            const rightName = emitExpr(expr.right!);
            const equal = `((${leftName}).present == (${rightName}).present && (!(${leftName}).present || (${leftName}).value == (${rightName}).value))`;
            return expr.operator === "==" ? equal : `(!${equal})`;
          }
          if (leftType.kind === "primitive" && rightType.kind === "primitive" &&
              leftType.name === "text" && rightType.name === "text") {
            const equal = `bmec_text_equal(${emitExpr(expr.left!)}, ${emitExpr(expr.right!)})`;
            return expr.operator === "==" ? equal : `(!${equal})`;
          }
          if (leftType.kind === "primitive" && rightType.kind === "primitive" &&
              leftType.name === "money" && rightType.name === "money") {
            const equal = `(bmec_money_compare(${emitExpr(expr.left!)}, ${emitExpr(expr.right!)}) == 0)`;
            return expr.operator === "==" ? equal : `(!${equal})`;
          }
        }
        // The unsigned interval guard checks the product before adding one, so
        // this fusion preserves both checked-int64 operations without UB.
        if (expr.operator === "+" && expr.typeRef.kind === "primitive" && expr.typeRef.name === "integer" &&
            expr.right!.kind === "literal" && emitExpr(expr.right!) === "INT64_C(1)" &&
            expr.left!.kind === "binary" && expr.left!.operator === "*" &&
            expr.left!.typeRef.kind === "primitive" && expr.left!.typeRef.name === "integer") {
          const product = expr.left!;
          const factorIsThree = (value: CoreExpr) => value.kind === "literal" && value.typeRef.kind === "primitive" &&
            value.typeRef.name === "integer" && emitExpr(value) === "INT64_C(3)";
          const operand = factorIsThree(product.left!) ? product.right! : factorIsThree(product.right!) ? product.left! : undefined;
          if (operand?.kind === "identifier" && operand.typeRef.kind === "primitive" && operand.typeRef.name === "integer")
            return `bmec_mul3_add1(${emitExpr(operand)})`;
        }
        const left = emitExpr(expr.left!);
        const right = emitExpr(expr.right!);
        if (leftType.kind === "primitive" && leftType.name === "money") {
          if (rightType.kind === "primitive" && rightType.name === "money") {
            if (expr.operator === "+") return `bmec_money_add(${left}, ${right})`;
            if (expr.operator === "-") return `bmec_money_add(${left}, bmec_money_negate(${right}))`;
            if (["<", "<=", ">", ">="].includes(expr.operator ?? "")) {
              const operators: Record<string, string> = { "<": "< 0", "<=": "<= 0", ">": "> 0", ">=": ">= 0" };
              return `(bmec_money_compare(${left}, ${right}) ${operators[expr.operator!]})`;
            }
          }
          if (rightType.kind === "primitive" && rightType.name === "integer") {
            if (expr.operator === "*") return `bmec_money_multiply_integer(${left}, ${right})`;
            if (expr.operator === "/") return `bmec_money_divide_integer(${left}, ${right})`;
          }
          throw new NativeLoweringError(`Native money operator ${expr.operator} has unsupported operands in ${identity}`);
        }
        if (rightType.kind === "primitive" && rightType.name === "money")
          throw new NativeLoweringError(`Native binary operation ${expr.operator} has unsupported operands in ${identity}`);
        if (expr.operator === "+" && leftType.kind === "primitive" && leftType.name === "text" &&
            rightType.kind === "primitive" && rightType.name === "text" && expr.typeRef.kind === "primitive" && expr.typeRef.name === "text")
          return `bmec_text_concat(${left}, ${right})`;
        if (leftType.kind !== "primitive" || !["integer", "number", "boolean"].includes(leftType.name))
          throw new NativeLoweringError(`Native binary operation ${expr.operator} has unsupported operands in ${identity}`);
        const operators: Record<string, string> = { "==": "==", "!=": "!=", "<": "<", "<=": "<=", ">": ">", ">=": ">=", and: "&&", or: "||" };
        if (expr.operator === "+" || expr.operator === "-" || expr.operator === "*" || expr.operator === "/" || expr.operator === "%") {
          if (leftType.name === "number") {
            const helpers: Record<string, string> = { "+": "bmec_number_add", "-": "bmec_number_sub", "*": "bmec_number_mul", "/": "bmec_number_div", "%": "bmec_number_mod" };
            return `${helpers[expr.operator]}(${left}, ${right})`;
          }
          if (leftType.name !== "integer") throw new NativeLoweringError(`Native arithmetic requires numeric operands in ${identity}`);
          const helpers: Record<string, string> = { "+": "bmec_add", "-": "bmec_sub", "*": "bmec_mul", "/": "bmec_div", "%": "bmec_mod" };
          return `${helpers[expr.operator]}(${left}, ${right})`;
        }
        const op = operators[expr.operator ?? ""];
        if (!op) throw new NativeLoweringError(`Native binary operator ${expr.operator} is not supported in ${identity}`);
        return `((${left}) ${op} (${right}))`;
      }
      if (expr.kind === "call") {
        if (expr.callee === "some") {
          if (expr.typeRef.kind !== "optional" || expr.args?.length !== 1 || !isSameType(expr.args[0]!.typeRef, expr.typeRef.inner))
            throw new NativeLoweringError(`Native some requires one value matching its optional payload in ${identity}`);
          return `((${typeName(expr.typeRef, identity)}){ .present = true, .value = ${emitExpr(expr.args[0]!, expr.typeRef.inner)} })`;
        }
        if (expr.callee === "isSome" || expr.callee === "isNone") {
          const arg = expr.args?.[0];
          if (expr.args?.length !== 1 || arg?.typeRef.kind !== "optional")
            throw new NativeLoweringError(`Native ${expr.callee} requires one supported optional value in ${identity}`);
          const present = `((${emitExpr(arg)}).present)`;
          return expr.callee === "isSome" ? present : `(!${present})`;
        }
        if (expr.callee === "ok" || expr.callee === "err") {
          if (expr.typeRef.kind !== "result" || expr.args?.length !== 1)
            throw new NativeLoweringError(`Native ${expr.callee} requires one value and a Result context in ${identity}`);
          const isOk = expr.callee === "ok";
          const payloadType = isOk ? expr.typeRef.ok : expr.typeRef.error;
          if (!isSameType(expr.args[0]!.typeRef, payloadType))
            throw new NativeLoweringError(`Native ${expr.callee} payload has a mismatched TypeRef in ${identity}`);
          const payload = isOk ? "ok" : "error";
          return `((${typeName(expr.typeRef, identity)}){ .is_ok = ${isOk ? "true" : "false"}, .payload.${payload} = ${emitExpr(expr.args[0]!, payloadType)} })`;
        }
        if (expr.callee === "isOk" || expr.callee === "isErr") {
          const arg = expr.args?.[0];
          if (expr.args?.length !== 1 || arg?.typeRef.kind !== "result")
            throw new NativeLoweringError(`Native ${expr.callee} requires one supported Result value in ${identity}`);
          const success = `((${emitExpr(arg)}).is_ok)`;
          return expr.callee === "isOk" ? success : `(!${success})`;
        }
        if (expr.callee === "readTextFile" || expr.callee === "writeTextFile") {
          const expected = expr.callee === "readTextFile" ? 2 : 3;
          if (expr.args?.length !== expected || expr.args[0]?.typeRef.kind !== "capability" || expr.args[0].typeRef.name !== "filesystem" ||
              expr.args[1]?.typeRef.kind !== "primitive" || expr.args[1].typeRef.name !== "text")
            throw new NativeLoweringError(`Native ${expr.callee} requires filesystem capability and text path in ${identity}`);
          const helper = expr.callee === "readTextFile" ? "bmec_builtin_readTextFile" : "bmec_builtin_writeTextFile";
          return `${helper}(${expr.args.map((arg) => emitExpr(arg)).join(", ")})`;
        }
        if (expr.callee === "textContains") {
          const [haystack, needle] = expr.args ?? [];
          if (expr.args?.length !== 2 || haystack?.typeRef.kind !== "primitive" || haystack.typeRef.name !== "text" ||
              needle?.typeRef.kind !== "primitive" || needle.typeRef.name !== "text")
            throw new NativeLoweringError(`Native textContains requires two text values in ${identity}`);
          return `bmec_text_contains(${emitExpr(haystack)}, ${emitExpr(needle)})`;
        }
        if (expr.callee === "startsWith" || expr.callee === "endsWith") {
          const [text, part] = expr.args ?? [];
          if (expr.args?.length !== 2 || text?.typeRef.kind !== "primitive" || text.typeRef.name !== "text" ||
              part?.typeRef.kind !== "primitive" || part.typeRef.name !== "text" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "boolean")
            throw new NativeLoweringError(`Native ${expr.callee} requires two text values and returns boolean in ${identity}`);
          return `${expr.callee === "startsWith" ? "bmec_text_starts_with" : "bmec_text_ends_with"}(${emitExpr(text)}, ${emitExpr(part)})`;
        }
        if (expr.callee === "length") {
          const list = expr.args?.[0];
          if (expr.args?.length !== 1 || list?.typeRef.kind !== "list" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "integer")
            throw new NativeLoweringError(`Native length currently requires one supported list value in ${identity}`);
          return `((int64_t)(${emitExpr(list)}).length)`;
        }
        if (expr.callee === "textLength") {
          const text = expr.args?.[0];
          if (expr.args?.length !== 1 || text?.typeRef.kind !== "primitive" || text.typeRef.name !== "text" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "integer")
            throw new NativeLoweringError(`Native textLength requires one text value and returns integer in ${identity}`);
          return `bmec_text_length_codepoints(${emitExpr(text)})`;
        }
        if (expr.callee === "textIndexOf") {
          const [text, needle] = expr.args ?? [];
          if (expr.args?.length !== 2 || text?.typeRef.kind !== "primitive" || text.typeRef.name !== "text" ||
              needle?.typeRef.kind !== "primitive" || needle.typeRef.name !== "text" ||
              expr.typeRef.kind !== "optional" || expr.typeRef.inner.kind !== "primitive" || expr.typeRef.inner.name !== "integer")
            throw new NativeLoweringError(`Native textIndexOf requires two text values and returns optional<integer> in ${identity}`);
          return `bmec_text_index_of(${emitExpr(text)}, ${emitExpr(needle)})`;
        }
        if (expr.callee === "substring") {
          const [text, start, end] = expr.args ?? [];
          if (expr.args?.length !== 3 || text?.typeRef.kind !== "primitive" || text.typeRef.name !== "text" ||
              start?.typeRef.kind !== "primitive" || start.typeRef.name !== "integer" ||
              end?.typeRef.kind !== "primitive" || end.typeRef.name !== "integer" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "text")
            throw new NativeLoweringError(`Native substring requires text, integer start/end values, and returns text in ${identity}`);
          return `bmec_text_substring(${emitExpr(text)}, ${emitExpr(start)}, ${emitExpr(end)})`;
        }
        if (expr.callee === "split") {
          const [text, separator] = expr.args ?? [];
          if (expr.args?.length !== 2 || text?.typeRef.kind !== "primitive" || text.typeRef.name !== "text" ||
              separator?.typeRef.kind !== "primitive" || separator.typeRef.name !== "text" ||
              expr.typeRef.kind !== "list" || expr.typeRef.element.kind !== "primitive" || expr.typeRef.element.name !== "text")
            throw new NativeLoweringError(`Native split requires text, text, and a list<text> result in ${identity}`);
          return `bmec_text_split(${emitExpr(text)}, ${emitExpr(separator)})`;
        }
        if (expr.callee === "join") {
          const [list, separator] = expr.args ?? [];
          if (expr.args?.length !== 2 || list?.typeRef.kind !== "list" || list.typeRef.element.kind !== "primitive" || list.typeRef.element.name !== "text" ||
              separator?.typeRef.kind !== "primitive" || separator.typeRef.name !== "text" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "text")
            throw new NativeLoweringError(`Native join requires list<text>, text, and a text result in ${identity}`);
          return `bmec_text_join(${emitExpr(list)}, ${emitExpr(separator)})`;
        }
        if (expr.callee === "sort") {
          const [list] = expr.args ?? [];
          if (expr.args?.length !== 1 || list?.typeRef.kind !== "list" || list.typeRef.element.kind !== "primitive" ||
              !["integer", "number", "text"].includes(list.typeRef.element.name) || !isSameType(expr.typeRef, list.typeRef))
            throw new NativeLoweringError(`Native sort currently requires list<integer>, list<number>, or list<text> in ${identity}`);
          const helper = list.typeRef.element.name === "text" ? "bmec_text_sort" :
            list.typeRef.element.name === "integer" ? "bmec_integer_sort" : "bmec_number_sort";
          return `${helper}(${emitExpr(list)})`;
        }
        if (expr.callee === "encodeJson") {
          const value = expr.args?.[0];
          if (expr.args?.length !== 1 || expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "text" || !value)
            throw new NativeLoweringError(`Native encodeJson requires one value and returns text in ${identity}`);
          if (value.typeRef.kind === "primitive") {
            if (value.typeRef.name === "integer") return `bmec_json_encode_integer(${emitExpr(value)})`;
            if (value.typeRef.name === "money") return `bmec_json_encode_money(${emitExpr(value)})`;
            if (value.typeRef.name === "number") return `bmec_json_encode_number(${emitExpr(value)})`;
            if (value.typeRef.name === "boolean") return `bmec_json_encode_boolean(${emitExpr(value)})`;
            if (value.typeRef.name === "text") return `bmec_json_encode_text(${emitExpr(value)})`;
          }
          if (value.typeRef.kind === "list" && value.typeRef.element.kind === "primitive" &&
              ["integer", "number", "boolean", "text"].includes(value.typeRef.element.name))
            return `bmec_json_encode_${value.typeRef.element.name}_list(${emitExpr(value)})`;
          if (value.typeRef.kind === "record" && !value.typeRef.typeArguments?.length)
            return `${cName("bmec_json_encode_record", value.typeRef.symbol)}(${emitExpr(value)})`;
          throw new NativeLoweringError(`Native encodeJson currently supports integer, number, boolean, money, text, lists of supported primitive values, and non-generic plain records with primitive, primitive-list, or optional primitive fields in ${identity}`);
        }
        if (expr.callee === "decodeJson") {
          const source = expr.args?.[0];
          if (expr.args?.length !== 1 || !source || source.typeRef.kind !== "primitive" || source.typeRef.name !== "text" || expr.typeRef.kind !== "result")
            throw new NativeLoweringError(`Native decodeJson requires one text value and a typed Result context in ${identity}`);
          const decodedType = expr.typeRef.ok.kind === "optional" ? expr.typeRef.ok.inner : expr.typeRef.ok;
          const scalarPayload = decodedType.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(decodedType.name);
          const resultPayload = expr.typeRef.ok.kind === "result" &&
            expr.typeRef.ok.error.kind === "primitive" && expr.typeRef.ok.error.name === "text" &&
            expr.typeRef.ok.ok.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(expr.typeRef.ok.ok.name);
          const listPayload = expr.typeRef.ok.kind === "list" && expr.typeRef.ok.element.kind === "primitive" && ["integer", "number", "boolean", "text"].includes(expr.typeRef.ok.element.name);
          const recordPayload = expr.typeRef.ok.kind === "record";
          if (expr.typeRef.error.kind !== "primitive" || expr.typeRef.error.name !== "text" || (!scalarPayload && !resultPayload && !listPayload && !recordPayload))
            throw new NativeLoweringError(`Native decodeJson currently requires result<integer|number|boolean|text|optional-scalar|scalar-result|list<text>|scalar-record,text> in ${identity}`);
          return `${cName("bmec_json_decode", JSON.stringify(expr.typeRef))}(${emitExpr(source)})`;
        }
        if (expr.callee === "base64Encode") {
          const value = expr.args?.[0];
          if (expr.args?.length !== 1 || !value || value.typeRef.kind !== "primitive" || value.typeRef.name !== "text" ||
              expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "text")
            throw new NativeLoweringError(`Native base64Encode requires one text value and returns text in ${identity}`);
          return `bmec_base64_encode(${emitExpr(value)})`;
        }
        if (expr.callee === "base64Decode") {
          const value = expr.args?.[0];
          if (expr.args?.length !== 1 || !value || value.typeRef.kind !== "primitive" || value.typeRef.name !== "text" ||
              expr.typeRef.kind !== "result" || expr.typeRef.ok.kind !== "primitive" || expr.typeRef.ok.name !== "text" || expr.typeRef.error.kind !== "primitive" || expr.typeRef.error.name !== "text")
            throw new NativeLoweringError(`Native base64Decode currently requires text and result<text,text> in ${identity}`);
          return `${cName("bmec_base64_decode", JSON.stringify(expr.typeRef))}(${emitExpr(value)})`;
        }
        if (expr.callee === "filter") {
          const [list, callback] = expr.args ?? [];
          const callbackFunction = callback?.kind === "lambda" ? callback.lambda : undefined;
          if (expr.args?.length !== 2 || list?.typeRef.kind !== "list" || list.typeRef.element.kind !== "primitive" || list.typeRef.element.name !== "text" ||
              expr.typeRef.kind !== "list" || expr.typeRef.element.kind !== "primitive" || expr.typeRef.element.name !== "text" ||
              callback?.kind !== "lambda" || !callbackFunction || callbackFunction.parameters.length !== 1 ||
              callbackFunction.parameters[0]?.typeRef.kind !== "primitive" || callbackFunction.parameters[0].typeRef.name !== "text" ||
              callbackFunction.returnTypeRef.kind !== "primitive" || callbackFunction.returnTypeRef.name !== "boolean" ||
              (callback.captures?.length ?? 0) || (callbackFunction.captures?.length ?? 0))
            throw new NativeLoweringError(`Native filter currently requires list<text> and a captureless (text) -> boolean lambda in ${identity}`);
          const callbackName = names.get(String(callbackFunction.id));
          if (!callbackName) throw new NativeLoweringError(`Native filter callback ${callbackFunction.id} is unavailable in ${identity}`);
          return `bmec_text_filter(${emitExpr(list)}, ${callbackName})`;
        }
        if (expr.callee === "map") {
          const [list, callback] = expr.args ?? [];
          const callbackFunction = callback?.kind === "lambda" ? callback.lambda : undefined;
          const elementType = list?.typeRef.kind === "list" ? list.typeRef.element : undefined;
          const outputType = expr.typeRef.kind === "list" ? expr.typeRef.element : undefined;
          if (expr.args?.length !== 2 || !elementType || elementType.kind !== "primitive" || !nativeMapTypes.some((type) => type.name === elementType.name) ||
              !outputType || outputType.kind !== "primitive" || !nativeMapTypes.some((type) => type.name === outputType.name) ||
              callback?.kind !== "lambda" || !callbackFunction || callbackFunction.parameters.length !== 1 ||
              !isSameType(callbackFunction.parameters[0]!.typeRef, elementType) || !isSameType(callbackFunction.returnTypeRef, outputType) ||
              (callback.captures?.length ?? 0) || (callbackFunction.captures?.length ?? 0))
            throw new NativeLoweringError(`Native map currently requires supported primitive list input/output types and a captureless callback in ${identity}`);
          const callbackName = names.get(String(callbackFunction.id));
          if (!callbackName) throw new NativeLoweringError(`Native map callback ${callbackFunction.id} is unavailable in ${identity}`);
          const helperName = elementType.name === outputType.name
            ? `bmec_${elementType.name}_map`
            : `bmec_${elementType.name}_to_${outputType.name}_map`;
          return `${helperName}(${emitExpr(list)}, ${callbackName})`;
        }
        if (expr.callee === "fold") {
          const [list, seed, callback] = expr.args ?? [];
          const callbackFunction = callback?.kind === "lambda" ? callback.lambda : undefined;
          if (expr.args?.length !== 3 || list?.typeRef.kind !== "list" || list.typeRef.element.kind !== "primitive" || list.typeRef.element.name !== "text" ||
              seed?.typeRef.kind !== "primitive" || seed.typeRef.name !== "integer" || expr.typeRef.kind !== "primitive" || expr.typeRef.name !== "integer" ||
              callback?.kind !== "lambda" || !callbackFunction || callbackFunction.parameters.length !== 2 ||
              callbackFunction.parameters[0]?.typeRef.kind !== "primitive" || callbackFunction.parameters[0].typeRef.name !== "integer" ||
              callbackFunction.parameters[1]?.typeRef.kind !== "primitive" || callbackFunction.parameters[1].typeRef.name !== "text" ||
              callbackFunction.returnTypeRef.kind !== "primitive" || callbackFunction.returnTypeRef.name !== "integer" ||
              (callback.captures?.length ?? 0) || (callbackFunction.captures?.length ?? 0))
            throw new NativeLoweringError(`Native fold currently requires list<text>, integer accumulator, and a captureless (integer, text) -> integer lambda in ${identity}`);
          const callbackName = names.get(String(callbackFunction.id));
          if (!callbackName) throw new NativeLoweringError(`Native fold callback ${callbackFunction.id} is unavailable in ${identity}`);
          return `bmec_text_fold_integer(${emitExpr(list)}, ${emitExpr(seed)}, ${callbackName})`;
        }
        const id = expr.implementationFunctionId ?? expr.calleeId;
        const target = id === undefined ? undefined : names.get(String(id));
        if (!target) throw new NativeLoweringError(`Native primitive slice does not support builtin or indirect call ${expr.callee ?? "?"} in ${identity}`);
        const targetFn = functions.find((candidate) => String(candidate.id) === String(id));
        return `${target}(${(expr.args ?? []).map((arg, index) => emitExpr(arg, targetFn?.parameters[index]?.typeRef)).join(", ")})`;
      }
      if (expr.kind === "match") {
        const scrutinee = expr.scrutinee;
        const variantType = scrutinee?.typeRef;
        if (!scrutinee || scrutinee.kind !== "identifier" || !scrutinee.symbolId ||
            (variantType?.kind !== "optional" && variantType?.kind !== "result" && variantType?.kind !== "enum"))
          throw new NativeLoweringError(`Native enum/Optional/Result matching requires a named local scrutinee in ${identity}`);
        const expectedVariants = variantType.kind === "enum" ? variantType.variants.map((variant) => variant.name) :
          variantType.kind === "optional" ? ["some", "none"] : ["ok", "err"];
        const arms = expr.arms ?? [];
        const wildcard = arms.find((arm) => arm.variant === "_");
        const actualVariants = arms.filter((arm) => arm.variant !== "_").map((arm) => arm.variant);
        if (new Set(actualVariants).size !== actualVariants.length || actualVariants.some((variant) => !expectedVariants.includes(variant)) ||
            (!wildcard && expectedVariants.some((variant) => !actualVariants.includes(variant))) ||
            (variantType.kind !== "enum" && (wildcard || arms.length !== 2 || expectedVariants.some((variant) => !actualVariants.includes(variant)))))
          throw new NativeLoweringError(`Native ${variantType.kind} matching requires exhaustive canonical arms in ${identity}`);
        const armTypes = arms.map((arm) => arm.value.typeRef);
        if (!armTypes.every((type) => isSameType(type, expr.typeRef)))
          throw new NativeLoweringError(`Native match arms must have the same TypeRef in ${identity}`);
        const scrutineeValue = variableFor(String(scrutinee.symbolId));
        const armExpressions = new Map<string, string>();
        for (const arm of arms) {
          const binding = arm.binding;
          const enumVariant = variantType.kind === "enum" ? variantType.variants.find((variant) => variant.name === arm.variant) : undefined;
          const hasPayload = variantType.kind === "optional" ? arm.variant === "some" :
            variantType.kind === "result" ? true : Boolean(enumVariant?.payload);
          if (arm.variant === "_" ? Boolean(binding) : hasPayload !== Boolean(binding))
            throw new NativeLoweringError(`Native ${arm.variant} pattern has an invalid payload binding in ${identity}`);
          let bindingId: string | undefined;
          const findBinding = (value: CoreExpr): void => {
            if (value.kind === "identifier" && value.name === binding && value.symbolId) bindingId = String(value.symbolId);
            for (const child of [value.operand, value.left, value.right, value.object, value.index, value.scrutinee]) if (child) findBinding(child);
            for (const child of value.args ?? []) findBinding(child);
            for (const child of value.elements ?? []) findBinding(child);
            for (const child of value.fields ?? []) findBinding(child.value);
            for (const child of value.arms ?? []) findBinding(child.value);
          };
          if (binding) {
            findBinding(arm.value);
            if (bindingId) {
              const payload = variantType.kind === "optional" ? `${scrutineeValue}.value` :
                variantType.kind === "result" ? `${scrutineeValue}.payload.${arm.variant === "ok" ? "ok" : "error"}` :
                `${scrutineeValue}.payload.${cName("bmec_variant", arm.variant)}`;
              identifierAliases.set(bindingId, `(${payload})`);
            }
          }
          armExpressions.set(arm.variant, emitExpr(arm.value));
          if (bindingId) identifierAliases.delete(bindingId);
        }
        if (variantType.kind !== "enum") {
          const successVariant = variantType.kind === "optional" ? "some" : "ok";
          const errorVariant = variantType.kind === "optional" ? "none" : "err";
          const discriminant = variantType.kind === "optional" ? `${scrutineeValue}.present` : `${scrutineeValue}.is_ok`;
          return `((${discriminant}) ? (${armExpressions.get(successVariant)}) : (${armExpressions.get(errorVariant)}))`;
        }
        let fallback = wildcard ? armExpressions.get("_")! : "0";
        for (let index = variantType.variants.length - 1; index >= 0; index--) {
          const variant = variantType.variants[index]!;
          const armValue = armExpressions.get(variant.name);
          if (armValue !== undefined) fallback = `((${scrutineeValue}.tag == ${index}u) ? (${armValue}) : (${fallback}))`;
        }
        return fallback;
      }
      throw new NativeLoweringError(`Native primitive slice does not support expression ${expr.kind} in ${identity}`);
    };
    const preparePropagations = (expr: CoreExpr, pad: string) => {
      if (expr.kind === "propagate") {
        const operand = expr.operand!;
        preparePropagations(operand, pad);
        if (operand.typeRef.kind !== "result" || fn.returnTypeRef.kind !== "result" ||
            !isSameType(expr.typeRef, operand.typeRef.ok) || !isSameType(fn.returnTypeRef.error, operand.typeRef.error))
          throw new NativeLoweringError(`Native Result propagation has incompatible success/error TypeRefs in ${identity}`);
        const temp = `bmec_try_${++tempOrdinal}`;
        lines.push(`${pad}${typeName(operand.typeRef, identity)} ${temp} = ${emitExpr(operand)};`);
        lines.push(`${pad}if (!${temp}.is_ok) {`);
        lines.push(`${pad}  bmec_result.is_ok = false;`);
        lines.push(`${pad}  bmec_result.payload.error = ${temp}.payload.error;`);
        lines.push(`${pad}  goto bmec_return;`);
        lines.push(`${pad}}`);
        preparedExpressions.set(expr, `${temp}.payload.ok`);
        return;
      }
      for (const value of [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee]) if (value) preparePropagations(value, pad);
      for (const value of expr.args ?? []) preparePropagations(value, pad);
      for (const value of expr.elements ?? []) preparePropagations(value, pad);
      for (const field of expr.fields ?? []) preparePropagations(field.value, pad);
      for (const arm of expr.arms ?? []) preparePropagations(arm.value, pad);
    };
    const containsPropagation = (expr: CoreExpr): boolean => expr.kind === "propagate" ||
      [expr.operand, expr.left, expr.right, expr.object, expr.index, expr.scrutinee].some((value) => value ? containsPropagation(value) : false) ||
      (expr.args ?? []).some(containsPropagation) || (expr.elements ?? []).some(containsPropagation) ||
      (expr.fields ?? []).some((field) => containsPropagation(field.value)) || (expr.arms ?? []).some((arm) => containsPropagation(arm.value));
    const localStepCounter = requiresSharedStepCounter(fn.body) ? undefined : "bmec_local_steps";
    const emitStep = (pad: string, count = 1) => {
      if (!localStepCounter) {
        lines.push(`${pad}${count === 1 ? "bmec_step();" : `bmec_step_many(${count});`}`);
      } else if (count === 1) {
        lines.push(`${pad}if (++${localStepCounter} > 100000) bmec_fail("PIPE-RUNTIME-006: Maximum execution steps exceeded");`);
      } else {
        lines.push(`${pad}if (${localStepCounter} > 100000 - ${count}) bmec_fail("PIPE-RUNTIME-006: Maximum execution steps exceeded");`);
        lines.push(`${pad}${localStepCounter} += ${count};`);
      }
    };
    const emitBody = (statements: CoreStatement[], env: Map<string, string>, depth: number, skipFirstStep = false) => {
      const pad = "  ".repeat(depth);
      let skipNextStep = skipFirstStep;
      for (const statement of statements) {
        const combineBranchStep = canCombineIfStepWithBranch(statement);
        if (skipNextStep) skipNextStep = false;
        else if (!combineBranchStep) emitStep(pad);
        if (statement.kind === "let") {
          const id = localIds.get(statement);
          const type = statement.declaredTypeRef ?? statement.value.typeRef;
          if (!id) throw new NativeLoweringError(`Native local ${statement.name} has no canonical lowered slot in ${identity}`);
          const name = variableFor(id);
          slotTypes.set(id, type);
          preparePropagations(statement.value, pad);
          if (type.kind === "list") {
            if (type.element.kind === "primitive" && type.element.name === "text") {
              if (statement.value.kind === "list") {
                const values = statement.value.elements ?? [];
                const items = `${name}_items`;
                if (values.length) {
                  lines.push(`${pad}bmec_text ${items}[] = { ${values.map((value) => emitExpr(value)).join(", ")} };`);
                  lines.push(`${pad}bmec_text_list ${name} = bmec_text_list_copy(${items}, ${values.length});`);
                } else lines.push(`${pad}bmec_text_list ${name} = { NULL, 0 };`);
              } else lines.push(`${pad}bmec_text_list ${name} = ${emitExpr(statement.value, type)};`);
              env.set(statement.name, id);
              continue;
            }
            if (type.element.kind === "primitive" && ["integer", "number", "boolean"].includes(type.element.name)) {
              const listType = typeName(type, identity);
              if (statement.value.kind === "list") {
                const values = statement.value.elements ?? [];
                const items = `${name}_items`;
                if (values.length) lines.push(`${pad}${typeName(type.element, identity)} ${items}[] = { ${values.map((value) => emitExpr(value)).join(", ")} };`);
                else lines.push(`${pad}${typeName(type.element, identity)} *${items} = NULL;`);
                lines.push(`${pad}${listType} ${name} = { ${items}, ${values.length} };`);
              } else lines.push(`${pad}${listType} ${name} = ${emitExpr(statement.value, type)};`);
              env.set(statement.name, id);
              continue;
            }
            if (statement.value.kind !== "list")
              throw new NativeLoweringError(`Native primitive slice supports only literal list initialization in ${identity}`);
            const elementType = typeName(type.element, identity);
            const values = statement.value.elements ?? [];
            const initializer = values.length ? values.map((value) => emitExpr(value)).join(", ") : "0";
            lines.push(`${pad}${elementType} ${name}[] = { ${initializer} };`);
            lines.push(`${pad}int64_t ${name}_length = ${values.length};`);
            env.set(statement.name, id);
            continue;
          }
          lines.push(`${pad}${typeName(type, identity)} ${name} = ${emitExpr(statement.value, type)};`);
          env.set(statement.name, id);
        } else if (statement.kind === "assign") {
          const id = env.get(statement.name);
          if (!id) throw new NativeLoweringError(`Native assignment cannot resolve ${statement.name} in ${identity}`);
          preparePropagations(statement.value, pad);
          lines.push(`${pad}${variableFor(id)} = ${emitExpr(statement.value, slotTypes.get(id))};`);
        } else if (statement.kind === "return") {
          preparePropagations(statement.value, pad);
          lines.push(`${pad}bmec_result = ${emitExpr(statement.value, fn.returnTypeRef)};`);
          lines.push(`${pad}goto bmec_return;`);
        } else if (statement.kind === "if") {
          preparePropagations(statement.condition, pad);
          lines.push(`${pad}if (${emitExpr(statement.condition)}) {`);
          if (combineBranchStep) emitStep(`${pad}  `, 2);
          emitBody(statement.thenBody, new Map(env), depth + 1, combineBranchStep);
          if (statement.elseBody?.length) {
            lines.push(`${pad}} else {`);
            if (combineBranchStep) emitStep(`${pad}  `, 2);
            emitBody(statement.elseBody, new Map(env), depth + 1, combineBranchStep);
          }
          lines.push(`${pad}}`);
        } else if (statement.kind === "while") {
          if (containsPropagation(statement.condition)) {
            lines.push(`${pad}for (;;) {`);
            preparePropagations(statement.condition, `${pad}  `);
            lines.push(`${pad}  if (!(${emitExpr(statement.condition)})) break;`);
            emitBody(statement.body, new Map(env), depth + 1);
            lines.push(`${pad}}`);
          } else {
            lines.push(`${pad}while (${emitExpr(statement.condition)}) {`);
            emitBody(statement.body, new Map(env), depth + 1);
            lines.push(`${pad}}`);
          }
        } else if (statement.kind === "repeat") {
          preparePropagations(statement.count, pad);
          const countName = `bmec_repeat_${++tempOrdinal}`;
          const loopName = `bmec_i_${tempOrdinal}`;
          lines.push(`${pad}int64_t ${countName} = ${emitExpr(statement.count)};`);
          lines.push(`${pad}if (${countName} < 0) bmec_fail("PIPE-RUNTIME-002: Repeat count must be a non-negative integer");`);
          lines.push(`${pad}for (int64_t ${loopName} = 0; ${loopName} < ${countName}; ++${loopName}) {`);
          emitBody(statement.body, new Map(env), depth + 1);
          lines.push(`${pad}}`);
        } else if (statement.kind === "break") lines.push(`${pad}break;`);
        else if (statement.kind === "continue") lines.push(`${pad}continue;`);
        else if (statement.kind === "for") {
          if (statement.iterable.kind !== "identifier" || statement.iterable.typeRef.kind !== "list")
            throw new NativeLoweringError(`Native primitive slice supports for loops over named literal lists in ${identity}`);
          const listId = statement.iterable.symbolId;
          const bindingId = localIds.get(statement);
          if (!listId || !bindingId)
            throw new NativeLoweringError(`Native list iteration is missing a canonical binding in ${identity}`);
          const list = variableFor(String(listId));
          const binding = variableFor(bindingId);
          const elementType = typeName(statement.iterable.typeRef.element, identity);
          const loop = `bmec_list_i_${++tempOrdinal}`;
          const wrappedList = statement.iterable.typeRef.element.kind === "primitive";
          lines.push(`${pad}for (int64_t ${loop} = 0; ${loop} < ${wrappedList ? `${list}.length` : `${list}_length`}; ++${loop}) {`);
          lines.push(`${pad}  ${elementType} ${binding} = ${wrappedList ? `${list}.data[${loop}]` : `${list}[${loop}]`};`);
          const nested = new Map(env);
          nested.set(statement.name, bindingId);
          emitBody(statement.body, nested, depth + 1);
          lines.push(`${pad}}`);
        }
        else if (statement.kind === "expect") {
          preparePropagations(statement.actual, pad);
          preparePropagations(statement.expected, pad);
          const actual = emitExpr(statement.actual);
          const expected = emitExpr(statement.expected);
          lines.push(`${pad}if ((${actual}) != (${expected})) bmec_fail("PIPE-TEST-002: Expectation failed");`);
        }
      }
    };
    const env = new Map(parameterCNames);
    const inline = identity.startsWith("LAMBDA-") ? "static inline " : "";
    lines.push(`${inline}${resultType} ${names.get(identity)}(${paramList}) {`);
    lines.push("  if (bmec_depth >= 128) bmec_fail(\"PIPE-RUNTIME-006: Maximum call depth exceeded\");");
    lines.push("  if (++bmec_steps > 100000) bmec_fail(\"PIPE-RUNTIME-006: Maximum execution steps exceeded\");");
    lines.push("  ++bmec_depth;");
    if (localStepCounter) lines.push(`  int64_t ${localStepCounter} = bmec_steps;`);
    lines.push(`  ${resultType} bmec_result = ${fn.returnTypeRef.kind === "record" || fn.returnTypeRef.kind === "enum" || fn.returnTypeRef.kind === "optional" || fn.returnTypeRef.kind === "result" || (fn.returnTypeRef.kind === "primitive" && ["text", "money"].includes(fn.returnTypeRef.name)) ? "{0}" : `(${resultType})0`};`);
    emitBody(fn.body, env, 1);
    lines.push("bmec_return:");
    if (localStepCounter) lines.push(`  bmec_steps = ${localStepCounter};`);
    lines.push("  --bmec_depth;");
    lines.push("  return bmec_result;");
    lines.push("}", "");
  }
  const entryC = names.get(String(entry.id))!;
  const returnKind = entry.returnTypeRef.kind === "primitive" ? entry.returnTypeRef.name : "";
  if (filesystemEntry) {
    const capabilityArg = entry.parameters[0]!;
    const cParams = entry.parameters.map((parameter, index) => index === 0 ? "(bmec_filesystem){ bmec_fs_root_fd }" : `(bmec_text){ (const unsigned char *)bmec_fs_args[bmec_arg_${index}], strlen(bmec_fs_args[bmec_arg_${index}]) }`).join(", ");
    const argSetup: string[] = ["int bmec_fs_argc = 0;", "char **bmec_fs_args = (char **)calloc((size_t)argc, sizeof(char *));", "if (!bmec_fs_args) { fputs(\"native_filesystem_arguments_unavailable\\n\", stderr); return 70; }", "const bmec_native_arg *bmec_fs_root = NULL;", "for (int i = 1; i < argc; ++i) { if (bmec_fs_arg_equal(argv[i], \"--fs-root\")) { if (bmec_fs_root || i + 1 >= argc) { fputs(\"usage: --fs-root DIR [TEXT_ARGS...]\\n\", stderr); free(bmec_fs_args); return 2; } bmec_fs_root = argv[++i]; } else { bmec_fs_args[bmec_fs_argc] = bmec_fs_argument_utf8(argv[i]); if (!bmec_fs_args[bmec_fs_argc++]) { fputs(\"invalid command-line text encoding\\n\", stderr); free(bmec_fs_args); return 2; } } }", "if (!bmec_fs_root) { fputs(\"usage: --fs-root DIR [TEXT_ARGS...]\\n\", stderr); for (int i = 0; i < bmec_fs_argc; ++i) free(bmec_fs_args[i]); free(bmec_fs_args); return 2; }", "if (bmec_fs_init_root(bmec_fs_root) != 0) { fputs(\"native_filesystem_root_unavailable\\n\", stderr); for (int i = 0; i < bmec_fs_argc; ++i) free(bmec_fs_args[i]); free(bmec_fs_args); return 66; }", `if (bmec_fs_argc != ${entry.parameters.length - 1}) { bmec_fs_close_root(); for (int i = 0; i < bmec_fs_argc; ++i) free(bmec_fs_args[i]); free(bmec_fs_args); fputs("wrong number of text arguments\\n", stderr); return 2; }`, ...entry.parameters.slice(1).map((_, index) => `int bmec_arg_${index + 1} = ${index};`)];
    lines.push("#if defined(_WIN32)", "int wmain(int argc, wchar_t **argv) {", "#else", "int main(int argc, char **argv) {", "#endif");
    lines.push(...argSetup.map(line => `  ${line}`));
    const resultAlias = typeName(entry.returnTypeRef, String(entry.id));
    const resultVar = "bmec_entry_result";
    lines.push(`  ${resultAlias} ${resultVar} = ${entryC}(${cParams});`);
    if (entry.returnTypeRef.kind === "result") {
      lines.push(`  if (${resultVar}.is_ok) {`);
      if (entry.returnTypeRef.ok.kind === "primitive" && entry.returnTypeRef.ok.name === "boolean") lines.push(`    printf("{\\\"state\\\":\\\"ok\\\",\\\"value\\\":%s}\\n", ${resultVar}.payload.ok ? "true" : "false");`);
      else if (entry.returnTypeRef.ok.kind === "primitive" && entry.returnTypeRef.ok.name === "text") lines.push(`    fputs("{\\\"state\\\":\\\"ok\\\",\\\"value\\\":", stdout); bmec_json_text(${resultVar}.payload.ok); puts("}");`);
      lines.push("  } else {");
      lines.push("    fputs(\"{\\\"state\\\":\\\"err\\\",\\\"error\\\":\", stdout); bmec_json_text(");
      lines.push(`      ${resultVar}.payload.error); puts("}");`);
      lines.push("  }");
    }
    lines.push("  bmec_arena_report();", "  bmec_arena_release();", "  bmec_fs_close_root();", "  for (int i = 0; i < bmec_fs_argc; ++i) free(bmec_fs_args[i]);", "  free(bmec_fs_args);", "  return 0;", "}", "");
  } else {
    lines.push("int main(void) {");
    if (returnKind === "integer") lines.push(`  printf("%" PRId64 "\\n", ${entryC}());`);
    else if (returnKind === "number") lines.push(`  printf("%.17g\\n", ${entryC}());`);
    else if (returnKind === "boolean") lines.push(`  puts(${entryC}() ? "true" : "false");`);
    lines.push("  bmec_arena_report();", "  bmec_arena_release();", "  return 0;", "}", "");
  }
  return lines.join("\n");
}
