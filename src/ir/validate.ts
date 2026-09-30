import type { ProjectIR } from "./ir.js";
import {
  formatType,
  isAssignable,
  isSameType,
  typeRefFromUnknown,
} from "../types/type-ref.js";
import { validateHttp, type HttpProgram } from "../http/ir.js";
import { validateDbSchema, type DbSchema } from "../db/ir.js";
import { validateUI, type UIProgram } from "../ui/ir.js";
import { STDLIB_NAMES } from "../stdlib/stdlib.js";
import { BMEC_STYLE_VALUES, typedStyleValue } from "../style/values.js";

export interface IRValidation {
  valid: boolean;
  errors: string[];
}
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown) =>
  Array.isArray(x) && x.every((v) => typeof v === "string" && v.length > 0);
const nonEmpty = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0;
const BUILTINS = new Set([
  ...STDLIB_NAMES,
  "environmentText",
  "environmentSecret",
  "revealSecret",
  "readTextFile",
  "databaseSelect",
  "databaseSelectWhere",
  "databaseCount",
  "databaseCountWhere",
  "databaseDecrementWhere",
  "databaseInsert",
  "databaseInsertId",
  "databaseInsertIdIfAbsent",
  "databaseUpdate",
  "databaseUpdateWhere",
  "databaseUpdateUniqueWhere",
  "databaseDelete",
  "databaseDeleteWhere",
]);
let currentFunctionShapes = new Map<
  string,
  { parameters: unknown[]; returnTypeRef: unknown }
>();
let knownInterfaceMethodIds = new Set<string>();

function validateStyle(value: unknown, errors: string[]) {
  if (!object(value) || !nonEmpty(value.id) || !Array.isArray(value.values)) {
    errors.push("IR style is invalid");
    return;
  }
  if (value.token !== undefined && typeof value.token !== "boolean") errors.push("IR style token flag is invalid");
  const values = value.values as unknown[];
  if (value.composes !== undefined && (!Array.isArray(value.composes) || (value.composes as unknown[]).some(name => typeof name !== "string" || !name)))
    errors.push("IR style composes are invalid");
  if (value.padding !== undefined && (typeof value.padding !== "number" || !Number.isFinite(value.padding) || value.padding < 0))
    errors.push("IR style padding is invalid");
  if (value.gap !== undefined && (typeof value.gap !== "number" || !Number.isFinite(value.gap) || value.gap < 0))
    errors.push("IR style gap is invalid");
  for (const dimension of ["margin", "width", "height"] as const)
    if (value[dimension] !== undefined && (typeof value[dimension] !== "number" || !Number.isFinite(value[dimension] as number) || (value[dimension] as number) < 0))
      errors.push(`IR style ${dimension} is invalid`);
  if (value.opacity !== undefined && (typeof value.opacity !== "number" || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1))
    errors.push("IR style opacity is invalid");
  if (value.columns !== undefined && (typeof value.columns !== "number" || !Number.isInteger(value.columns) || value.columns < 1))
    errors.push("IR style columns is invalid");
  if (value.responsiveColumns !== undefined && (typeof value.responsiveColumns !== "number" || !Number.isInteger(value.responsiveColumns) || value.responsiveColumns < 1))
    errors.push("IR style responsiveColumns is invalid");
  if (value.responsiveGap !== undefined && (typeof value.responsiveGap !== "number" || !Number.isFinite(value.responsiveGap) || value.responsiveGap < 0))
    errors.push("IR style responsiveGap is invalid");
  if (value.responsivePadding !== undefined && (typeof value.responsivePadding !== "number" || !Number.isFinite(value.responsivePadding) || value.responsivePadding < 0))
    errors.push("IR style responsivePadding is invalid");
  if (value.responsiveMargin !== undefined && (typeof value.responsiveMargin !== "number" || !Number.isFinite(value.responsiveMargin) || value.responsiveMargin < 0))
    errors.push("IR style responsiveMargin is invalid");
  if (value.responsiveFontSize !== undefined && (typeof value.responsiveFontSize !== "number" || !Number.isFinite(value.responsiveFontSize) || value.responsiveFontSize < 0))
    errors.push("IR style responsiveFontSize is invalid");
  if (value.responsiveLineHeight !== undefined && (typeof value.responsiveLineHeight !== "number" || !Number.isFinite(value.responsiveLineHeight) || value.responsiveLineHeight < 0))
    errors.push("IR style responsiveLineHeight is invalid");
  if (value.responsiveLayout !== undefined && value.responsiveLayout !== "row" && value.responsiveLayout !== "column" && value.responsiveLayout !== "grid")
    errors.push("IR style responsiveLayout is invalid");
  values.forEach((name, index) => {
    if (typeof name !== "string" || !BMEC_STYLE_VALUES.has(name))
      errors.push(`IR style.values[${index}] contains unknown style value`);
  });
  if (value.typedValues !== undefined) {
    if (
      !Array.isArray(value.typedValues) ||
      value.typedValues.length !== values.length
    )
      errors.push("IR style typedValues are invalid");
    else
      value.typedValues.forEach((typed, index) => {
        const expected =
          typeof values[index] === "string"
            ? typedStyleValue(values[index] as string)
            : undefined;
        if (
          !object(typed) ||
          typed.name !== values[index] ||
          !expected ||
          typed.category !== expected.category
        )
          errors.push(`IR style.typedValues[${index}] is invalid`);
      });
  }
  if (value.properties !== undefined) {
    if (!Array.isArray(value.properties))
      errors.push("IR style properties are invalid");
    else
      value.properties.forEach((property, index) => {
        if (
          !object(property) ||
          property.name !== "background" && property.name !== "opacity" && property.name !== "textColor" ||
          property.name === "background" && property.value !== "blue" && property.value !== "neutral" && property.value !== "red" && property.value !== "green" && property.value !== "dark-blue" ||
          property.name === "opacity" && (typeof property.value !== "number" || !Number.isFinite(property.value) || property.value < 0 || property.value > 1) ||
          property.name === "textColor" && property.value !== "white" && property.value !== "black" && property.value !== "inherit"
        )
          errors.push(`IR style.properties[${index}] is invalid`);
      });
  }
  if (value.states !== undefined) {
    if (!Array.isArray(value.states))
      errors.push("IR style states are invalid");
    else
      value.states.forEach((state, index) => {
        if (
          !object(state) ||
          (state.state !== "hovered" && state.state !== "focused" && state.state !== "active" && state.state !== "disabled") ||
          !Array.isArray(state.properties)
        )
          errors.push(`IR style.states[${index}] is invalid`);
        else
          (state.properties as unknown[]).forEach((property, propertyIndex) => {
            if (
              !object(property) ||
              property.name !== "background" && property.name !== "opacity" && property.name !== "textColor" ||
              property.name === "background" && property.value !== "blue" && property.value !== "neutral" && property.value !== "red" && property.value !== "green" && property.value !== "dark-blue" ||
              property.name === "opacity" && (typeof property.value !== "number" || !Number.isFinite(property.value) || property.value < 0 || property.value > 1) ||
              property.name === "textColor" && property.value !== "white" && property.value !== "black" && property.value !== "inherit"
            )
              errors.push(
                `IR style.states[${index}].properties[${propertyIndex}] is invalid`,
              );
          });
      });
  }
  if (value.responsive !== undefined && value.responsive !== "stacked" && value.responsive !== "fluid")
    errors.push("IR style responsive value is invalid");
  if (value.layout !== undefined && value.layout !== "row" && value.layout !== "column" && value.layout !== "grid")
    errors.push("IR style layout value is invalid");
  if (value.alignment !== undefined && value.alignment !== "start" && value.alignment !== "center" && value.alignment !== "end" && value.alignment !== "stretch")
    errors.push("IR style alignment value is invalid");
  if (value.typography !== undefined && value.typography !== "readable" && value.typography !== "compact")
    errors.push("IR style typography value is invalid");
  if (value.fontWeight !== undefined && value.fontWeight !== "normal" && value.fontWeight !== "bold")
    errors.push("IR style fontWeight value is invalid");
  if (value.fontSize !== undefined && (typeof value.fontSize !== "number" || !Number.isFinite(value.fontSize) || value.fontSize <= 0))
    errors.push("IR style fontSize value is invalid");
  if (value.lineHeight !== undefined && (typeof value.lineHeight !== "number" || !Number.isFinite(value.lineHeight) || value.lineHeight <= 0))
    errors.push("IR style lineHeight value is invalid");
  if (value.spacing !== undefined && value.spacing !== "comfortable" && value.spacing !== "compact")
    errors.push("IR style spacing value is invalid");
  if (value.theme !== undefined && value.theme !== "light" && value.theme !== "dark" && value.theme !== "calm" && value.theme !== "contrast")
    errors.push("IR style theme value is invalid");
  if (value.color !== undefined && value.color !== "blue" && value.color !== "muted" && value.color !== "red" && value.color !== "green")
    errors.push("IR style color value is invalid");
  if (value.border !== undefined && value.border !== "subtle" && value.border !== "strong" && value.border !== "red" && value.border !== "green")
    errors.push("IR style border value is invalid");
  if (value.shadow !== undefined && value.shadow !== "soft" && value.shadow !== "strong")
    errors.push("IR style shadow value is invalid");
  if (value.corners !== undefined && value.corners !== "rounded" && value.corners !== "pill")
    errors.push("IR style corners value is invalid");
  if (value.radius !== undefined && (typeof value.radius !== "number" || !Number.isFinite(value.radius) || value.radius < 0))
    errors.push("IR style radius value is invalid");
  if (value.disabled !== undefined && value.disabled !== "guarded")
    errors.push("IR style disabled value is invalid");
  if (value.focus !== undefined && value.focus !== "ringed")
    errors.push("IR style focus value is invalid");
  if (value.surface !== undefined && value.surface !== "elevated")
    errors.push("IR style surface value is invalid");
  if (value.text !== undefined && value.text !== "muted")
    errors.push("IR style text value is invalid");
  if (value.textColor !== undefined && value.textColor !== "white" && value.textColor !== "black" && value.textColor !== "inherit")
    errors.push("IR style textColor value is invalid");
  if (value.transitionDuration !== undefined && (typeof value.transitionDuration !== "number" || !Number.isFinite(value.transitionDuration) || value.transitionDuration < 0))
    errors.push("IR style transitionDuration is invalid");
  if (value.transitionProperty !== undefined && (typeof value.transitionProperty !== "string" || !["all", "background", "color", "transform", "opacity"].includes(value.transitionProperty)))
    errors.push("IR style transitionProperty is invalid");
  if (value.transitionEasing !== undefined && value.transitionEasing !== "ease" && value.transitionEasing !== "linear")
    errors.push("IR style transitionEasing is invalid");
}

function checkType(
  value: unknown,
  display: unknown,
  errors: string[],
  where: string,
) {
  const parsed = typeRefFromUnknown(value);
  if (!parsed || !nonEmpty(display) || formatType(parsed) !== display)
    errors.push(`${where} has an invalid TypeRef`);
  return parsed;
}
function checkSymbol(value: unknown, errors: string[], where: string) {
  if (!nonEmpty(value)) errors.push(`${where} symbol ID is invalid`);
}

function expression(
  value: unknown,
  errors: string[],
  where: string,
  functionIds: Set<string>,
): boolean {
  const v = object(value) ? value : undefined;
  const expressionType = v ? typeRefFromUnknown(v.typeRef) : undefined;
  if (
    !v ||
    !nonEmpty(v.kind) ||
    !expressionType ||
    !nonEmpty(v.type) ||
    formatType(expressionType) !== v.type
  ) {
    errors.push(`${where} expression is invalid`);
    return false;
  }
  if (v.kind === "call") {
    if (
      v.implementationFunctionId !== undefined &&
      (!nonEmpty(v.implementationFunctionId) ||
        !functionIds.has(String(v.implementationFunctionId)))
    )
      errors.push(`${where} implementation dispatch identity is invalid`);
    if (v.interfaceId !== undefined && !nonEmpty(v.interfaceId))
      errors.push(`${where} interface identity is invalid`);
    if (
      v.interfaceMethodId !== undefined &&
      (!nonEmpty(v.interfaceMethodId) ||
        !knownInterfaceMethodIds.has(String(v.interfaceMethodId)) ||
        (v.interfaceId !== undefined &&
          !String(v.interfaceMethodId).startsWith(`${v.interfaceId}:`)))
    )
      errors.push(`${where} interface requirement identity is invalid`);
    if (v.interfaceMethodId !== undefined && v.interfaceId === undefined)
      errors.push(`${where} interface requirement lacks interface identity`);
  }
  switch (v.kind) {
    case "literal":
      if (!["string", "number", "boolean"].includes(typeof v.value))
        errors.push(`${where} literal is invalid`);
      return true;
    case "none":
      if (expressionType.kind !== "none")
        errors.push(`${where} none has the wrong TypeRef`);
      return true;
    case "identifier":
      checkSymbol(v.symbolId, errors, `${where}.symbolId`);
      if (expressionType.kind === "function") {
        if (!nonEmpty(v.functionId) || !functionIds.has(String(v.functionId)))
          errors.push(`${where} function identity is invalid`);
      }
      return true;
    case "list":
      if (!Array.isArray(v.elements)) errors.push(`${where} list is invalid`);
      else
        v.elements.forEach((x, i) =>
          expression(x, errors, `${where}.elements[${i}]`, functionIds),
        );
      return true;
    case "record":
      if (!Array.isArray(v.fields)) errors.push(`${where} record is invalid`);
      else
        v.fields.forEach((x, i) => {
          if (!object(x) || !nonEmpty(x.name))
            errors.push(`${where}.fields[${i}] is invalid`);
          else
            expression(
              x.value,
              errors,
              `${where}.fields[${i}].value`,
              functionIds,
            );
        });
      return true;
    case "enum": {
      if (expressionType.kind !== "enum" || !nonEmpty(v.variant) || !Array.isArray(v.args)) {
        errors.push(`${where} enum constructor metadata is invalid`);
        return false;
      }
      const variant = expressionType.variants.find((item) => item.name === v.variant);
      if (!variant) {
        errors.push(`${where} enum variant is unavailable in its TypeRef`);
        return false;
      }
      const args = v.args as unknown[];
      if ((variant.payload === undefined && args.length !== 0) || (variant.payload !== undefined && args.length !== 1))
        errors.push(`${where} enum payload arity is invalid`);
      args.forEach((arg, index) => {
        if (!expression(arg, errors, `${where}.args[${index}]`, functionIds)) return;
        const actual = object(arg) ? typeRefFromUnknown(arg.typeRef) : undefined;
        if (!variant.payload || !actual || !isAssignable(actual, variant.payload))
          errors.push(`${where}.args[${index}] has an invalid enum payload TypeRef`);
      });
      return true;
    }
    case "unary":
      if (
        !nonEmpty(v.operator) ||
        !expression(v.operand, errors, `${where}.operand`, functionIds)
      )
        errors.push(`${where} unary expression is invalid`);
      return true;
    case "binary":
      if (
        !nonEmpty(v.operator) ||
        !expression(v.left, errors, `${where}.left`, functionIds) ||
        !expression(v.right, errors, `${where}.right`, functionIds)
      )
        errors.push(`${where} binary expression is invalid`);
      return true;
    case "call":
      if (!nonEmpty(v.callee) || !Array.isArray(v.args))
        errors.push(`${where} call signature is invalid`);
      else {
        const args = v.args as unknown[];
        if (v.calleeId !== undefined) {
          const shape = currentFunctionShapes.get(String(v.calleeId));
          if (
            !nonEmpty(v.calleeId) ||
            !functionIds.has(String(v.calleeId)) ||
            !shape
          )
            errors.push(`${where} direct function identity is invalid`);
          else {
            if (args.length !== shape.parameters.length)
              errors.push(`${where} direct call argument count is invalid`);
            shape.parameters.forEach((parameter, i) => {
              const expected = typeRefFromUnknown(parameter);
              const actual = object(args[i])
                ? typeRefFromUnknown(args[i].typeRef)
                : undefined;
              if (expected && actual && !isAssignable(actual, expected))
                errors.push(
                  `${where}.args[${i}] has an invalid argument TypeRef`,
                );
            });
            const returned = typeRefFromUnknown(shape.returnTypeRef);
            if (returned && formatType(returned) !== formatType(expressionType))
              errors.push(`${where} result TypeRef is invalid`);
          }
        } else if (
          !BUILTINS.has(String(v.callee)) &&
          !nonEmpty(v.calleeSymbolId)
        )
          errors.push(`${where} indirect call identity is invalid`);
        args.forEach((x, i) =>
          expression(x, errors, `${where}.args[${i}]`, functionIds),
        );
      }
      return true;
    case "index":
      if (
        !expression(v.object, errors, `${where}.object`, functionIds) ||
        !expression(v.index, errors, `${where}.index`, functionIds)
      )
        errors.push(`${where} index expression is invalid`);
      return true;
    case "field":
      if (
        !nonEmpty(v.field) ||
        !expression(v.object, errors, `${where}.object`, functionIds)
      )
        errors.push(`${where} field expression is invalid`);
      return true;
    case "propagate": {
      const validOperand = expression(
        v.operand,
        errors,
        `${where}.operand`,
        functionIds,
      );
      const operandType = object(v.operand)
        ? typeRefFromUnknown(v.operand.typeRef)
        : undefined;
      if (
        !validOperand ||
        !operandType ||
        operandType.kind !== "result" ||
        expressionType.kind === "result" ||
        !isAssignable(operandType.ok, expressionType)
      )
        errors.push(`${where} Result propagation is invalid`);
      return true;
    }
    case "await": {
      const validOperand = expression(
        v.operand,
        errors,
        `${where}.operand`,
        functionIds,
      );
      const operandType = object(v.operand)
        ? typeRefFromUnknown(v.operand.typeRef)
        : undefined;
      if (
        !validOperand ||
        !operandType ||
        operandType.kind !== "task" ||
        !isAssignable(operandType.result, expressionType)
      )
        errors.push(`${where} task await is invalid`);
      return true;
    }
    case "match":
      if (
        !expression(v.scrutinee, errors, `${where}.scrutinee`, functionIds) ||
        !Array.isArray(v.arms)
      )
        errors.push(`${where} match metadata is invalid`);
      else
        v.arms.forEach((arm, i) => {
          if (
            !object(arm) ||
            !nonEmpty(arm.variant) ||
            !expression(
              arm.value,
              errors,
              `${where}.arms[${i}].value`,
              functionIds,
            )
          )
            errors.push(`${where}.arms[${i}] is invalid`);
        });
      return true;
    case "lambda":
      if (
        !object(v.lambda) ||
        !Array.isArray(v.lambda.parameters) ||
        !Array.isArray(v.lambda.body) ||
        !nonEmpty(v.lambda.id) ||
        !v.lambda.returnTypeRef ||
        !nonEmpty(v.lambda.returnType)
      )
        errors.push(`${where} lambda metadata is invalid`);
      else {
        if (functionIds.has(String(v.lambda.id)))
          errors.push(`${where} lambda function ID is duplicated`);
        functionIds.add(String(v.lambda.id));
        checkType(
          v.lambda.returnTypeRef,
          v.lambda.returnType,
          errors,
          `${where}.lambda.returnType`,
        );
        const names = new Set<string>();
        v.lambda.parameters.forEach((p, i) => {
          if (
            !object(p) ||
            !nonEmpty(p.name) ||
            names.has(String(p.name)) ||
            !nonEmpty(p.type) ||
            !p.typeRef
          )
            errors.push(`${where}.lambda.parameters[${i}] is invalid`);
          else {
            names.add(String(p.name));
            checkType(
              p.typeRef,
              p.type,
              errors,
              `${where}.lambda.parameters[${i}]`,
            );
          }
        });
        statements(v.lambda.body, errors, `${where}.lambda.body`, functionIds);
        if (
          v.captures !== undefined &&
          (!strings(v.captures) ||
            new Set(v.captures as string[]).size !==
              (v.captures as string[]).length)
        )
          errors.push(`${where}.captures is invalid`);
      }
      return true;
    default:
      errors.push(`${where} has an unknown expression kind`);
      return false;
  }
}

function statements(
  value: unknown,
  errors: string[],
  where: string,
  functionIds: Set<string>,
  asyncFunction = false,
) {
  if (!Array.isArray(value)) {
    errors.push(`${where} body must be an array`);
    return;
  }
  value.forEach((statement, index) => {
    const p = `${where}[${index}]`;
    if (!object(statement) || !nonEmpty(statement.kind)) {
      errors.push(`${p} statement is invalid`);
      return;
    }
    if (statement.kind === "let") {
      if (
        !nonEmpty(statement.name) ||
        !expression(statement.value, errors, `${p}.value`, functionIds)
      )
        errors.push(`${p} let statement is invalid`);
      if (statement.declaredTypeRef !== undefined)
        checkType(
          statement.declaredTypeRef,
          statement.declaredType,
          errors,
          `${p}.declaredType`,
        );
    } else if (statement.kind === "return") {
      if (!expression(statement.value, errors, `${p}.value`, functionIds))
        errors.push(`${p} return statement is invalid`);
    } else if (statement.kind === "assign") {
      if (
        !nonEmpty(statement.name) ||
        !expression(statement.value, errors, `${p}.value`, functionIds)
      )
        errors.push(`${p} assign statement is invalid`);
    } else if (statement.kind === "expect") {
      if (!expression(statement.actual, errors, `${p}.actual`, functionIds))
        errors.push(`${p} expectation actual value is invalid`);
      if (!expression(statement.expected, errors, `${p}.expected`, functionIds))
        errors.push(`${p} expectation expected value is invalid`);
    } else if (statement.kind === "if") {
      if (
        !expression(statement.condition, errors, `${p}.condition`, functionIds)
      )
        errors.push(`${p} if condition is invalid`);
      statements(statement.thenBody, errors, `${p}.thenBody`, functionIds, asyncFunction);
      if (statement.elseBody !== undefined)
        statements(statement.elseBody, errors, `${p}.elseBody`, functionIds, asyncFunction);
    } else if (statement.kind === "for") {
      if (
        !nonEmpty(statement.name) ||
        !expression(statement.iterable, errors, `${p}.iterable`, functionIds)
      )
        errors.push(`${p} for statement is invalid`);
      statements(statement.body, errors, `${p}.body`, functionIds, asyncFunction);
    } else if (statement.kind === "while") {
      if (
        !expression(statement.condition, errors, `${p}.condition`, functionIds)
      )
        errors.push(`${p} while condition is invalid`);
      statements(statement.body, errors, `${p}.body`, functionIds, asyncFunction);
    } else if (statement.kind === "repeat") {
      if (!expression(statement.count, errors, `${p}.count`, functionIds))
        errors.push(`${p} repeat count is invalid`);
      statements(statement.body, errors, `${p}.body`, functionIds, asyncFunction);
    } else if (statement.kind === "transaction") {
      if (!asyncFunction)
        errors.push(`${p} transaction must be inside an async function`);
      if (!expression(statement.database, errors, `${p}.database`, functionIds))
        errors.push(`${p} transaction database capability is invalid`);
      statements(statement.body, errors, `${p}.body`, functionIds, asyncFunction);
    } else if (statement.kind === "break" || statement.kind === "continue") {
      // These control-transfer nodes carry no expression children.
    } else errors.push(`${p} has an unknown statement kind`);
  });
}

export function validateSerializedIR(value: unknown): IRValidation {
  const errors: string[] = [];
  if (!object(value)) return { valid: false, errors: ["IR must be an object"] };
  if (value.version !== "0.1-alpha" || value.irVersion !== 2)
    errors.push("Unsupported IR version");
  if (
    !object(value.app) ||
    !nonEmpty(value.app.id) ||
    !nonEmpty(value.app.name)
  )
    errors.push("IR app is invalid");
  for (const key of ["models", "records", "pages", "apis", "functions"])
    if (!Array.isArray(value[key])) errors.push(`IR ${key} must be an array`);
  const field = (x: unknown, w: string) => {
    if (
      !object(x) ||
      !nonEmpty(x.id) ||
      !nonEmpty(x.name) ||
      !nonEmpty(x.type)
    ) {
      errors.push(`${w} is invalid`);
      return;
    }
    if (x.typeRef !== undefined) checkType(x.typeRef, x.type, errors, w);
  };
  for (const key of ["models", "records"] as const)
    if (Array.isArray(value[key]))
      value[key].forEach((x, i) => {
        const w = `IR ${key}[${i}]`;
        if (
          !object(x) ||
          !nonEmpty(x.id) ||
          !nonEmpty(x.name) ||
          !Array.isArray(x.fields)
        )
          errors.push(`${w} is invalid`);
        else {
          if (key === "models" && x.typeRef !== undefined)
            checkType(x.typeRef, x.name, errors, `${w}.typeRef`);
          x.fields.forEach((f, j) => field(f, `${w}.fields[${j}]`));
        }
      });
  if (Array.isArray(value.enums))
    value.enums.forEach((x, i) => {
      const w = `IR enums[${i}]`;
      if (
        !object(x) ||
        !nonEmpty(x.id) ||
        !nonEmpty(x.name) ||
        !Array.isArray(x.variants)
      )
        errors.push(`${w} is invalid`);
      else
        x.variants.forEach((v, j) => {
          if (!object(v) || !nonEmpty(v.name))
            errors.push(`${w}.variants[${j}] is invalid`);
          else if (v.payload !== undefined && !typeRefFromUnknown(v.payload))
            errors.push(`${w}.variants[${j}] payload is invalid`);
        });
    });
  const interfaceIds = new Set<string>();
  const interfaceMethodIds = new Set<string>();
  knownInterfaceMethodIds = interfaceMethodIds;
  const interfaceMethods = new Map<string, Set<string>>();
  if (value.interfaces !== undefined) {
    if (!Array.isArray(value.interfaces))
      errors.push("IR interfaces must be an array");
    else {
      value.interfaces.forEach((x, i) => {
        if (
          !object(x) ||
          !nonEmpty(x.id) ||
          !nonEmpty(x.name) ||
          !strings(x.methods)
        )
          errors.push(`IR interfaces[${i}] is invalid`);
        else if (interfaceIds.has(String(x.id)))
          errors.push(`IR interfaces[${i}] has a duplicate InterfaceId`);
        else {
          interfaceIds.add(String(x.id));
          interfaceMethods.set(String(x.id), new Set(x.methods as string[]));
          if (
            x.methodIds !== undefined &&
            (!strings(x.methodIds) ||
              (x.methodIds as string[]).length !==
                (x.methods as string[]).length ||
              new Set(x.methodIds as string[]).size !==
                (x.methodIds as string[]).length ||
              (x.methodIds as string[]).some(
                (id) =>
                  !(
                    id.startsWith(`${x.id}:`) ||
                    id.startsWith(`${x.id}::method::`)
                  ),
              ))
          )
            errors.push(`IR interfaces[${i}] has invalid interface method IDs`);
          else if (Array.isArray(x.methodIds))
            (x.methodIds as string[]).forEach((id) => {
              if (interfaceMethodIds.has(id))
                errors.push(
                  `IR interfaces[${i}] has a duplicate InterfaceMethodId`,
                );
              interfaceMethodIds.add(id);
            });
        }
      });
    }
  }
  if (value.implementations !== undefined) {
    if (!Array.isArray(value.implementations))
      errors.push("IR implementations must be an array");
    else {
      const keys = new Set<string>();
      value.implementations.forEach((x, i) => {
        if (
          !object(x) ||
          !nonEmpty(x.interfaceId) ||
          !nonEmpty(x.type) ||
          !strings(x.methods)
        )
          errors.push(`IR implementations[${i}] is invalid`);
        else {
          const declared = interfaceMethods.get(String(x.interfaceId));
          if (interfaceIds.size && !interfaceIds.has(String(x.interfaceId)))
            errors.push(
              `IR implementations[${i}] references an unknown InterfaceId`,
            );
          if (
            declared &&
            ((x.methods as string[]).some((name) => !declared.has(name)) ||
              new Set(x.methods as string[]).size !==
                (x.methods as string[]).length ||
              (x.methodIds !== undefined &&
                Array.isArray(x.methodIds) &&
                (x.methodIds as string[]).length !==
                  (x.methods as string[]).length))
          )
            errors.push(
              `IR implementations[${i}] has methods that do not match its interface`,
            );
          const key = `${x.interfaceId}::${x.type}`;
          if (keys.has(key))
            errors.push(`IR implementations[${i}] is duplicated`);
          keys.add(key);
        }
      });
    }
  }
  if (Array.isArray(value.interfaces))
    value.interfaces.forEach((x, i) => {
      if (object(x) && Array.isArray(x.requirements)) {
        const names = new Set(
          (Array.isArray(x.methods) ? x.methods : ([] as unknown[])).filter(
            (v: unknown) => typeof v === "string",
          ) as string[],
        );
        (x.requirements as unknown[]).forEach((r, j) => {
          if (
            !object(r) ||
            !nonEmpty(r.id) ||
            !nonEmpty(r.name) ||
            !names.has(String(r.name)) ||
            !Array.isArray(r.parameters) ||
            !object(r.returnType)
          )
            errors.push(`IR interfaces[${i}].requirements[${j}] is invalid`);
        });
      }
    });
  const functionIds = new Set<string>();
  const seenFunctionIds = new Set<string>();
  currentFunctionShapes = new Map();
  if (Array.isArray(value.functions))
    for (const f of value.functions)
      if (object(f) && nonEmpty(f.id) && Array.isArray(f.parameters)) {
        functionIds.add(String(f.id));
        currentFunctionShapes.set(String(f.id), {
          parameters: f.parameters,
          returnTypeRef: f.returnTypeRef,
        });
      }
  if (Array.isArray(value.implementations))
    value.implementations.forEach((x, i) => {
      if (!object(x) || x.methodIds === undefined) return;
      const ids = x.methodIds as unknown[],
        methods = x.methods as unknown[];
      if (
        !Array.isArray(ids) ||
        !Array.isArray(methods) ||
        ids.length !== methods.length ||
        ids.some((id) => typeof id !== "string" || !functionIds.has(id))
      )
        errors.push(
          `IR implementations[${i}] has invalid implementation FunctionIds`,
        );
      if (x.methodSignatures !== undefined) {
        if (
          !Array.isArray(x.methodSignatures) ||
          x.methodSignatures.length !== methods.length
        )
          errors.push(`IR implementations[${i}] has invalid method signatures`);
        else
          (x.methodSignatures as unknown[]).forEach((sig, j) => {
            if (
              !object(sig) ||
              !nonEmpty(sig.id) ||
              !nonEmpty(sig.name) ||
              !Array.isArray(sig.parameters) ||
              !object(sig.returnType) ||
              String(sig.name) !== String(methods[j]) ||
              String(sig.id) !== String(ids[j])
            )
              errors.push(
                `IR implementations[${i}].methodSignatures[${j}] is invalid`,
              );
            else {
              (sig.parameters as unknown[]).forEach((p, k) =>
                field(
                  p,
                  `IR implementations[${i}].methodSignatures[${j}].parameters[${k}]`,
                ),
              );
              field(
                sig.returnType,
                `IR implementations[${i}].methodSignatures[${j}].returnType`,
              );
              if (sig.receiver !== undefined)
                field(
                  sig.receiver,
                  `IR implementations[${i}].methodSignatures[${j}].receiver`,
                );
            }
          });
      }
    });
  if (Array.isArray(value.functions))
    value.functions.forEach((f, i) => {
      const w = `IR functions[${i}]`;
      if (
        !object(f) ||
        !nonEmpty(f.id) ||
        !nonEmpty(f.name) ||
        !nonEmpty(f.returnType) ||
        !Array.isArray(f.parameters) ||
        !Array.isArray(f.body) ||
        !f.returnTypeRef
      ) {
        errors.push(`${w} is invalid`);
        return;
      }
      if (seenFunctionIds.has(String(f.id)))
        errors.push(`${w} has a duplicate function ID`);
      seenFunctionIds.add(String(f.id));
      checkType(f.returnTypeRef, f.returnType, errors, `${w}.returnType`);
      const names = new Set<string>();
      f.parameters.forEach((p, j) => {
        if (
          !object(p) ||
          !nonEmpty(p.name) ||
          names.has(String(p.name)) ||
          !nonEmpty(p.type) ||
          !p.typeRef
        )
          errors.push(`${w}.parameters[${j}] is invalid`);
        else {
          names.add(String(p.name));
          checkType(p.typeRef, p.type, errors, `${w}.parameters[${j}]`);
        }
      });
      if (f.recordSchemas !== undefined && !object(f.recordSchemas))
        errors.push(`${w}.recordSchemas is invalid`);
      else if (object(f.recordSchemas))
        for (const [name, schema] of Object.entries(f.recordSchemas)) {
          if (
            !object(schema) ||
            !nonEmpty(schema.symbol) ||
            !["record", "model"].includes(String(schema.kind)) ||
            !object(schema.fields)
          )
            errors.push(`${w}.recordSchemas.${name} is invalid`);
          else
            for (const [fieldName, type] of Object.entries(schema.fields))
              if (!typeRefFromUnknown(type))
                errors.push(
                  `${w}.recordSchemas.${name}.${fieldName} TypeRef is invalid`,
                );
        }
      statements(f.body, errors, `${w}.body`, functionIds, Boolean(f.async));
    });
  if (Array.isArray(value.functions))
    value.functions.forEach((f, i) => {
      if (
        object(f) &&
        f.visibility !== undefined &&
        !["public", "private"].includes(String(f.visibility))
      )
        errors.push(`IR functions[${i}] visibility is invalid`);
      if (object(f) && f.async !== undefined && typeof f.async !== "boolean")
        errors.push(`IR functions[${i}] async metadata is invalid`);
      if (object(f) && f.async === true) {
        const returnType = typeRefFromUnknown(f.returnTypeRef);
        if (!returnType || returnType.kind !== "task")
          errors.push(`IR functions[${i}] async function must return task<T>`);
      }
    });
  if (Array.isArray(value.modules))
    value.modules.forEach((m, i) => {
      if (
        !object(m) ||
        !nonEmpty(m.id) ||
        !nonEmpty(m.file) ||
        !strings(m.imports) ||
        !strings(m.symbols) ||
        (m.importIds !== undefined && !strings(m.importIds)) ||
        (m.symbolIds !== undefined && !strings(m.symbolIds))
      )
        errors.push(`IR modules[${i}] is invalid`);
    });
  if (Array.isArray(value.functions))
    value.functions.forEach((f, i) => {
      if (!object(f) || f.constraints === undefined) return;
      const list = f.constraints;
      const w = `IR functions[${i}].constraints`;
      if (!Array.isArray(list)) errors.push(`${w} must be an array`);
      else
        list.forEach((c, j) => {
          if (
            !object(c) ||
            !nonEmpty(c.parameter) ||
            !nonEmpty(c.interfaceId) ||
            !Array.isArray(f.typeParameters) ||
            (f.typeParameters as unknown[]).indexOf(c.parameter) < 0 ||
            (interfaceIds.size > 0 && !interfaceIds.has(String(c.interfaceId)))
          )
            errors.push(`${w}[${j}] is invalid`);
        });
    });
  for (const key of ["models", "records", "enums", "interfaces"] as const)
    if (Array.isArray(value[key]))
      value[key].forEach((entry, i) => {
        if (
          object(entry) &&
          entry.visibility !== undefined &&
          !["public", "private"].includes(String(entry.visibility))
        )
          errors.push(`IR ${key}[${i}] visibility is invalid`);
      });
  if (value.http !== undefined) {
    if (!object(value.http) || !Array.isArray(value.http.routes))
      errors.push("IR http is invalid");
    else
      errors.push(
        ...validateHttp(value.http as unknown as HttpProgram).map(
          (error) => `IR http: ${error}`,
        ),
      );
  }
  if (value.db !== undefined)
    errors.push(
      ...validateDbSchema(value.db as unknown as DbSchema).map(
        (error) => `IR db: ${error}`,
      ),
    );
  if (value.ui !== undefined) {
    if (
      !object(value.ui) ||
      !Array.isArray(value.ui.components) ||
      !Array.isArray(value.ui.routes)
    )
      errors.push("IR ui is invalid");
    else
      errors.push(
        ...validateUI(value.ui as unknown as UIProgram).map(
          (error) => `IR ui: ${error}`,
        ),
      );
    if (object(value.ui) && Array.isArray(value.ui.components)) {
      const routes = object(value.http) && Array.isArray(value.http.routes) ? value.http.routes : [];
      for (const component of value.ui.components) {
        if (!object(component) || !Array.isArray(component.state)) continue;
        for (const state of component.state) {
          if (!object(state) || !object(state.source)) continue;
          const source = state.source;
          const path = source.path;
          const route = routes.find(candidate => object(candidate) && candidate.method === 'GET' && candidate.path === path);
          const pageRoute = object(value.ui) && Array.isArray(value.ui.routes) ? value.ui.routes.find(candidate => object(candidate) && candidate.componentId === component.id) : undefined;
          const sourceParameters = nonEmpty(path) ? [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!) : [];
          const sourceRouteParameters = object(route) && Array.isArray(route.pathParams) ? route.pathParams : [];
          const pageParameters = object(pageRoute) && nonEmpty(pageRoute.path) ? [...pageRoute.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!) : [];
          const stateType = typeRefFromUnknown(state.type);
          const responseType = object(route) ? typeRefFromUnknown(route.responseBody) : undefined;
          const staticParametersValid = sourceParameters.length === 0 && Array.isArray(route?.pathParams) && route.pathParams.length === 0;
          const dynamicParametersValid = sourceParameters.length > 0 && sourceParameters.length === pageParameters.length && sourceParameters.every((name, index) => name === pageParameters[index]) && Array.isArray(route?.pathParams) && route.pathParams.length === sourceParameters.length && sourceParameters.every(name => route.pathParams.some((parameter: unknown) => { if (!object(parameter) || parameter.name !== name) return false; const parameterType = typeRefFromUnknown(parameter.type); const textParameter = parameterType?.kind === 'primitive' && parameterType.name === 'text'; const integerParameter = parameterType?.kind === 'primitive' && parameterType.name === 'integer'; return textParameter || integerParameter; }));
          if (source.method !== 'GET' || !nonEmpty(path) || path.includes('?') || !object(route) || !(staticParametersValid || dynamicParametersValid) || !Array.isArray(route.query) || route.query.length !== 0 || !stateType || !responseType || !isSameType(stateType, responseType))
            errors.push(`IR ui: page state source for "${String(state.name)}" must match a static GET or its page's typed dynamic GET response type`);
          if (source.search !== undefined) {
            const search = object(source.search) ? source.search as Record<string, unknown> : {};
            const searchPath = typeof search.path === 'string' ? search.path : '';
            const searchRoute = routes.find(candidate => object(candidate) && candidate.method === 'GET' && candidate.path === searchPath);
            const searchParams = object(searchRoute) && Array.isArray(searchRoute.pathParams) ? searchRoute.pathParams : [];
            const searchResponse = object(searchRoute) ? typeRefFromUnknown(searchRoute.responseBody) : undefined;
            const searchParameter = searchParams.find(parameter => object(parameter) && parameter.name === search.parameter);
            const searchParameterType = object(searchParameter) ? typeRefFromUnknown(searchParameter.type) : undefined;
            const searchPathParameters = [...searchPath.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]);
            const searchScopeParameters = sourceParameters.every(name => searchPathParameters.includes(name) && searchParams.some((parameter: unknown) => {
              if (!object(parameter) || parameter.name !== name) return false;
              const searchType = typeRefFromUnknown(parameter.type);
              const sourceParameter = sourceRouteParameters.find((candidate: unknown) => object(candidate) && candidate.name === name);
              const sourceType = object(sourceParameter) ? typeRefFromUnknown(sourceParameter.type) : undefined;
              return Boolean(searchType && sourceType && isSameType(searchType, sourceType));
            }));
            const searchOnlyParameters = searchPathParameters.filter(name => !sourceParameters.includes(name));
            if (search.method !== 'GET' || !nonEmpty(searchPath) || searchPath.includes('?') || searchPathParameters.length !== sourceParameters.length + 1 || new Set(searchPathParameters).size !== searchPathParameters.length || searchOnlyParameters.length !== 1 || searchOnlyParameters[0] !== search.parameter || searchParams.length !== sourceParameters.length + 1 || !searchScopeParameters || !Array.isArray(searchRoute?.query) || searchRoute.query.length !== 0 || !Array.isArray(searchRoute?.headers) || searchRoute.headers.length !== 0 || searchParameterType?.kind !== 'primitive' || searchParameterType.name !== 'text' || !searchResponse || !stateType || !isSameType(stateType, searchResponse))
              errors.push(`IR ui: page state search for "${String(state.name)}" must match its typed route scope plus one text search parameter`);
          }
          const validateCursor = (next: Record<string, unknown>, searchPlaceholder?: string) => {
            const nextRoute = routes.find(candidate => object(candidate) && candidate.method === 'GET' && candidate.path === next.path);
            const params = object(nextRoute) && Array.isArray(nextRoute.pathParams) ? nextRoute.pathParams : [];
            const nextQuery = object(nextRoute) && Array.isArray(nextRoute.query) ? nextRoute.query : undefined;
            const nextHeaders = object(nextRoute) && Array.isArray(nextRoute.headers) ? nextRoute.headers : undefined;
            const cursorParameter = params.find(param => object(param) && param.name === next.parameter);
            const nextResponse = object(nextRoute) ? typeRefFromUnknown(nextRoute.responseBody) : undefined;
            const ref = stateType?.kind === 'list' ? stateType.element : undefined;
            const refName = ref?.kind === 'model' || ref?.kind === 'record' ? ref.name : undefined;
            const dataTypes = [...(Array.isArray(value.models) ? value.models : []), ...(Array.isArray(value.records) ? value.records : [])];
            const recordType = dataTypes.find((type: unknown) => object(type) && type.name === refName && Array.isArray(type.fields));
            const cursorFields = object(recordType) && Array.isArray(recordType.fields) ? recordType.fields : [];
            const field = cursorFields.find((candidate: unknown) => object(candidate) && candidate.name === next.cursorField);
            const implicitModelId = ref?.kind === 'model' && next.cursorField === 'id';
            const nextPath = typeof next.path === 'string' ? next.path : '';
            const placeholders = [...nextPath.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]);
            const expectedPlaceholders = sourceParameters.length + (searchPlaceholder ? 1 : 0) + 1;
            const sourceParams = object(route) && Array.isArray(route.pathParams) ? route.pathParams : [];
            const sourceParamsValid = sourceParameters.every(name => placeholders.includes(name) && params.some((param: unknown) => {
              if (!object(param) || param.name !== name) return false;
              const nextType = typeRefFromUnknown(param.type);
              const sourceParam = sourceParams.find((candidate: unknown) => object(candidate) && candidate.name === name);
              const sourceType = object(sourceParam) ? typeRefFromUnknown(sourceParam.type) : undefined;
              return Boolean(nextType && sourceType && isSameType(nextType, sourceType));
            }));
            const cursorParamType = object(cursorParameter) ? typeRefFromUnknown(cursorParameter.type) : undefined;
            const fieldType = implicitModelId ? typeRefFromUnknown({ kind: 'primitive', name: 'integer' }) : object(field) && (field.type === 'text' || field.type === 'integer') ? typeRefFromUnknown({ kind: 'primitive', name: field.type }) : undefined;
            const uniqueCursor = implicitModelId || object(field) && field.unique === true;
            const searchCursorParam = searchPlaceholder ? params.find(param => object(param) && param.name === searchPlaceholder) : undefined;
            const searchCursorType = object(searchCursorParam) ? typeRefFromUnknown(searchCursorParam.type) : undefined;
            if (next.method !== 'GET' || !nonEmpty(nextPath) || nextPath.includes('?') || placeholders.length !== expectedPlaceholders || new Set(placeholders).size !== placeholders.length || !placeholders.includes(String(next.parameter)) || !sourceParamsValid || searchPlaceholder && (!placeholders.includes(searchPlaceholder) || searchPlaceholder === next.parameter || searchCursorType?.kind !== 'primitive' || searchCursorType.name !== 'text') || params.length !== expectedPlaceholders || !nextQuery || nextQuery.length !== 0 || !nextHeaders || nextHeaders.length !== 0 || !cursorParamType || !fieldType || !isSameType(cursorParamType, fieldType) || !uniqueCursor || !nextResponse || !stateType || !isSameType(stateType, nextResponse))
              errors.push(`IR ui: page state cursor for "${String(state.name)}" must match a cursor GET list response and a unique text or integer field`);
          };
          if (source.next !== undefined && object(source.next)) validateCursor(source.next as Record<string, unknown>);
          const searchSource = object(source.search) ? source.search as Record<string, unknown> : undefined;
          if (searchSource && searchSource.next !== undefined && object(searchSource.next)) validateCursor(searchSource.next as Record<string, unknown>, typeof searchSource.parameter === 'string' ? searchSource.parameter : '');
          if (searchSource && source.next !== undefined && (searchSource.next === undefined || !object(searchSource.next)))
            errors.push(`IR ui: page state search for "${String(state.name)}" requires a search-aware cursor route`);
        }
      }
    }
  }
  if (value.style !== undefined) validateStyle(value.style, errors);
  if (value.styles !== undefined) {
    if (!Array.isArray(value.styles)) errors.push("IR styles is invalid");
    else
      value.styles.forEach((style, index) => {
        if (!object(style) || !nonEmpty(style.name))
          errors.push(`IR styles[${index}] name is invalid`);
        validateStyle(style, errors);
      });
  }
  return { valid: errors.length === 0, errors };
}
export function assertSerializedIR(value: unknown): asserts value is ProjectIR {
  const result = validateSerializedIR(value);
  if (!result.valid)
    throw new Error(`PIPE-IR-001: ${result.errors.join("; ")}`);
}
