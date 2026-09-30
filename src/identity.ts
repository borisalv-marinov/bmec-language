/** Compiler-owned semantic identities. These are intentionally opaque at API boundaries. */
export type ModuleId = string & { readonly __pipeModuleId: unique symbol };
export type SymbolId = string & { readonly __pipeSymbolId: unique symbol };
export type FunctionId = string & { readonly __pipeFunctionId: unique symbol };
export type InterfaceId = string & { readonly __pipeInterfaceId: unique symbol };
export type InterfaceMethodId = string & { readonly __pipeInterfaceMethodId: unique symbol };
export type ImplId = string & { readonly __pipeImplId: unique symbol };

export const moduleId = (value: string): ModuleId => value as ModuleId;
export const symbolId = (value: string): SymbolId => value as SymbolId;
export const functionId = (value: string): FunctionId => value as FunctionId;
export const interfaceId = (value: string): InterfaceId => value as InterfaceId;
export const interfaceMethodId = (value: string): InterfaceMethodId => value as InterfaceMethodId;
export const implId = (value: string): ImplId => value as ImplId;

export interface SemanticIdentity {
  readonly id: SymbolId;
  readonly module: ModuleId;
  readonly ordinal: number;
  readonly name: string;
}
