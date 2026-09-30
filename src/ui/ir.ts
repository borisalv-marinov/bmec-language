import { typeRefFromUnknown, type TypeRef } from "../types/type-ref.js";
export interface UIProp {
  name: string;
  type: TypeRef;
  required?: boolean;
}
export interface UIState {
  name: string;
  type: TypeRef;
  initial?: unknown;
  persisted?: "local";
  storageKey?: string;
  source?: {
    method: "GET";
    path: string;
    next?: { method: "GET"; path: string; parameter: string; cursorField: string };
    search?: { method: "GET"; path: string; parameter: string; next?: { method: "GET"; path: string; parameter: string; cursorField: string } };
  };
}
export interface UIEvent {
  name: string;
  parameters: Readonly<Record<string, TypeRef>>;
  action?: { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; idempotencyKey?: boolean };
  stateUpdate?: {
    operation: "append" | "remove" | "increment" | "decrement";
    state: string;
    parameter: string;
    field?: string;
    type?: TypeRef;
    storageKey?: string;
    projection?: { type: TypeRef; fields: Readonly<Record<string, { kind: "field"; path: string } | { kind: "literal"; value: string | number | boolean }>> };
  };
  successUpdate?: { operation: "clear"; state: string; storageKey?: string };
}
export interface UIComponent {
  id: string;
  name: string;
  style?: string;
  form?: boolean;
  props: UIProp[];
  state: UIState[];
  events: UIEvent[];
  children: UINode[];
}
export type UINode =
  | { kind: "text"; value: string }
  | { kind: "binding"; path: string }
  | { kind: "aggregate"; source: string; field: string; multiplier?: string; money?: true }
  | { kind: "button"; label: string; event?: string; arguments?: readonly { name: string; path: string }[] }
  | { kind: "link"; label: string; targetComponentId: string; parameters?: readonly { name: string; path: string }[] }
  | { kind: "feedback"; state: "loading" | "error"; value: string }
  | { kind: "dialog"; dialogId: string; label: string; title: string; message: string }
  | {
      kind: "component";
      componentId: string;
      props: Readonly<Record<string, unknown>>;
    }
  | { kind: "conditional"; condition: string; then: UINode[]; else?: UINode[] }
  | { kind: "list"; source: string; item: string; body: UINode[]; empty?: string; filterBy?: string; filterLabel?: string; remoteSearch?: boolean; pageSize?: number }
  | {
      kind: "input";
      name: string;
      label?: string;
      placeholder?: string;
      help?: string;
      disabled?: boolean;
      readOnly?: boolean;
      password?: boolean;
      type: TypeRef;
      validation?: string;
      event?: string;
    };
export interface UIProgram {
  components: UIComponent[];
  routes: { path: string; componentId: string }[];
}
export function validateUI(program: UIProgram): string[] {
  const errors: string[] = [];
  const ids = new Set(program.components.map((component) => component.id));
  const duplicateIds = new Set<string>();
  for (const component of program.components) {
    if (!component.id || !component.name || duplicateIds.has(component.id))
      errors.push(`Invalid or duplicate UI component id "${component.id}"`);
    duplicateIds.add(component.id);
    const names = new Set<string>();
    for (const prop of component.props) {
      if (names.has(prop.name)) errors.push(`Duplicate UI prop "${prop.name}"`);
      else names.add(prop.name);
      if (!typeRefFromUnknown(prop.type))
        errors.push(`Invalid UI prop TypeRef "${prop.name}"`);
    }
    const stateNames = new Set<string>();
    for (const state of component.state) {
      if (!state.name || stateNames.has(state.name))
        errors.push(`Duplicate UI state "${state.name}"`);
      stateNames.add(state.name);
      if (!typeRefFromUnknown(state.type))
        errors.push(`Invalid UI state TypeRef "${state.name}"`);
      if (state.persisted === "local" && !state.storageKey)
        errors.push(`Persisted UI state "${state.name}" requires a storage key`);
      if (state.persisted === "local" && state.source)
        errors.push(`Persisted UI state "${state.name}" cannot also have a remote source`);
    }
    const eventNames = new Set<string>();
    for (const event of component.events) {
      if (!event.name || eventNames.has(event.name))
        errors.push(`Duplicate UI event "${event.name}"`);
      eventNames.add(event.name);
      for (const [name, type] of Object.entries(event.parameters ?? {}))
        if (!typeRefFromUnknown(type))
          errors.push(
            `Invalid UI event parameter TypeRef "${event.name}.${name}"`,
          );
      if (event.stateUpdate) {
        const target = component.state.find(state => state.name === event.stateUpdate!.state);
        const parameter = event.parameters[event.stateUpdate.parameter];
        const projection = event.stateUpdate.projection;
        const projectionValid = !projection || event.stateUpdate.operation === 'append' && typeRefFromUnknown(projection.type) !== undefined && JSON.stringify(target?.type.kind === 'list' ? target.type.element : undefined) === JSON.stringify(projection.type) && Object.values(projection.fields).every(field => field.kind === 'literal' ? ['string','number','boolean'].includes(typeof field.value) : field.kind === 'field' && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field.path));
        if (!target || target.type.kind !== "list" || !parameter || !projectionValid || (!projection && JSON.stringify(target.type.element) !== JSON.stringify(event.stateUpdate.type ?? parameter)) || ((event.stateUpdate.operation === "increment" || event.stateUpdate.operation === "decrement") !== Boolean(event.stateUpdate.field)))
          errors.push(`Invalid typed state update for UI event "${event.name}"`);
        if (event.action)
          errors.push(`UI event "${event.name}" cannot combine an HTTP action and a local state update`);
      }
      if (event.successUpdate) {
        const target = component.state.find(state => state.name === event.successUpdate!.state);
        if (!event.action || target?.type.kind !== "list" || target.persisted !== "local" || !target.storageKey || event.successUpdate.storageKey !== target.storageKey)
          errors.push(`UI event "${event.name}" can clear only its declared persisted list after a successful HTTP action`);
      }
    }
    const walk = (node: UINode): void => {
      if (node.kind === "binding") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(node.path))
          errors.push(`Invalid UI binding path "${node.path}"`);
      } else if (node.kind === "component") {
        if (!ids.has(node.componentId))
          errors.push(
            `UI child references unknown component "${node.componentId}"`,
          );
      } else if (node.kind === "link") {
        if (!node.label.trim()) errors.push("UI navigation link requires a label");
        const target = program.routes.find((route) => route.componentId === node.targetComponentId);
        if (!target)
          errors.push(`UI navigation link references unknown page "${node.targetComponentId}"`);
        else {
          const required = [...target.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
          const supplied = (node.parameters ?? []).map(parameter => parameter.name);
          if (new Set(supplied).size !== supplied.length || required.length !== supplied.length || required.some(name => !supplied.includes(name)))
            errors.push(`UI navigation link to "${target.path}" must supply every route parameter exactly once`);
          for (const parameter of node.parameters ?? []) if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.path))
            errors.push(`UI navigation link has invalid route parameter binding "${parameter.path}"`);
        }
      } else if (node.kind === "list" && node.empty !== undefined && !node.empty.trim()) {
        errors.push(`UI list "${node.source}" empty state requires a message`);
      } else if (node.kind === "feedback") {
        if (!node.value.trim()) errors.push(`UI ${node.state} feedback requires a message`);
      } else if (node.kind === "dialog") {
        if (!node.dialogId || !node.label.trim() || !node.title.trim() || !node.message.trim())
          errors.push("UI dialog requires an ID, label, title, and message");
      } else if (node.kind === "aggregate") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.source) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.field) || (node.multiplier !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.multiplier)))
          errors.push("UI aggregate requires valid list and field names");
      } else if (node.kind === "button") {
        const names = new Set<string>();
        for (const argument of node.arguments ?? []) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument.name) || names.has(argument.name))
            errors.push(`Invalid or duplicate UI action binding parameter "${argument.name}"`);
          names.add(argument.name);
          if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(argument.path))
            errors.push(`Invalid UI action binding path "${argument.path}"`);
        }
        if (node.arguments?.length && !node.event)
          errors.push("UI action bindings require a named event");
      } else if (node.kind === "input") {
        if (!node.name || !typeRefFromUnknown(node.type))
          errors.push(`Invalid UI input "${node.name}"`);
        if (node.event && !eventNames.has(node.event))
          errors.push(
            `UI input "${node.name}" references unknown event "${node.event}"`,
          );
      } else if (node.kind === "conditional") {
        if (!node.condition) errors.push("UI conditional requires a condition");
        node.then.forEach(walk);
        node.else?.forEach(walk);
      } else if (node.kind === "list") {
        if (!node.source || !node.item)
          errors.push("UI list binding is invalid");
        node.body.forEach(walk);
      }
    };
    component.children.forEach(walk);
  }
  const paths = new Set<string>();
  for (const route of program.routes) {
    if (!route.path || paths.has(route.path))
      errors.push(`Invalid or duplicate UI route "${route.path}"`);
    paths.add(route.path);
    if (!ids.has(route.componentId))
      errors.push(
        `UI route "${route.path}" references unknown component "${route.componentId}"`,
      );
  }
  return errors;
}
