import type { Program } from "../ast/ast.js";
import { analyzeProgram, type SemanticProgram } from "../semantic/analyze.js";
import {
  formatType,
  listType,
  primitive,
  type TypeRef,
} from "../types/type-ref.js";
import {
  resolveConstrainedDispatch,
  monomorphizeConstrainedCalls,
  type CoreFunction,
} from "../core/analysis.js";
import { analyzeContracts } from "../semantic/contracts.js";
import type { HttpProgram, HttpRoute } from "../http/ir.js";
import { dbSchemaFromProjectModels, type DbSchema } from "../db/ir.js";
import type { UIProgram } from "../ui/ir.js";
import { typedStyleValue, type BMECStyleValue } from "../style/values.js";

export interface IRTypeField {
  id: string;
  name: string;
  type: string;
  typeRef?: TypeRef;
  required?: boolean;
  unique?: boolean;
  default?: string | number | boolean;
}
export interface IREnum {
  id: string;
  name: string;
  visibility?: "public" | "private";
  variants: { name: string; payload?: TypeRef }[];
}
export interface IRStyle {
  id: string;
  token?: boolean;
  name?: string;
  values: string[];
  composes?: string[];
  padding?: number;
  gap?: number;
  margin?: number;
  width?: number;
  height?: number;
  opacity?: number;
  columns?: number;
  responsiveColumns?: number;
  responsiveGap?: number;
  responsivePadding?: number;
  responsiveMargin?: number;
  responsiveFontSize?: number;
  responsiveLineHeight?: number;
  responsiveLayout?: "row" | "column" | "grid";
  typedValues?: BMECStyleValue[];
  properties?: { name: "background" | "opacity" | "textColor"; value: "blue" | "neutral" | "red" | "green" | "dark-blue" | "white" | "black" | "inherit" | number }[];
  states?: { state: "hovered" | "focused" | "active" | "disabled"; properties: { name: "background" | "opacity" | "textColor"; value: "blue" | "neutral" | "red" | "green" | "dark-blue" | "white" | "black" | "inherit" | number }[] }[];
  responsive?: "stacked" | "fluid";
  layout?: "row" | "column" | "grid";
  alignment?: "start" | "center" | "end" | "stretch";
  typography?: "readable" | "compact";
  fontWeight?: "normal" | "bold";
  fontSize?: number;
  lineHeight?: number;
  spacing?: "comfortable" | "compact";
  theme?: "light" | "dark" | "calm" | "contrast";
  color?: "blue" | "muted" | "red" | "green";
  border?: "subtle" | "strong" | "red" | "green";
  shadow?: "soft" | "strong";
  corners?: "rounded" | "pill";
  radius?: number;
  disabled?: "guarded";
  focus?: "ringed";
  surface?: "elevated";
  text?: "muted";
  textColor?: "white" | "black" | "inherit";
  transitionDuration?: number;
  transitionProperty?: "all" | "background" | "color" | "transform" | "opacity";
  transitionEasing?: "ease" | "linear";
}
export interface ProjectIR {
  irVersion?: 2;
  version: "0.1-alpha";
  app: { id: string; name: string; metadata?: { description?: string; canonical?: string } };
  models: {
    id: string;
    name: string;
    typeRef?: TypeRef;
    visibility?: "public" | "private";
    fields: IRTypeField[];
  }[];
  records: {
    id: string;
    name: string;
    visibility?: "public" | "private";
    fields: IRTypeField[];
  }[];
  db?: DbSchema;
  enums?: IREnum[];
  interfaces?: {
    id: string;
    name: string;
    visibility?: "public" | "private";
    methods: string[];
    methodIds?: string[];
    requirements?: {
      id: string;
      name: string;
      receiver?: IRTypeField;
      parameters: IRTypeField[];
      returnType: IRTypeField;
    }[];
  }[];
  implementations?: {
    id?: string;
    interfaceId: string;
    type: string;
    methods: string[];
    methodIds?: string[];
    methodSignatures?: {
      id: string;
      name: string;
      receiver?: IRTypeField;
      parameters: IRTypeField[];
      returnType: IRTypeField;
    }[];
  }[];
  pages: {
    id: string;
    name: string;
    route?: string;
    crud: string[];
    crudExcludedFields?: { model: string; fields: string[] }[];
    state?: {
      name: string;
      type: string;
      initial?: unknown;
      persisted?: "local";
      source?: {
        method: "GET";
        path: string;
        next?: { method: "GET"; path: string; parameter: string; cursorField: string };
        search?: { method: "GET"; path: string; parameter: string; next?: { method: "GET"; path: string; parameter: string; cursorField: string } };
      };
    }[];
    events?: { name: string; parameters: { name: string; type: string }[]; stateUpdate?: { operation: "append" | "remove" | "increment" | "decrement"; state: string; parameter: string; field?: string; projection?: unknown }; successUpdate?: { operation: "clear"; state: string } }[];
  }[];
  ui?: UIProgram;
  apis: { id: string; route: string; model: string; operations: string[]; policyId?: string }[];
  http?: HttpProgram;
  functions: CoreFunction[];
  style?: IRStyle;
  styles?: IRStyle[];
  modules?: {
    id: string;
    file: string;
    imports: string[];
    importIds?: string[];
    symbols: string[];
    symbolIds?: string[];
  }[];
}
export type CoreFunctionIR = CoreFunction;

/** Lower source model APIs to a complete typed CRUD HTTP contract. */
function sourceApiRoutes(p: Program, semantic: SemanticProgram): HttpRoute[] {
  return p.declarations
    .filter((x) => x.kind === "ApiDeclaration")
    .flatMap((api, index) => {
      const model = semantic.resolveType(api.model);
      if (!model || model.kind !== "model") return [];
      const id = `SOURCE-API-${String(index + 1).padStart(3, "0")}`,
        idField = { name: "id", type: primitive("integer"), required: true };
      const routes: HttpRoute[] = [
        {
          id: `${id}:get`,
          method: "GET" as const,
          path: api.route,
          pathParams: [],
          query: [],
          headers: [],
          responseBody: listType(model),
          status: 200,
          handlerId: `${id}:get`,
          capabilities: ["database"],
          ...(api.policyId ? { policyId: api.policyId } : {}),
        },
        {
          id: `${id}:create`,
          method: "POST" as const,
          path: api.route,
          pathParams: [],
          query: [],
          headers: [],
          requestBody: model,
          responseBody: primitive("integer"),
          status: 201,
          errorStatuses: [400],
          handlerId: `${id}:create`,
          capabilities: ["database"],
          ...(api.policyId ? { policyId: api.policyId } : {}),
        },
        {
          id: `${id}:read`,
          method: "GET" as const,
          path: `${api.route}/:id`,
          pathParams: [idField],
          query: [],
          headers: [],
          responseBody: model,
          status: 200,
          errorStatuses: [404],
          handlerId: `${id}:read`,
          capabilities: ["database"],
          ...(api.policyId ? { policyId: api.policyId } : {}),
        },
        {
          id: `${id}:update`,
          method: "PUT" as const,
          path: `${api.route}/:id`,
          pathParams: [idField],
          query: [],
          headers: [],
          requestBody: model,
          responseBody: primitive("integer"),
          status: 200,
          errorStatuses: [400, 404],
          handlerId: `${id}:update`,
          capabilities: ["database"],
          ...(api.policyId ? { policyId: api.policyId } : {}),
        },
        {
          id: `${id}:delete`,
          method: "DELETE" as const,
          path: `${api.route}/:id`,
          pathParams: [idField],
          query: [],
          headers: [],
          responseBody: primitive("integer"),
          status: 200,
          errorStatuses: [404],
          handlerId: `${id}:delete`,
          capabilities: ["database"],
          ...(api.policyId ? { policyId: api.policyId } : {}),
        },
      ];
      return routes.filter(
        (route) =>
          !p.declarations.some(
            (declaration) =>
              declaration.kind === "HttpDeclaration" &&
              declaration.method === route.method &&
              declaration.path === route.path,
          ),
      );
    });
}

/** Lower source API declarations to the canonical typed HTTP contract IR. */
export function sourceHttpProgram(
  p: Program,
  semantic?: SemanticProgram,
): HttpProgram {
  const checked = semantic ?? analyzeProgram(p);
  const modelRoutes = sourceApiRoutes(p, checked);
  const functionRoutes = p.declarations
    .filter((x) => x.kind === "HttpDeclaration")
    .flatMap((declaration, index) => {
      const functionValue = checked.functions.find(
        (fn) => fn.name === declaration.handler,
      );
      if (!functionValue) return [];
      const response =
        functionValue.returnTypeRef.kind === "task"
          ? functionValue.returnTypeRef.result
          : functionValue.returnTypeRef;
      const placeholders = [
        ...declaration.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g),
      ].map((match) => match[1]!);
      const pathParams = placeholders.flatMap((name) => {
        const parameter = functionValue.parameters.find(
          (item) => item.name === name,
        );
        return parameter
          ? [{ name, type: parameter.typeRef, required: true }]
          : [];
      });
      const bodyParameter =
        declaration.method !== "GET"
          ? functionValue.parameters.find((item) => item.name === "body")
          : undefined;
      const principalParameter = functionValue.parameters.find(
        (item) => item.typeRef.kind === "record" && item.typeRef.name === "Principal",
      );
      const headerNames = new Set(declaration.headers ?? []);
      const headers = (declaration.headers ?? []).flatMap((name) => {
        const parameter = functionValue.parameters.find((item) => item.name === name);
        return parameter ? [{name, type: parameter.typeRef, required: parameter.typeRef.kind !== "optional"}] : [];
      });
      const sourceApi = p.declarations.find(
        (candidate) => candidate.kind === "ApiDeclaration" && candidate.route === declaration.path,
      );
      const routePolicyId = declaration.policyId ?? (sourceApi?.kind === "ApiDeclaration" ? sourceApi.policyId : undefined);
      const query = functionValue.parameters
        .filter(
          (parameter) =>
            !placeholders.includes(parameter.name) &&
            !headerNames.has(parameter.name) &&
            parameter !== bodyParameter &&
            parameter.typeRef.kind !== "capability" &&
            parameter !== principalParameter,
        )
        .map((parameter) => ({
          name: parameter.name,
          type: parameter.typeRef,
          required: parameter.typeRef.kind !== "optional",
        }));
      return [
        {
          id: `SOURCE-HTTP-${String(index + 1).padStart(3, "0")}`,
          method: declaration.method,
          path: declaration.path,
          pathParams,
          query,
          headers,
          ...(bodyParameter ? { requestBody: bodyParameter.typeRef } : {}),
          responseBody: response,
          status: declaration.status ?? 200,
          ...(declaration.errorStatuses ? {errorStatuses: declaration.errorStatuses} : {}),
          handlerId: String(functionValue.id),
          ...(declaration.capabilities
            ? { capabilities: declaration.capabilities }
            : {}),
          ...(routePolicyId ? { policyId: routePolicyId } : {}),
          ...(principalParameter ? { principalParam: principalParameter.name } : {}),
        },
      ];
    });
  return { routes: [...modelRoutes, ...functionRoutes] };
}

/** Lower the already-analyzed semantic program. TypeRefs are never reconstructed from display strings here. */
function toIRCore(p: Program, semantic?: SemanticProgram): ProjectIR {
  const checked = semantic ?? analyzeProgram(p);
  if (checked.index) {
    resolveConstrainedDispatch(checked.functions, checked.index);
    monomorphizeConstrainedCalls(checked.functions, checked.index);
  }
  const app = p.declarations.find((x) => x.kind === "AppDeclaration");
  let mi = 0,
    fi = 0,
    ri = 0,
    rfi = 0,
    ei = 0,
    pi = 0,
    ai = 0;
  const typeOf = (node: object) =>
    checked.typeRefs.get(node) ?? primitive("text");
  const field = (
    f: {
      name: string;
      type: string;
      modifiers?: { kind: string; value?: string | number | boolean }[];
    },
    id: string,
  ): IRTypeField => ({
    id,
    name: f.name,
    type: f.type,
    typeRef: typeOf(f),
    required: f.modifiers?.some((x) => x.kind === "required"),
    unique: f.modifiers?.some((x) => x.kind === "unique"),
    default: f.modifiers?.find((x) => x.kind === "default")?.value,
  });
  const models = p.declarations
    .filter((x) => x.kind === "ModelDeclaration")
    .map((m) => ({
      id: `DB-${String(++mi).padStart(3, "0")}`,
      name: m.name,
      typeRef: checked.resolveType(m.name),
      visibility: m.visibility ?? "private",
      fields: m.fields.map((f) =>
        field(f, `FIELD-${String(++fi).padStart(3, "0")}`),
      ),
    }));
  const records = p.declarations
    .filter((x) => x.kind === "RecordDeclaration")
    .map((r) => ({
      id: `TYPE-${String(++ri).padStart(3, "0")}`,
      name: r.name,
      visibility: r.visibility ?? "private",
      fields: r.fields.map((f) =>
        field(f, `FIELD-T${String(++rfi).padStart(3, "0")}`),
      ),
    }));
  const enums = p.declarations
    .filter((x) => x.kind === "EnumDeclaration")
    .map((e) => ({
      id: `ENUM-${String(++ei).padStart(3, "0")}`,
      name: e.name,
      visibility: e.visibility ?? "private",
      variants: e.variants.map((v) => ({
        name: v.name,
        payload: v.payload ? typeOf(v) : undefined,
      })),
    }));
  const contracts = analyzeContracts(p, {
    functionIds: checked.functionIds,
    index: checked.index,
  });
  const reqField = (t: TypeRef, name: string, id: string): IRTypeField => ({
    id,
    name,
    type: formatType(t),
    typeRef: t,
  });
  const sourceHttp: HttpProgram = { routes: sourceApiRoutes(p, checked) };
  const pageDeclarations = p.declarations.filter(
    (x) => x.kind === "PageDeclaration",
  );
  const pages = pageDeclarations.map((p) => ({
    id: `UI-${String(++pi).padStart(3, "0")}`,
    name: p.name,
    ...(p.route ? { route: p.route } : {}),
    crud: p.statements
      .filter((s) => s.kind === "CrudStatement")
      .map((s) => s.model),
    ...(p.statements.some((s) => s.kind === "CrudStatement" && s.excludedFields?.length)
      ? { crudExcludedFields: p.statements
          .filter((s) => s.kind === "CrudStatement")
          .filter((s) => s.excludedFields?.length)
          .map((s) => ({ model: s.model, fields: [...s.excludedFields!] })) }
      : {}),
    state: p.statements
      .filter((s) => s.kind === "PageStateDeclaration")
      .map((s) => ({
        name: s.name,
        type: formatType(checked.resolveType(s.type) ?? primitive("text")),
        initial: s.initial,
        ...(s.persisted ? { persisted: s.persisted } : {}),
        ...(s.source ? { source: s.source } : {}),
      })),
    events: p.statements
      .filter((s) => s.kind === "PageEventDeclaration")
      .map((s) => ({
        name: s.name,
         ...(s.action ? { action: s.action } : {}),
         ...(s.stateUpdate ? { stateUpdate: s.stateUpdate } : {}),
         ...(s.successUpdate ? { successUpdate: s.successUpdate } : {}),
        parameters: s.parameters.map((parameter) => ({
          name: parameter.name,
          type: formatType(
            checked.resolveType(parameter.type) ?? primitive("text"),
          ),
        })),
      })),
  }));
  const pageComponentId = (name: string) => pages[pageDeclarations.findIndex(page => page.name === name)]!.id;
  const aggregateIsMoney = (componentName: string, sourceName: string, fieldName: string) => pageDeclarations.some(page => {
    const used = page.statements.some(statement => (statement.kind === "PageUseDeclaration" || statement.kind === "PageListDeclaration") && statement.component === componentName);
    if (!used) return false;
    const state = page.statements.find(statement => statement.kind === "PageStateDeclaration" && statement.name === sourceName);
    if (state?.kind !== "PageStateDeclaration" || !state.type.startsWith("list<") || !state.type.endsWith(">")) return false;
    const itemType = state.type.slice(5, -1);
    const declaration = p.declarations.find(candidate => (candidate.kind === "ModelDeclaration" || candidate.kind === "RecordDeclaration") && candidate.name === itemType);
    return declaration?.kind === "ModelDeclaration" || declaration?.kind === "RecordDeclaration" ? declaration.fields.some(field => field.name === fieldName && field.type.replace(/\?$/, "") === "money") : false;
  });
  const componentDeclarations = p.declarations.filter(
    (x) => x.kind === "ComponentDeclaration",
  );
  let dialogIndex = 0;
  const ui: UIProgram = {
    components: [
      ...pageDeclarations.map((page, index) => ({
        id: pages[index]!.id,
        name: page.name,
        style: page.statements.find((statement) => statement.kind === "PageUseStyleDeclaration")?.style,
        props: [],
        state: page.statements
          .filter((s) => s.kind === "PageStateDeclaration")
          .map((s) => ({
            name: s.name,
            type: checked.resolveType(s.type) ?? primitive("text"),
            initial: s.initial,
            ...(s.persisted ? { persisted: s.persisted } : {}),
            ...(s.persisted ? { storageKey: `bmec-state:${p.declarations.find(declaration => declaration.kind === "AppDeclaration")?.kind === "AppDeclaration" ? p.declarations.find(declaration => declaration.kind === "AppDeclaration")!.name : page.name}:${pages[index]!.id}:${s.name}` } : {}),
            ...(s.source ? { source: s.source } : {}),
          })),
        events: page.statements
          .filter((s) => s.kind === "PageEventDeclaration")
          .map((s) => ({
            name: s.name,
            ...(s.action ? { action: s.action } : {}),
            ...(s.successUpdate ? { successUpdate: { ...s.successUpdate, ...(page.statements.some(state => state.kind === "PageStateDeclaration" && state.name === s.successUpdate!.state && state.persisted) ? { storageKey: `bmec-state:${p.declarations.find(declaration => declaration.kind === "AppDeclaration")?.kind === "AppDeclaration" ? p.declarations.find(declaration => declaration.kind === "AppDeclaration")!.name : page.name}:${pages[index]!.id}:${s.successUpdate.state}` } : {}) } } : {}),
            ...(s.stateUpdate ? { stateUpdate: { ...s.stateUpdate, type: checked.resolveType(s.stateUpdate.projection?.typeName ?? s.parameters.find(parameter => parameter.name === s.stateUpdate!.parameter)?.type ?? "") ?? primitive("text"), projection: s.stateUpdate.projection ? { type: checked.resolveType(s.stateUpdate.projection.typeName) ?? primitive("text"), fields: Object.fromEntries(s.stateUpdate.projection.fields.map(field => [field.name, field.value.kind === "FieldAccessExpression" ? { kind: "field" as const, path: field.value.field } : { kind: "literal" as const, value: field.value.kind === "LiteralExpression" ? (field.value.valueType === "text" ? field.value.value : Number(field.value.value)) : field.value.kind === "IdentifierExpression" ? field.value.name === "true" : "" }])) } : undefined, ...(page.statements.some(state => state.kind === "PageStateDeclaration" && state.name === s.stateUpdate!.state && state.persisted) ? { storageKey: `bmec-state:${p.declarations.find(declaration => declaration.kind === "AppDeclaration")?.kind === "AppDeclaration" ? p.declarations.find(declaration => declaration.kind === "AppDeclaration")!.name : page.name}:${pages[index]!.id}:${s.stateUpdate.state}` } : {}) } } : {}),
            parameters: Object.fromEntries(
              s.parameters.map((parameter) => [
                parameter.name,
                checked.resolveType(parameter.type) ?? primitive("text"),
              ]),
            ),
          })),
        children: [
          ...page.statements
            .filter((s) => s.kind === "PageInputDeclaration")
            .map((s) => ({
              kind: "input" as const,
              name: s.name,
              label: s.label,
              placeholder: s.placeholder,
              help: s.help,
              ...(s.disabled ? { disabled: true } : {}),
              ...(s.readOnly ? { readOnly: true } : {}),
              ...(s.password ? { password: true } : {}),
              type: checked.resolveType(s.type) ?? primitive("text"),
              validation: s.validation,
              event: s.event,
            })),
          ...page.statements
            .filter((s) => s.kind === "PageUseDeclaration")
            .flatMap((s) => {
              const componentIndex = componentDeclarations.findIndex(
                (component) => component.name === s.component,
              );
              return componentIndex < 0
                ? []
                : [
                    {
                      kind: "component" as const,
                      componentId: `COMP-${String(componentIndex + 1).padStart(3, "0")}`,
                      props: {},
                    },
                ];
            }),
          ...page.statements
            .filter((s) => s.kind === "PageLinkDeclaration")
            .map((s) => ({ kind: "link" as const, label: s.label, targetComponentId: pageComponentId(s.target), ...(s.parameters ? { parameters: s.parameters } : {}) })),
          ...page.statements
            .filter((s) => s.kind === "PageDialogDeclaration")
            .map((s) => ({ kind: "dialog" as const, dialogId: `DIALOG-${String(++dialogIndex).padStart(3, "0")}`, label: s.label, title: s.title, message: s.message })),
        ],
      })),
      ...componentDeclarations.map((component, index) => ({
        id: `COMP-${String(index + 1).padStart(3, "0")}`,
        name: component.name,
        style: component.style,
        form: component.form,
        props: [],
        state: [],
        events: [],
        children: component.children.map((child) =>
          child.kind === "ComponentTextDeclaration"
            ? { kind: "text" as const, value: child.value }
            : child.kind === "PageLinkDeclaration"
              ? { kind: "link" as const, label: child.label, targetComponentId: pageComponentId(child.target), ...(child.parameters ? { parameters: child.parameters } : {}) }
              : child.kind === "PageDialogDeclaration"
                ? { kind: "dialog" as const, dialogId: `DIALOG-${String(++dialogIndex).padStart(3, "0")}`, label: child.label, title: child.title, message: child.message }
            : child.kind === "ComponentAggregateDeclaration"
              ? { kind: "aggregate" as const, source: child.source, field: child.field, ...(child.multiplier ? { multiplier: child.multiplier } : {}), ...(aggregateIsMoney(component.name, child.source, child.field) ? { money: true as const } : {}) }
            : child.kind === "ComponentBindingDeclaration"
              ? { kind: "binding" as const, path: child.path }
            : child.kind === "ComponentButtonDeclaration"
              ? {
                  kind: "button" as const,
                  label: child.label,
                  event: child.event,
                  ...(child.arguments ? { arguments: child.arguments.map(argument => ({ ...argument })) } : {}),
                }
              : child.kind === "PageUseDeclaration"
                ? {
                    kind: "component" as const,
                    componentId: `COMP-${String(componentDeclarations.findIndex(candidate => candidate.name === child.component) + 1).padStart(3, "0")}`,
                    props: {},
                  }
              : {
                  kind: "input" as const,
                  name: child.name,
                  label: child.label,
                  placeholder: child.placeholder,
                  help: child.help,
                  ...(child.disabled ? { disabled: true } : {}),
                  ...(child.readOnly ? { readOnly: true } : {}),
                  ...(child.password ? { password: true } : {}),
                  type: checked.resolveType(child.type) ?? primitive("text"),
                  validation: child.validation,
                  event: child.event,
                },
        ),
      })),
    ],
    routes: pageDeclarations.map((page, index) => ({
      path: page.route ?? `/${page.name.toLowerCase()}`,
      componentId: pages[index]!.id,
    })),
  };
  return {
    irVersion: 2,
    version: "0.1-alpha",
    app: {
      id: "APP-001",
      name: app?.kind === "AppDeclaration" ? app.name : "Unnamed",
      ...(app?.kind === "AppDeclaration" && app.metadata ? { metadata: app.metadata } : {}),
    },
    models,
    records,
    db: dbSchemaFromProjectModels(models,p.declarations.flatMap(declaration=>declaration.kind==='IndexDeclaration'?[{name:declaration.name,model:declaration.model,fields:declaration.fields}]:[])),
    enums,
    interfaces: contracts.interfaces.map((x) => ({
      id: x.id,
      name: x.name,
      visibility: x.visibility,
      methods: x.methods.map((m) => m.name),
      methodIds: x.methods.map((m) => m.id),
      requirements: x.methods.map((m) => ({
        id: m.id,
        name: m.name,
        receiver: m.receiver
          ? reqField(m.receiver, "self", `${m.id}:self`)
          : undefined,
        parameters: m.parameters.map((t, i) =>
          reqField(t, `arg${i}`, `${m.id}:arg${i}`),
        ),
        returnType: reqField(m.returnType, "return", `${m.id}:return`),
      })),
    })),
    implementations: contracts.impls.map((x) => {
      const iface = contracts.interfaces.find((i) => i.id === x.interfaceId);
      const signatures = [...x.methods.entries()].map(([name, m]) => {
        const req = iface?.methods.find((r) => r.name === name);
        const receiver = m.parameters.find((p) => p.name === "self");
        const params = m.parameters
          .filter((p) => p.name !== "self")
          .map((p, i) =>
            reqField(
              checked.resolveType(p.type) ?? primitive("text"),
              p.name,
              `${x.id}:${name}:arg${i}`,
            ),
          );
        const ret = checked.resolveType(m.returnType) ?? primitive("text");
        return {
          id: x.methodIds.get(name) ?? `${x.id}:${name}`,
          name,
          receiver: receiver
            ? reqField(
                checked.resolveType(receiver.type) ?? primitive("text"),
                "self",
                `${x.id}:${name}:self`,
              )
            : undefined,
          parameters: params,
          returnType: reqField(ret, "return", `${x.id}:${name}:return`),
        };
      });
      return {
        id: x.id,
        interfaceId: x.interfaceId,
        type: formatType(x.type),
        methods: [...x.methods.keys()],
        methodIds: [...x.methodIds.values()].map(String),
        methodSignatures: signatures,
      };
    }),
    pages,
    ui,
    apis: p.declarations
      .filter((x) => x.kind === "ApiDeclaration")
      .map((a) => ({
        id: `API-${String(++ai).padStart(3, "0")}`,
        route: a.route,
        model: a.model,
        ...(a.policyId ? { policyId: a.policyId } : {}),
        operations: ["create", "read", "update", "delete"],
      })),
    functions: checked.functions,
    style: (() => {
      const s = p.declarations.find((x) => x.kind === "StyleDeclaration");
      return s?.kind === "StyleDeclaration"
        ? {
            id: "STYLE-001",
            values: s.values,
            typedValues: s.values.flatMap((value) => {
              const typed = typedStyleValue(value);
              return typed ? [typed] : [];
            }),
          }
        : undefined;
    })(),
  };
}

function addPageFeedback(result: ProjectIR, p: Program): void {
  if (!result.ui) return;
  const pages = p.declarations.filter((x) => x.kind === "PageDeclaration");
  for (const [index, page] of pages.entries()) {
    const component = result.ui.components.find(
      (candidate) =>
        candidate.id === `UI-${String(index + 1).padStart(3, "0")}`,
    );
    if (!component) continue;
    for (const feedback of page.statements.filter(
      (statement) => statement.kind === "PageFeedbackDeclaration",
    ))
      component.children.push({ kind: "feedback", state: feedback.name, value: feedback.value });
    for (const list of page.statements.filter(
      (statement) => statement.kind === "PageListDeclaration",
    )) {
      const target = result.ui.components.findIndex(
        (candidate) => candidate.name === list.component,
      );
      if (list.bindingPath)
        component.children.push({
          kind: "list",
          source: list.source,
          item: list.item,
          ...(list.empty !== undefined ? { empty: list.empty } : {}),
          ...(list.filterBy !== undefined ? { filterBy: list.filterBy } : {}),
          ...(list.filterLabel !== undefined ? { filterLabel: list.filterLabel } : {}),
          ...(page.statements.some(statement => statement.kind === "PageStateDeclaration" && statement.name === list.source && statement.source?.search) ? { remoteSearch: true } : {}),
          ...(list.pageSize !== undefined ? { pageSize: list.pageSize } : {}),
          body: [{ kind: "binding", path: list.bindingPath }],
        });
      else if (target >= 0)
        component.children.push({
          kind: "list",
          source: list.source,
          item: list.item,
          ...(list.empty !== undefined ? { empty: list.empty } : {}),
          ...(list.filterBy !== undefined ? { filterBy: list.filterBy } : {}),
          ...(list.filterLabel !== undefined ? { filterLabel: list.filterLabel } : {}),
          ...(page.statements.some(statement => statement.kind === "PageStateDeclaration" && statement.name === list.source && statement.source?.search) ? { remoteSearch: true } : {}),
          ...(list.pageSize !== undefined ? { pageSize: list.pageSize } : {}),
          body: [
            {
              kind: "component",
              componentId: result.ui.components[target]!.id,
              props: {},
            },
          ],
        });
    }
    const pageInputs = component.children.filter(child => child.kind === "input");
    const remaining = component.children.filter(child => child.kind !== "input");
    const ordered = [];
    for (const statement of page.statements) {
      let childIndex = -1;
      if (statement.kind === "PageUseDeclaration") {
        const target = result.ui.components.find(candidate => candidate.name === statement.component);
        if (target) childIndex = remaining.findIndex(child => child.kind === "component" && child.componentId === target.id);
      } else if (statement.kind === "PageListDeclaration") {
        childIndex = remaining.findIndex(child => child.kind === "list" && child.source === statement.source && child.item === statement.item);
      } else if (statement.kind === "PageFeedbackDeclaration") {
        childIndex = remaining.findIndex(child => child.kind === "feedback" && child.state === statement.name);
      } else if (statement.kind === "PageLinkDeclaration") {
        const targetId = result.ui.components.find(candidate => candidate.name === statement.target)?.id;
        if (targetId) childIndex = remaining.findIndex(child => child.kind === "link" && child.targetComponentId === targetId && child.label === statement.label);
      } else if (statement.kind === "PageDialogDeclaration") {
        childIndex = remaining.findIndex(child => child.kind === "dialog" && child.label === statement.label && child.title === statement.title);
      }
      if (childIndex >= 0) ordered.push(remaining.splice(childIndex, 1)[0]!);
    }
    component.children = [...pageInputs, ...ordered, ...remaining];
  }
}

function styleIR(s: { token?: boolean; name?: string; values: string[]; composes?: string[]; padding?: number; gap?: number; margin?: number; width?: number; height?: number; opacity?: number; columns?: number; responsiveColumns?: number; responsiveGap?: number; responsivePadding?: number; responsiveMargin?: number; responsiveFontSize?: number; responsiveLineHeight?: number; responsiveLayout?: "row" | "column" | "grid"; fontSize?: number; lineHeight?: number; properties?: { name: "background" | "opacity" | "textColor"; value: "blue" | "neutral" | "red" | "green" | "dark-blue" | "white" | "black" | "inherit" | number }[]; states?: { state: "hovered" | "focused" | "active" | "disabled"; properties: { name: "background" | "opacity" | "textColor"; value: "blue" | "neutral" | "red" | "green" | "dark-blue" | "white" | "black" | "inherit" | number }[] }[]; responsive?: "stacked" | "fluid"; layout?: "row" | "column" | "grid"; alignment?: "start" | "center" | "end" | "stretch"; typography?: "readable" | "compact"; fontWeight?: "normal" | "bold"; spacing?: "comfortable" | "compact"; theme?: "light" | "dark" | "calm" | "contrast"; color?: "blue" | "muted" | "red" | "green"; border?: "subtle" | "strong" | "red" | "green"; shadow?: "soft" | "strong"; corners?: "rounded" | "pill"; radius?: number; disabled?: "guarded"; focus?: "ringed"; surface?: "elevated"; text?: "muted"; textColor?: "white" | "black" | "inherit"; transitionDuration?: number; transitionProperty?: "all" | "background" | "color" | "transform" | "opacity"; transitionEasing?: "ease" | "linear" }, id: string): IRStyle {
  return {
    id,
    token: s.token,
    name: s.name,
    values: s.values,
    composes: s.composes,
    padding: s.padding,
    gap: s.gap,
    margin: s.margin,
    width: s.width,
    height: s.height,
    opacity: s.opacity,
    columns: s.columns,
    responsiveColumns: s.responsiveColumns,
    responsiveGap: s.responsiveGap,
    responsivePadding: s.responsivePadding,
    responsiveMargin: s.responsiveMargin,
    responsiveFontSize: s.responsiveFontSize,
    responsiveLineHeight: s.responsiveLineHeight,
    responsiveLayout: s.responsiveLayout,
    properties: s.properties,
    states: s.states,
    responsive: s.responsive,
    layout: s.layout,
    alignment: s.alignment,
    typography: s.typography,
    fontWeight: s.fontWeight,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    spacing: s.spacing,
    theme: s.theme,
    color: s.color,
    border: s.border,
    shadow: s.shadow,
    corners: s.corners,
    radius: s.radius,
    disabled: s.disabled,
    focus: s.focus,
    surface: s.surface,
    text: s.text,
    textColor: s.textColor,
    transitionDuration: s.transitionDuration,
    transitionProperty: s.transitionProperty,
    transitionEasing: s.transitionEasing,
    typedValues: s.values.flatMap((value) => {
      const typed = typedStyleValue(value);
      return typed ? [typed] : [];
    }),
  };
}
export function toIR(p: Program, semantic?: SemanticProgram): ProjectIR {
  const result = toIRCore(p, semantic);
  const declarations = p.declarations.filter(
    (declaration) => declaration.kind === "StyleDeclaration",
  );
  const global = declarations.find(
    (declaration) => declaration.name === undefined,
  );
  result.style = global ? styleIR(global, "STYLE-001") : undefined;
  const named = declarations
    .filter((declaration) => declaration.name !== undefined)
    .map((declaration, index) =>
      styleIR(
        declaration,
        `STYLE-${String(index + 1 + (global ? 1 : 0)).padStart(3, "0")}`,
      ),
    );
  result.styles = named.length ? named : undefined;
  result.http = sourceHttpProgram(p, semantic);
  addPageFeedback(result, p);
  return result;
}
