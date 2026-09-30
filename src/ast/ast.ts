import type { Span } from "../lexer/lexer.js";
export interface Node {
  span: Span;
  visibility?: "public" | "private";
}
export interface Program extends Node {
  kind: "Program";
  declarations: Declaration[];
  imports: ImportDeclaration[];
}
export interface ImportDeclaration extends Node {
  kind: "ImportDeclaration";
  names: string[];
  path: string;
}
export type Declaration =
  | AppDeclaration
  | ModelDeclaration
  | IndexDeclaration
  | RecordDeclaration
  | EnumDeclaration
  | PageDeclaration
  | ComponentDeclaration
  | StyleDeclaration
  | ApiDeclaration
  | HttpDeclaration
  | FunctionDeclaration
  | InterfaceDeclaration
  | ImplDeclaration
  | TestDeclaration;
export interface TestDeclaration extends Node {
  kind: "TestDeclaration";
  name: string;
  body: Statement[];
}
export interface InterfaceDeclaration extends Node {
  kind: "InterfaceDeclaration";
  name: string;
  methods: InterfaceMethod[];
}
export interface InterfaceMethod extends Node {
  kind: "InterfaceMethod";
  name: string;
  parameters: Parameter[];
  returnType: string;
}
export interface ImplDeclaration extends Node {
  kind: "ImplDeclaration";
  interfaceName: string;
  typeName: string;
  methods: FunctionDeclaration[];
}
export interface EnumDeclaration extends Node {
  kind: "EnumDeclaration";
  name: string;
  typeParameters: string[];
  variants: EnumVariant[];
}
export interface EnumVariant extends Node {
  kind: "EnumVariant";
  name: string;
  payload?: string;
}
export interface AppDeclaration extends Node {
  kind: "AppDeclaration";
  name: string;
  metadata?: { description?: string; canonical?: string };
  metadataSpans?: { description?: Span; canonical?: Span };
}
export interface ModelDeclaration extends Node {
  kind: "ModelDeclaration";
  name: string;
  fields: FieldDeclaration[];
}
export interface IndexDeclaration extends Node {
  kind: "IndexDeclaration";
  name: string;
  model: string;
  fields: string[];
}
export interface RecordDeclaration extends Node {
  kind: "RecordDeclaration";
  name: string;
  typeParameters: string[];
  fields: FieldDeclaration[];
}
export interface FieldDeclaration extends Node {
  kind: "FieldDeclaration";
  name: string;
  type: string;
  modifiers: Modifier[];
}
export type Modifier = {
  kind: "required" | "unique" | "default";
  value?: string | number | boolean;
};
export interface PageDeclaration extends Node {
  kind: "PageDeclaration";
  name: string;
  route?: string;
  statements: PageStatement[];
}
export type PageStatement =
  | CrudStatement
  | PageStateDeclaration
  | PageEventDeclaration
  | PageInputDeclaration
  | PageUseDeclaration
  | PageUseStyleDeclaration
  | PageFeedbackDeclaration
  | PageListDeclaration
  | PageLinkDeclaration
  | PageDialogDeclaration;
export interface CrudStatement extends Node {
  kind: "CrudStatement";
  model: string;
  excludedFields?: string[];
}
export interface PageStateDeclaration extends Node {
  kind: "PageStateDeclaration";
  name: string;
  type: string;
  initial?: string | number | boolean | unknown[];
  persisted?: "local";
  source?: {
    method: "GET";
    path: string;
    next?: { method: "GET"; path: string; parameter: string; cursorField: string };
    search?: { method: "GET"; path: string; parameter: string; next?: { method: "GET"; path: string; parameter: string; cursorField: string } };
  };
}
export interface PageEventDeclaration extends Node {
  kind: "PageEventDeclaration";
  name: string;
  parameters: Parameter[];
  action?: { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; idempotencyKey?: boolean };
  stateUpdate?: { operation: "append" | "remove" | "increment" | "decrement"; state: string; parameter: string; field?: string; projection?: RecordValueExpression };
  successUpdate?: { operation: "clear"; state: string };
}
export interface PageInputDeclaration extends Node {
  kind: "PageInputDeclaration";
  name: string;
  type: string;
  label?: string;
  placeholder?: string;
  help?: string;
  disabled?: boolean;
  readOnly?: boolean;
  password?: boolean;
  validation?: string;
  event?: string;
}
export interface PageUseDeclaration extends Node {
  kind: "PageUseDeclaration";
  name: string;
  component: string;
}
export interface PageUseStyleDeclaration extends Node {
  kind: "PageUseStyleDeclaration";
  style: string;
}
export interface PageFeedbackDeclaration extends Node {
  kind: "PageFeedbackDeclaration";
  name: "loading" | "error";
  value: string;
}
export interface PageListDeclaration extends Node {
  kind: "PageListDeclaration";
  name: string;
  source: string;
  item: string;
  component: string;
  bindingPath?: string;
  empty?: string;
  filterBy?: string;
  filterLabel?: string;
  pageSize?: number;
}
export interface PageLinkDeclaration extends Node {
  kind: "PageLinkDeclaration";
  label: string;
  target: string;
  parameters?: { name: string; path: string }[];
}
export interface PageDialogDeclaration extends Node {
  kind: "PageDialogDeclaration";
  label: string;
  title: string;
  message: string;
}
export interface ComponentDeclaration extends Node {
  kind: "ComponentDeclaration";
  name: string;
  style?: string;
  form?: boolean;
  children: ComponentChild[];
}
export type ComponentChild =
  ComponentTextDeclaration | ComponentBindingDeclaration | ComponentAggregateDeclaration | PageInputDeclaration | ComponentButtonDeclaration | PageUseDeclaration | PageLinkDeclaration | PageDialogDeclaration;
export interface ComponentTextDeclaration extends Node {
  kind: "ComponentTextDeclaration";
  value: string;
}
export interface ComponentBindingDeclaration extends Node {
  kind: "ComponentBindingDeclaration";
  path: string;
}
export interface ComponentAggregateDeclaration extends Node {
  kind: "ComponentAggregateDeclaration";
  source: string;
  field: string;
  multiplier?: string;
}
export interface ComponentButtonDeclaration extends Node {
  kind: "ComponentButtonDeclaration";
  label: string;
  event?: string;
  arguments?: { name: string; path: string }[];
}
export interface StyleDeclaration extends Node {
  kind: "StyleDeclaration";
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
  properties?: StyleProperty[];
  states?: StyleState[];
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
export interface StyleProperty extends Node {
  kind: "StyleProperty";
  name: "background" | "opacity" | "textColor";
  value: "blue" | "neutral" | "red" | "green" | "dark-blue" | "white" | "black" | "inherit" | number;
}
export interface StyleState extends Node {
  kind: "StyleState";
  state: "hovered" | "focused" | "active" | "disabled";
  properties: StyleProperty[];
}
export interface ApiDeclaration extends Node {
  kind: "ApiDeclaration";
  route: string;
  model: string;
  policyId?: string;
}
export interface HttpDeclaration extends Node {
  kind: "HttpDeclaration";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handler: string;
  headers?: string[];
  status?: number;
  errorStatuses?: number[];
  capabilities?: (
    "http" | "database" | "environment" | "time" | "random" | "secureRandom" | "filesystem" | "email"
  )[];
  policyId?: string;
}
export interface FunctionDeclaration extends Node {
  kind: "FunctionDeclaration";
  name: string;
  typeParameters: string[];
  parameters: Parameter[];
  returnType: string;
  body: Statement[];
  async?: boolean;
  receiverType?: string;
  receiverOwner?: string;
  constraints?: { parameter: string; interfaceName: string }[];
}
export interface Parameter extends Node {
  kind: "Parameter";
  name: string;
  type: string;
}
export type Statement =
  | LetStatement
  | ReturnStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | BreakStatement
  | ContinueStatement
  | AssignStatement
  | RepeatStatement
  | TransactionStatement
  | ExpectStatement;
export interface LetStatement extends Node {
  kind: "LetStatement";
  name: string;
  declaredType?: string;
  value: Expression;
  mutable?: boolean;
}
export interface AssignStatement extends Node {
  kind: "AssignStatement";
  name: string;
  value: Expression;
}
export interface ReturnStatement extends Node {
  kind: "ReturnStatement";
  value: Expression;
}
export interface IfStatement extends Node {
  kind: "IfStatement";
  condition: Expression;
  thenBody: Statement[];
  elseBody?: Statement[];
}
export interface ForStatement extends Node {
  kind: "ForStatement";
  name: string;
  iterable: Expression;
  body: Statement[];
}
export interface WhileStatement extends Node {
  kind: "WhileStatement";
  condition: Expression;
  body: Statement[];
}
export interface BreakStatement extends Node {
  kind: "BreakStatement";
}
export interface ContinueStatement extends Node {
  kind: "ContinueStatement";
}
export interface RepeatStatement extends Node {
  kind: "RepeatStatement";
  count: Expression;
  body: Statement[];
}
export interface TransactionStatement extends Node {
  kind: "TransactionStatement";
  database: string;
  body: Statement[];
}
export interface ExpectStatement extends Node {
  kind: "ExpectStatement";
  actual: Expression;
  expected: Expression;
}
export type Expression =
  | LiteralExpression
  | NoneLiteralExpression
  | ListLiteralExpression
  | RecordValueExpression
  | IdentifierExpression
  | UnaryExpression
  | BinaryExpression
  | CallExpression
  | IndexExpression
  | FieldAccessExpression
  | MatchExpression
  | LambdaExpression
  | PropagateExpression
  | AwaitExpression;
export interface MatchExpression extends Node {
  kind: "MatchExpression";
  value: Expression;
  arms: MatchArm[];
}
export interface MatchArm extends Node {
  kind: "MatchArm";
  variant: string;
  binding?: string;
  fields?: string[];
  value: Expression;
}
export interface LiteralExpression extends Node {
  kind: "LiteralExpression";
  value: string | number | boolean;
  valueType: "text" | "integer" | "number" | "boolean";
}
export interface NoneLiteralExpression extends Node {
  kind: "NoneLiteralExpression";
}
export interface ListLiteralExpression extends Node {
  kind: "ListLiteralExpression";
  elements: Expression[];
}
export interface RecordValueExpression extends Node {
  kind: "RecordValueExpression";
  typeName: string;
  fields: { name: string; value: Expression; span: Span }[];
}
export interface IdentifierExpression extends Node {
  kind: "IdentifierExpression";
  name: string;
  typeArguments?: string[];
}
export interface UnaryExpression extends Node {
  kind: "UnaryExpression";
  operator: "-" | "not";
  operand: Expression;
}
export interface BinaryExpression extends Node {
  kind: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
}
export interface CallExpression extends Node {
  kind: "CallExpression";
  callee: string;
  typeArguments?: string[];
  args: Expression[];
  receiver?: Expression;
  methodName?: string;
}
export interface IndexExpression extends Node {
  kind: "IndexExpression";
  object: Expression;
  index: Expression;
}
export interface FieldAccessExpression extends Node {
  kind: "FieldAccessExpression";
  object: Expression;
  field: string;
}
export interface LambdaExpression extends Node {
  kind: "LambdaExpression";
  parameters: Parameter[];
  returnType: string;
  body: Statement[];
}
/** Postfix Result propagation.  `value?` unwraps ok or returns err from the current function. */
export interface PropagateExpression extends Node {
  kind: "PropagateExpression";
  operand: Expression;
}
export interface AwaitExpression extends Node {
  kind: "AwaitExpression";
  operand: Expression;
}
