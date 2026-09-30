import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { parseAsync as parse } from "./parser/async.js";
import { PipeLexError } from "./lexer/lexer.js";
import { PipeParseError } from "./parser/parser.js";
import { analyze, analyzeProgram, analyzeUI } from "./semantic/analyze.js";
import { toIR, type ProjectIR } from "./ir/ir.js";
import { STDLIB_NAMES } from "./stdlib/stdlib.js";
import type {
  Program,
  Expression,
  Statement,
  ModelDeclaration,
  RecordDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  Declaration,
  TestDeclaration,
  LiteralExpression,
} from "./ast/ast.js";
import { diagnostic, type Diagnostic } from "./diagnostics/diagnostics.js";
import {
  moduleId,
  symbolId,
  functionId,
  type ModuleId,
  type FunctionId,
  type SymbolId,
} from "./identity.js";
import type { SemanticProgram } from "./semantic/analyze.js";
import { analyzeContracts } from "./semantic/contracts.js";
import { specializeGenericCallTypes } from "./core/analysis.js";
import {
  findManifest,
  hasManifest,
  readManifest,
  verifyLock,
  resolveDependencyImport,
  validatePackageGraph,
  lockFileForManifest,
  isSourceFile,
  type PipeLock,
} from "./project/manifest.js";
import {
  validatePartition,
  type CompilationPartition,
  type PartitionReference,
} from "./compiler/partitions.js";
import { buildDeclarationIndex } from "./semantic/declaration-index.js";
import { styleDiagnostics } from "./compiler/source.js";

export interface CompileBoundaryOptions {
  partition?: CompilationPartition;
  references?: readonly PartitionReference[];
  sourceOverrides?: ReadonlyMap<string, string>;
}

export { compile } from "./compiler/source.js";

export function compileTests(source: string, file = "<input>") {
  const ast = parse(source, file);
  const tests = ast.declarations.filter(
    (d): d is TestDeclaration => d.kind === "TestDeclaration",
  );
  const synthetic: FunctionDeclaration[] = tests.map(
    (test, index) =>
      ({
        kind: "FunctionDeclaration",
        name: `__pipe_test_${index + 1}`,
        typeParameters: [],
        parameters: [],
        returnType: "text",
        body: [
          ...test.body,
          {
            kind: "ReturnStatement",
            value: {
              kind: "LiteralExpression",
              value: "ok",
              valueType: "text",
              span: test.span,
            },
            span: test.span,
          },
        ],
        span: test.span,
      }) as FunctionDeclaration,
  );
  const declarations = [
    ...ast.declarations.filter((d) => d.kind !== "TestDeclaration"),
    ...synthetic,
  ];
  const program = { ...ast, declarations };
  const functions = declarations.flatMap((d) =>
    d.kind === "ImplDeclaration"
      ? d.methods
      : d.kind === "FunctionDeclaration"
        ? [d]
        : [],
  );
  const functionIds = new Map<FunctionDeclaration, FunctionId>(
    functions.map((d, i) => [
      d,
      functionId(`FUNC-${String(i + 1).padStart(3, "0")}`),
    ]),
  );
  const semantic = analyzeProgram(program, { functionIds });
  specializeGenericCallTypes(semantic.functions, semantic.index);
  const diagnostics = [
    ...semantic.diagnostics,
    ...analyzeContracts(program, { functionIds, index: semantic.index })
      .diagnostics,
    ...styleDiagnostics(program),
  ];
  return {
    ast,
    tests,
    diagnostics,
    ir: diagnostics.length ? undefined : toIR(program, semantic),
  } as {
    ast: typeof ast;
    tests: TestDeclaration[];
    diagnostics: Diagnostic[];
    ir?: ProjectIR;
  };
}
export function compileFile(
  file: string,
  boundary: CompileBoundaryOptions = {},
) {
  return compileProject(file, boundary);
}
export interface ModuleInfo {
  id: ModuleId | string;
  file: string;
  imports: string[];
  importIds?: ModuleId[];
  symbols: string[];
  symbolIds?: string[];
}
export interface ProjectCompile {
  entry: string;
  modules: ModuleInfo[];
  program: Program;
  diagnostics: Diagnostic[];
  ir?: ProjectIR;
}

export function compileProject(
  entry: string,
  boundary: CompileBoundaryOptions = {},
): ProjectCompile {
  const root = dirname(resolve(entry));
  const modules = new Map<string, { file: string; ast: Program }>();
  const diagnostics: Diagnostic[] = [];
  const syntaxDiagnostic = (error: unknown, file: string): Diagnostic | undefined => {
    if (error instanceof PipeLexError)
      return diagnostic(error.code, error.message, { start: error.position, end: error.position }, {
        kind: "syntax",
        suggestions: ["Check the token at this location."],
      });
    if (error instanceof PipeParseError)
      return diagnostic(error.code, error.message, error.token.span, {
        kind: error.context.kind ?? "syntax",
        suggestions: ["Check the surrounding declaration syntax."],
        ...error.context,
      });
    return undefined;
  };
  const visiting: string[] = [];
  const projectManifest = findManifest(root) ?? resolve(root, "bmec.toml");
  const checkedManifests = new Set<string>();
  const sourceText = (file: string) => boundary.sourceOverrides?.get(file) ?? boundary.sourceOverrides?.get(resolve(file)) ?? readFileSync(file, "utf8");
  const manifestFor = (file: string) => {
    let current = dirname(file);
    for (;;) {
      const candidate = findManifest(current);
      if (candidate) return candidate;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return projectManifest;
  };
  const checkManifest = (manifestFile: string, span: any) => {
    if (checkedManifests.has(manifestFile) || !existsSync(manifestFile)) return;
    checkedManifests.add(manifestFile);
    const lockFile = lockFileForManifest(manifestFile);
    if (!existsSync(lockFile)) return;
    try {
      const lock = JSON.parse(readFileSync(lockFile, "utf8")) as PipeLock;
      for (const issue of verifyLock(manifestFile, lock))
        diagnostics.push(
          diagnostic(issue.split(":")[0]!, issue, span, { kind: "lockfile" }),
        );
    } catch (error) {
      diagnostics.push(
        diagnostic("PIPE-PKG-008", "Invalid lockfile JSON", span, {
          kind: "lockfile",
          received: String(error),
        }),
      );
    }
  };
  const load = (requested: string, from: string) => {
    if (requested.startsWith("std.")) return `std:${requested}`;
    const relativeImport =
      requested.startsWith("./") || requested.startsWith("../");
    const sourceManifest = manifestFor(from);
    const candidate = relativeImport
      ? resolve(dirname(from), requested)
      : resolveDependencyImport(sourceManifest, requested);
    if (!relativeImport && !candidate) {
      diagnostics.push(
        diagnostic(
          "PIPE-MOD-001",
          `Import must be relative or a declared path dependency: "${requested}"`,
          fromAst(from).span,
        ),
      );
      return "";
    }
    if (!candidate || !isSourceFile(candidate)) {
      diagnostics.push(
        diagnostic(
          "PIPE-MOD-002",
          "Import path must end with .bmec or .pipe",
          fromAst(from).span,
        ),
      );
      return "";
    }
    const rel = relative(root, candidate);
    const sourceRel = relative(root, from);
    const packageRoot = dirname(sourceManifest);
    if (
      relativeImport &&
      !sourceRel.startsWith("..") &&
      (rel.startsWith("..") || isAbsolute(rel))
    ) {
      diagnostics.push(
        diagnostic(
          "PIPE-MOD-003",
          "Import escapes the project root",
          fromAst(from).span,
          { kind: "module_boundary", received: requested },
        ),
      );
      return "";
    }
    if (relativeImport && sourceRel.startsWith("..")) {
      const depRel = relative(packageRoot, candidate);
      if (depRel.startsWith("..") || isAbsolute(depRel)) {
        diagnostics.push(
          diagnostic(
            "PIPE-MOD-003",
            "Import escapes the dependency package root",
            fromAst(from).span,
            { kind: "module_boundary", received: requested },
          ),
        );
        return "";
      }
    }
    if (!existsSync(candidate)) {
      diagnostics.push(
        diagnostic(
          "PIPE-MOD-004",
          `Imported module not found: "${requested}"`,
          fromAst(from).span,
          { kind: "missing_module", received: requested },
        ),
      );
      return "";
    }
    const canonical = realpathSync(candidate);
    if (visiting.includes(canonical)) {
      diagnostics.push(
        diagnostic(
          "PIPE-MOD-005",
          "Circular module import",
          fromAst(from).span,
          { kind: "circular_import", received: requested },
        ),
      );
      return canonical;
    }
    if (modules.has(canonical)) return canonical;
    visiting.push(canonical);
    let ast: Program;
    try {
      ast = parse(sourceText(canonical), canonical);
    } catch (error) {
      const parsed = syntaxDiagnostic(error, canonical);
      if (!parsed) throw error;
      diagnostics.push(parsed);
      visiting.pop();
      return canonical;
    }
    modules.set(canonical, { file: canonical, ast });
    for (const imp of ast.imports) load(imp.path, canonical);
    visiting.pop();
    return canonical;
  };
  const canonicalEntry = realpathSync(resolve(entry));
  const entryRelative = relative(root, canonicalEntry);
  if (entryRelative.startsWith("..") || isAbsolute(entryRelative))
    diagnostics.push(
      diagnostic("PIPE-MOD-003", "Entry file is outside the project root", {
        start: { file: entry, line: 1, column: 1, offset: 0 },
        end: { file: entry, line: 1, column: 1, offset: 0 },
      }),
    );
  else {
    visiting.push(canonicalEntry);
    try {
      const ast = parse(sourceText(canonicalEntry), canonicalEntry);
      modules.set(canonicalEntry, { file: canonicalEntry, ast });
      for (const imp of ast.imports) load(imp.path, canonicalEntry);
    } catch (error) {
      const parsed = syntaxDiagnostic(error, canonicalEntry);
      if (!parsed) throw error;
      diagnostics.push(parsed);
    }
    visiting.pop();
  }
  const entries = [...modules.values()];
  for (const issue of validatePackageGraph(projectManifest))
    diagnostics.push(
      diagnostic(
        issue.code,
        issue.message,
        entries[0]?.ast.span ?? {
          start: { file: entry, line: 1, column: 1, offset: 0 },
          end: { file: entry, line: 1, column: 1, offset: 0 },
        },
        { kind: "package_graph", received: issue.manifestFile },
      ),
    );
  for (const module of entries)
    checkManifest(manifestFor(module.file), module.ast.span);
  for (const m of entries) {
    const importedNames = new Set<string>();
    for (const imp of m.ast.imports) {
      for (const n of imp.names) {
        if (importedNames.has(n))
          diagnostics.push(
            diagnostic(
              "PIPE-MOD-009",
              `Duplicate imported name "${n}"`,
              imp.span,
              { kind: "duplicate_import", received: n },
            ),
          );
        importedNames.add(n);
      }
      const target = resolveImport(m.file, imp.path, manifestFor(m.file));
      if (!target || !existsSync(target)) continue;
      const imported = entries.find((x) => x.file === realpathSync(target));
      if (!imported) continue;
      const hasVisibility = imported.ast.declarations.some(
        (d) => d.visibility !== undefined,
      );
      const packageScoped = hasManifest(dirname(imported.file));
      const exported = new Set(
        imported.ast.declarations
          .filter(
            (d) =>
              d.visibility === "public" || (!packageScoped && !hasVisibility),
          )
          .map(declarationName)
          .filter(Boolean),
      );
      for (const n of imp.names)
        if (!exported.has(n))
          diagnostics.push(
            diagnostic(
              "PIPE-MOD-007",
              `Module does not export "${n}"`,
              imp.span,
              {
                kind: "missing_export",
                received: n,
                suggestions: ["Export the target declaration with public, or import a public symbol."],
                repair: { type: "visibility", value: `Make "${n}" public in the imported module` },
                related: [{ message: `Imported module: ${imported.file}`, span: imported.ast.span }],
              },
            ),
          );
    }
    for (const d of m.ast.declarations) {
      const n = declarationName(d);
      if (n && importedNames.has(n))
        diagnostics.push(
          diagnostic(
            "PIPE-MOD-008",
            `Local declaration collides with imported name "${n}"`,
            d.span,
            { kind: "import_collision", received: n },
          ),
        );
    }
  }
  diagnostics.push(...strictModuleVisibilityDiagnostics(entries, manifestFor));
  diagnostics.push(...moduleScopeDiagnostics(entries));
  if (boundary.partition)
    for (const issue of validatePartition(
      boundary.partition,
      boundary.references ?? [],
    ))
      diagnostics.push(
        diagnostic(
          issue.code,
          issue.message,
          entries[0]?.ast.span ?? {
            start: { file: entry, line: 1, column: 1, offset: 0 },
            end: { file: entry, line: 1, column: 1, offset: 0 },
          },
          { kind: "partition", received: issue.identity },
        ),
      );
  const manifestFile = findManifest(root) ?? resolve(root, "bmec.toml");
  if (hasManifest(root)) {
    try {
      const manifest = readManifest(manifestFile);
      const lockFile = lockFileForManifest(manifestFile);
      if (existsSync(lockFile)) {
        try {
          const lock = JSON.parse(readFileSync(lockFile, "utf8")) as PipeLock;
          for (const issue of verifyLock(manifestFile, lock))
            diagnostics.push(
              diagnostic(
                issue.split(":")[0]!,
                issue,
                entries[0]?.ast.span ?? { start: { file: canonicalEntry, line: 1, column: 1, offset: 0 }, end: { file: canonicalEntry, line: 1, column: 1, offset: 0 } },
                { kind: "lockfile" },
              ),
            );
        } catch (error) {
          diagnostics.push(
            diagnostic(
              "PIPE-PKG-008",
              "Invalid lockfile JSON",
              entries[0]?.ast.span ?? { start: { file: canonicalEntry, line: 1, column: 1, offset: 0 }, end: { file: canonicalEntry, line: 1, column: 1, offset: 0 } },
              { kind: "lockfile", received: String(error) },
            ),
          );
        }
      }
    } catch {}
  }
  const moduleIds = new Map(
    entries.map((m, i) => {
      const owner = manifestFor(m.file);
      let packageManifest;
      try {
        packageManifest = existsSync(owner) ? readManifest(owner) : undefined;
      } catch {}
      const identity = packageManifest
        ? `${packageManifest.name}@${packageManifest.version}:${relative(dirname(owner), m.file).replaceAll("\\", "/")}`
        : undefined;
      return [
        m.file,
        moduleId(identity ?? `MOD-${String(i + 1).padStart(3, "0")}`),
      ] as const;
    }),
  );
  const functionIds = new Map<FunctionDeclaration, FunctionId>();
  for (const m of entries) {
    let ordinal = 0;
    for (const d of m.ast.declarations) {
      const fs =
        d.kind === "ImplDeclaration"
          ? d.methods
          : d.kind === "FunctionDeclaration"
            ? [d]
            : [];
      for (const f of fs)
        functionIds.set(
          f,
          functionId(
            `${moduleIds.get(m.file)!}:FUNC-${String(++ordinal).padStart(3, "0")}`,
          ),
        );
    }
  }
  const program: Program = {
    kind: "Program",
    imports: [],
    declarations: entries.flatMap((x) => x.ast.declarations),
    span: entries[0]?.ast.span ?? {
      start: { file: entry, line: 1, column: 1, offset: 0 },
      end: { file: entry, line: 1, column: 1, offset: 0 },
    },
  };
  diagnostics.push(...styleDiagnostics(program));
  const projectIndex = buildDeclarationIndex(program, functionIds, {
    moduleIdForFile: (file) => moduleIds.get(file) ?? moduleId(file),
    resolveImplInterface: (impl, interfaces) => {
      const owner = entries.find((m) => m.file === impl.span.start.file);
      if (!owner) return undefined;
      for (const imp of owner.ast.imports)
        if (imp.names.includes(impl.interfaceName)) {
          const target = resolveImport(
            owner.file,
            imp.path,
            manifestFor(owner.file),
          );
          const imported = target
            ? entries.find((m) => m.file === realpathSync(target))
            : undefined;
          const declaration = imported?.ast.declarations.find(
            (d: Declaration) => declarationName(d) === impl.interfaceName,
          );
          const hit =
            declaration &&
            [...interfaces.values()].find((x) => x.declaration === declaration);
          if (hit) return hit.id;
        }
      return undefined;
    },
  });
  const allFunctions = [];
  const allTypes = new Map<object, import("./types/type-ref.js").TypeRef>();
  const typeResolvers: Array<SemanticProgram["resolveType"]> = [];
  let resolveType: (
    source: string,
  ) => import("./types/type-ref.js").TypeRef | undefined = () => undefined;
  for (const module of entries) {
    const importedDeclarations = directImportedDeclarations(
      module,
      entries,
      manifestFor(module.file),
    );
    const semantic = analyzeProgram(module.ast, {
      models: importedDeclarations.filter(
        (d): d is ModelDeclaration => d.kind === "ModelDeclaration",
      ),
      records: importedDeclarations.filter(
        (d): d is RecordDeclaration => d.kind === "RecordDeclaration",
      ),
      enums: importedDeclarations.filter(
        (d): d is import("./ast/ast.js").EnumDeclaration =>
          d.kind === "EnumDeclaration",
      ),
      functions: importedDeclarations.filter(
        (d): d is FunctionDeclaration => d.kind === "FunctionDeclaration",
      ),
      functionIds,
      symbolForDeclaration: (d) =>
        symbolId(
          `${moduleIds.get(d.span.start.file) ?? moduleIds.get(module.file)}:${d.name}`,
        ),
      lambdaPrefix: `${moduleIds.get(module.file)}:`,
      index: projectIndex,
      resolveInterfaceId: (name, file) => {
        const owner = entries.find((m) => m.file === file) || module;
        const local = [...projectIndex.interfaces.values()].filter(
          (x) =>
            x.declaration.name === name &&
            x.declaration.span.start.file === file,
        );
        if (local.length === 1) return local[0]!.id;
        for (const imp of owner.ast.imports)
          if (imp.names.includes(name)) {
            const target = resolveImport(
              owner.file,
              imp.path,
              manifestFor(owner.file),
            );
            const imported = target
              ? entries.find((m) => m.file === realpathSync(target))
              : undefined;
            const hit =
              imported &&
              [...projectIndex.interfaces.values()].find(
                (x) =>
                  x.declaration.name === name &&
                  x.declaration.span.start.file === imported.file,
              );
            if (hit) return hit.id;
          }
        const global = [...projectIndex.interfaces.values()].filter(
          (x) => x.declaration.name === name,
        );
        return global.length === 1 ? global[0]!.id : undefined;
      },
    });
    diagnostics.push(...semantic.diagnostics);
    allFunctions.push(...semantic.functions);
    for (const [node, type] of semantic.typeRefs) allTypes.set(node, type);
    typeResolvers.push(semantic.resolveType);
  }
  resolveType = (source) => {
    for (const resolver of typeResolvers) {
      const resolved = resolver(source);
      if (resolved) return resolved;
    }
    return undefined;
  };
  specializeGenericCallTypes(allFunctions, projectIndex);
  diagnostics.push(...analyzeUI(program));
  diagnostics.push(
    ...analyzeContracts(program, {
      functionIds,
      index: projectIndex,
      resolveInterfaceId: (name, file) => {
        const owner = entries.find((m) => m.file === file);
        if (owner)
          for (const imp of owner.ast.imports)
            if (imp.names.includes(name)) {
              const target = resolveImport(
                owner.file,
                imp.path,
                manifestFor(owner.file),
              );
              const imported = target
                ? entries.find((m) => m.file === realpathSync(target))
                : undefined;
              const hit =
                imported &&
                [...projectIndex.interfaces.values()].find(
                  (x) =>
                    x.declaration.name === name &&
                    x.declaration.span.start.file === imported.file,
                );
              if (hit) return hit.id;
            }
        const local = [...projectIndex.interfaces.values()].filter(
          (x) =>
            x.declaration.name === name &&
            x.declaration.span.start.file === file,
        );
        if (local.length === 1) return local[0]!.id;
        const global = [...projectIndex.interfaces.values()].filter(
          (x) => x.declaration.name === name,
        );
        return global.length === 1 ? global[0]!.id : undefined;
      },
    }).diagnostics,
  );
  const result: ProjectCompile = {
    entry: canonicalEntry,
    modules: entries.map((m) => ({
      id: moduleIds.get(m.file)!,
      file: m.file,
      imports: m.ast.imports.map((x) => x.path),
      importIds: m.ast.imports
        .filter((x) => !x.path.startsWith("std."))
        .map((x) => resolveImport(m.file, x.path, manifestFor(m.file)))
        .filter((x): x is string => typeof x === "string" && existsSync(x))
        .map((target) => moduleIds.get(realpathSync(target)))
        .filter((x): x is ModuleId => Boolean(x)),
      symbols: m.ast.declarations.map((d) => declarationName(d) || d.kind),
      symbolIds: m.ast.declarations.map((d, i) =>
        symbolId(
          `${moduleIds.get(m.file)!}:${i}:${declarationName(d) || d.kind}`,
        ),
      ),
    })),
    program,
    diagnostics,
  };
  if (!diagnostics.length) {
    const semantic = {
      diagnostics: [],
      functions: allFunctions,
      typeRefs: allTypes,
      resolveType,
      index: projectIndex,
    } as SemanticProgram;
    result.ir = toIR(program, semantic);
    result.ir.modules = result.modules;
  }
  return result;
  function fromAst(file: string) {
    return modules.get(file)?.ast ?? parse(sourceText(file), file);
  }
}

const moduleScalarTypes = new Set([
  "text",
  "number",
  "integer",
  "boolean",
  "money",
  "date",
  "datetime",
  "id",
]);
const moduleBuiltinNames = new Set([
  ...STDLIB_NAMES,
  "environmentText",
  "environmentSecret",
  "revealSecret",
  "readTextFile",
]);
function moduleTypeVisible(
  type: string | undefined,
  visible: Set<string>,
): boolean {
  if (!type) return true;
  if (
    moduleScalarTypes.has(type) ||
    moduleBuiltinNames.has(type) ||
    /^[A-Z]$/.test(type) ||
    type === "print"
  )
    return true;
  if (type.endsWith("?")) return moduleTypeVisible(type.slice(0, -1), visible);
  for (const generic of ["list", "result", "task", "secret"])
    if (type.startsWith(`${generic}<`) && type.endsWith(">")) {
      const inner = type.slice(generic.length + 1, -1);
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === "<") depth++;
        else if (inner[i] === ">") depth--;
        else if (inner[i] === "," && depth === 0) {
          parts.push(inner.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(inner.slice(start).trim());
      return generic === "result"
        ? parts.length === 2 && parts.every((part) => moduleTypeVisible(part, visible))
        : moduleTypeVisible(inner, visible);
    }
  if (
    /^capability<(http|database|environment|time|random|secureRandom|filesystem|email)>$/.test(
      type,
    )
  )
    return true;
  return visible.has(type);
}
function moduleScopeDiagnostics(
  entries: { file: string; ast: Program }[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const candidates = new Map<string, { file: string; declaration: Declaration }[]>();
  for (const entry of entries)
    for (const declaration of entry.ast.declarations) {
      const name = declarationName(declaration);
      if (name) candidates.set(name, [...(candidates.get(name) ?? []), { file: entry.file, declaration }]);
    }
  for (const module of entries) {
    const local = new Set(
      module.ast.declarations.map(declarationName).filter(Boolean),
    );
    const imported = new Set<string>();
    for (const imp of module.ast.imports)
      for (const name of imp.names) imported.add(name);
    const visible = new Set([...local, ...imported]);
    const enumVariants = new Map<string, Set<string>>(
      module.ast.declarations
        .filter((declaration): declaration is EnumDeclaration => declaration.kind === "EnumDeclaration")
        .map((declaration) => [declaration.name, new Set(declaration.variants.map((variant) => variant.name))]),
    );
    for (const name of imported) {
      const candidatesForName = candidates.get(name) ?? [];
      const declaration = candidatesForName.length === 1 ? candidatesForName[0]!.declaration : undefined;
      if (declaration?.kind === "EnumDeclaration")
        enumVariants.set(name, new Set(declaration.variants.map((variant) => variant.name)));
    }
    const unavailable = (name: string | undefined, span: any) => {
      if (name !== undefined && !moduleTypeVisible(name, visible)) {
        const matches = (candidates.get(name) ?? []).filter(candidate => candidate.file !== module.file);
        const candidate = matches.length === 1 ? matches[0] : undefined;
        const candidatePath = candidate ? relative(dirname(module.file), candidate.file).replaceAll("\\", "/") : undefined;
        const importPath = candidatePath ? (candidatePath.startsWith(".") ? candidatePath : `./${candidatePath}`) : undefined;
        out.push(
          diagnostic(
            "PIPE-MOD-010",
            `Symbol "${name}" is not available in module "${module.file}"`,
            span,
            {
              kind: "module_scope",
              received: name,
              ...(candidate ? {
                repair: { type: "import", value: importPath ? `Import ${name} from "${importPath}" before use` : `Import ${name} before use` },
                related: [{ message: `Candidate declaration: ${candidate.file}`, span: candidate.declaration.span }],
              } : {}),
            },
          ),
        );
      }
    };
    for (const d of module.ast.declarations) {
      if (d.kind === "ModelDeclaration" || d.kind === "RecordDeclaration")
        for (const field of d.fields) unavailable(field.type, field.span);
      else if (d.kind === "PageDeclaration") {
        for (const statement of d.statements)
          if (statement.kind === "CrudStatement")
            unavailable(statement.model, statement.span);
      } else if (d.kind === "ApiDeclaration") unavailable(d.model, d.span);
      else if (d.kind === "FunctionDeclaration") {
        for (const p of d.parameters) unavailable(p.type, p.span);
        unavailable(d.returnType, d.span);
        const functionNames = new Set([...visible]);
        for (const statement of d.body)
          walkStatement(statement, (e) => {
            const enumConstructor = e.kind === "CallExpression" && e.receiver?.kind === "IdentifierExpression" &&
              visible.has(e.receiver.name) && enumVariants.get(e.receiver.name)?.has(e.methodName ?? e.callee);
            if (
              e.kind === "CallExpression" &&
              !enumConstructor &&
              !functionNames.has(e.callee) &&
              !moduleBuiltinNames.has(e.callee)
            )
              unavailable(e.callee, e.span);
          });
      }
    }
  }
  return out;
  function walkStatement(s: Statement, visit: (e: Expression) => void) {
    if (
      s.kind === "LetStatement" ||
      s.kind === "ReturnStatement" ||
      s.kind === "AssignStatement"
    )
      walkExpression(s.value, visit);
    else if (s.kind === "IfStatement") {
      walkExpression(s.condition, visit);
      s.thenBody.forEach((x) => walkStatement(x, visit));
      s.elseBody?.forEach((x) => walkStatement(x, visit));
    } else if (s.kind === "ForStatement") {
      walkExpression(s.iterable, visit);
      s.body.forEach((x) => walkStatement(x, visit));
    } else if (s.kind === "WhileStatement" || s.kind === "RepeatStatement") {
      walkExpression(
        s.kind === "WhileStatement" ? s.condition : s.count,
        visit,
      );
      s.body.forEach((x) => walkStatement(x, visit));
    }
  }
  function walkExpression(e: Expression, visit: (e: Expression) => void) {
    visit(e);
    if (e.kind === "UnaryExpression") walkExpression(e.operand, visit);
    else if (e.kind === "BinaryExpression") {
      walkExpression(e.left, visit);
      walkExpression(e.right, visit);
    } else if (e.kind === "CallExpression")
      e.args.forEach((x) => walkExpression(x, visit));
    else if (e.kind === "IndexExpression") {
      walkExpression(e.object, visit);
      walkExpression(e.index, visit);
    } else if (e.kind === "FieldAccessExpression")
      walkExpression(e.object, visit);
    else if (e.kind === "ListLiteralExpression")
      e.elements.forEach((x) => walkExpression(x, visit));
    else if (e.kind === "RecordValueExpression")
      e.fields.forEach((x) => walkExpression(x.value, visit));
  }
}

function declarationName(d: Declaration): string {
  if (d.kind === "StyleDeclaration") return d.name ?? "style";
  if ("name" in d) return d.name;
  if (d.kind === "ApiDeclaration") return d.route;
  return "";
}
function resolveImport(
  file: string,
  request: string,
  manifestFile: string,
): string | undefined {
  if (request.startsWith("std.")) return undefined;
  return request.startsWith("./") || request.startsWith("../")
    ? resolve(dirname(file), request)
    : resolveDependencyImport(manifestFile, request);
}
function directImportedDeclarations(
  module: { file: string; ast: Program },
  entries: { file: string; ast: Program }[],
  manifestFile?: string,
) {
  const out: Declaration[] = [];
  for (const imp of module.ast.imports) {
    const target = resolveImport(
      module.file,
      imp.path,
      manifestFile ?? resolve(dirname(module.file), "pipe.toml"),
    );
    if (!target || !existsSync(target)) continue;
    const imported = entries.find((x) => x.file === realpathSync(target));
    if (!imported) continue;
    for (const name of imp.names) {
      const d = imported.ast.declarations.find(
        (x) => declarationName(x) === name,
      );
      if (d) out.push(d);
    }
  }
  return out;
}
function strictModuleVisibilityDiagnostics(
  entries: { file: string; ast: Program }[],
  manifestFor: (file: string) => string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const module of entries)
    for (const imp of module.ast.imports) {
      const target = resolveImport(
        module.file,
        imp.path,
        manifestFor(module.file),
      );
      if (!target || !existsSync(target)) continue;
      const imported = entries.find((x) => x.file === realpathSync(target));
      if (!imported || hasManifest(dirname(imported.file))) continue;
      for (const name of imp.names) {
        const declaration = imported.ast.declarations.find(
          (d) => declarationName(d) === name,
        );
        if (declaration && declaration.visibility !== "public")
          out.push(
            diagnostic(
              "PIPE-MOD-007",
              `Module does not export "${name}"`,
              imp.span,
              {
                kind: "missing_export",
                received: name,
                suggestions: ["Export the target declaration with public, or import a public symbol."],
                repair: { type: "visibility", value: `Make "${name}" public in the imported module` },
                related: [{ message: `Imported module: ${imported.file}`, span: imported.ast.span }],
              },
            ),
          );
      }
    }
  return out;
}
