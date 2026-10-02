import { AI_LANGUAGE_CONSTRUCTS } from "./ai-language.js";
import { PUBLIC_STDLIB_CONTRACTS } from "../stdlib/stdlib.js";
import { CAPABILITY_KINDS } from "../runtime/capabilities.js";

type KnowledgeRecord = Record<string, unknown>;
export interface KnowledgeSources {
  examples: { schemaVersion?: string; languageVersion?: string; examples?: KnowledgeRecord[] };
  diagnostics: KnowledgeRecord;
}
export interface KnowledgeIndex {
  schemaVersion: "bmec.knowledge-index.v1";
  packageVersion: string;
  languageVersion: string;
  compatibility: string;
  symbols: KnowledgeRecord[];
  capabilities: KnowledgeRecord[];
  diagnostics: KnowledgeRecord;
  examples: KnowledgeRecord[];
  queryOptions: KnowledgeRecord[];
}
export type KnowledgeCategory = "all" | "language" | "stdlib" | "workflow" | "example" | "capability" | "diagnostic";
export interface KnowledgeContext extends KnowledgeRecord {
  schemaVersion: "bmec.knowledge-context.v1";
  task: string;
  relevant_symbols: KnowledgeRecord[];
  syntax: string[];
  examples: KnowledgeRecord[];
  diagnostics: KnowledgeRecord[];
  diagnostic_guidance: string[];
  capabilities: KnowledgeRecord[];
  limitations: string[];
  version: { package: string; language: string; compatibility: string };
}
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const camelWords = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLocaleLowerCase();
const tokens = (value: string) => camelWords(value).split(/[^a-z0-9]+/).filter(Boolean);
const synonymMap: Record<string, string[]> = {
  paginate: ["pagination", "cursor", "page", "database"], pagination: ["paginate", "cursor", "page"],
  orders: ["order", "checkout", "database"], order: ["orders", "checkout"],
  auth: ["authentication", "authorization", "authenticated", "session", "security"], authenticated: ["auth", "authentication", "authorization", "session"],
  login: ["auth", "authentication", "session", "password"], email: ["sendemail", "send", "mail"],
  rollback: ["transaction", "failure", "atomic"], transaction: ["rollback", "atomic", "database"],
  responsive: ["small", "screens", "layout", "style"], card: ["component", "style", "surface"],
  css: ["style", "design", "token"], file: ["filesystem", "readtextfile", "writetextfile"],
};
const expandedQuery = (query: string) => {
  const result = new Set(tokens(query));
  for (const word of [...result]) for (const synonym of synonymMap[word] ?? []) for (const part of tokens(synonym)) result.add(part);
  return [...result];
};
const corpusFor = (record: KnowledgeRecord) => JSON.stringify(record).replace(/["{}[\],:]/g, " ");
function relevance(query: string, record: KnowledgeRecord): number {
  const queryWords = expandedQuery(query);
  if (!queryWords.length) return 0;
  const id = String(record.id ?? "").toLocaleLowerCase(), name = String(record.name ?? "").toLocaleLowerCase();
  const title = String(record.title ?? "").toLocaleLowerCase(), purpose = String(record.purpose ?? record.summary ?? "").toLocaleLowerCase();
  const corpus = corpusFor(record).toLocaleLowerCase();
  let score = 0;
  for (const word of queryWords) {
    if (id.includes(word)) score += 10;
    if (name.includes(word) || title.includes(word)) score += 6;
    if (purpose.includes(word)) score += 3;
    else if (corpus.includes(word)) score += 1;
  }
  return score;
}
function namespaceFor(name: string): string {
  if (/^(text|trim|lower|upper|startsWith|endsWith|substring|parseInteger|parseNumber|parseBoolean)/.test(name)) return "text";
  if (/^(first|last|length|contains|sort|reverse|slice|distinct|join|split|map|filter|fold|find|any|all|range)/.test(name)) return "list";
  if (/^(encodeJson|decodeJson)/.test(name)) return "json";
  if (/^(path)/.test(name)) return "path";
  if (/^(httpRequest)/.test(name)) return "http";
  if (/^(readTextFile|writeTextFile|appendTextFile|fileExists|listDirectory|createDirectory|copyTextFile|moveTextFile|removeTextFile|saveUpload)/.test(name)) return "file";
  if (/^(environment)/.test(name)) return "env";
  if (/^(currentTime|today|delay|scheduleOnce|cancel|timeout|addDays|addSeconds|date|datetime|formatDate|parseDate)/.test(name)) return "time";
  if (/^(random|secureRandom)/.test(name)) return "random";
  if (/^(sendEmail)/.test(name)) return "email";
  return "core";
}
function stdlibRecord(contract: KnowledgeRecord): KnowledgeRecord {
  const name = String(contract.name ?? "");
  const args = asStrings(contract.arguments);
  const capabilities = asStrings(contract.capabilities);
  return {
    id: `STDLIB-${name}`,
    kind: "stdlib",
    name,
    namespace: namespaceFor(name),
    purpose: `${name} is a built-in ${namespaceFor(name)} standard-library function.`,
    syntax: `${name}(${args.map((_, index) => `arg${index + 1}`).join(", ")})`,
    types: [...args, String(contract.returns ?? "unknown")],
    effects: capabilities,
    capabilities,
    errors: String(contract.returns ?? "").includes("result<") ? ["Returns a typed Result; inspect and handle its error value."] : [],
    related: [],
  };
}
export function createKnowledgeIndex(sources: KnowledgeSources, packageVersion: string): KnowledgeIndex {
  const constructs = AI_LANGUAGE_CONSTRUCTS as unknown as KnowledgeRecord[];
  const stdlib = (PUBLIC_STDLIB_CONTRACTS as unknown as KnowledgeRecord[]).map(stdlibRecord);
  const workflows: KnowledgeRecord[] = [
    {
      id: "WORKFLOW-PUBLIC-STARTER-LOCAL-RUN",
      kind: "workflow",
      name: "create and run a public BMEC starter locally",
      purpose: "Generate BMEC's generic starter project, change into it, and check, test, build, and run its app from the project directory.",
      syntax: "bmec new task-api\ncd task-api\nbmec check main.bmec\nbmec test main.bmec\nbmec build main.bmec\nbmec run main.bmec",
      constraints: ["Run every project command after changing into task-api so relative source files and generated output resolve inside the new project.", "The generic starter creates a local app; bmec run starts a development server using local SQLite and does not provision or deploy hosting infrastructure.", "Before hosting, choose and configure a host, persistent database, secrets, network policy, process supervision, and deployment checks for that environment."],
      related: ["new", "starter", "project", "task-api", "check", "test", "build", "run", "local", "SQLite", "hosting", "deployment"],
      example: "docs/GETTING_STARTED.md",
    },
    {
      id: "WORKFLOW-LOCAL-AUTH-NO-USERS",
      kind: "workflow",
      name: "development authentication without configured users",
      purpose: "Run a BMEC app locally without a configured user list; authenticated routes deny requests until a development user is configured.",
      syntax: "bmec run main.bmec",
      constraints: ["Without BMEC_AUTH_USERS, the local runtime has no configured login users, so authenticated routes cannot be exercised successfully.", "Routes without an authentication policy may still be public; declare an explicit policy for protected routes.", "Authentication does not add owner filters to database queries; include each owner or workspace predicate explicitly."],
      related: ["development", "local", "authentication", "auth", "authenticated", "BMEC_AUTH_USERS", "owner", "authorization"],
      example: "docs/CAPABILITIES.md#authentication-and-authorization",
    },
    {
      id: "WORKFLOW-LOCAL-AUTH-CONFIGURED-USERS",
      kind: "workflow",
      name: "development authentication with configured local users",
      purpose: "Configure synthetic local users for exercising authenticated routes and owner-scoped CRUD without placing credentials in project files.",
      syntax: "$env:BMEC_AUTH_USERS = '[{\"id\":\"owner-a\",\"password\":\"replace-with-local-test-password\",\"role\":\"admin\"}]'\nbmec run main.bmec",
      constraints: ["BMEC_AUTH_USERS is a JSON array of objects with text id, password, and role fields; use synthetic credentials in the local process environment or test harness.", "BMEC_AUTH_DEFAULT_POLICY defaults to role:admin; configure explicit route policies when exercising other roles.", "Authentication does not add database owner filters: derive owner keys from Principal and include owner/workspace predicates in reads and mutations.", "This local credential provider is for development and acceptance tests; production identity must use a separately configured provider."],
      related: ["BMEC_AUTH_USERS", "BMEC_AUTH_DEFAULT_POLICY", "configured", "local", "development", "test", "authentication", "auth", "login", "users", "credentials", "owner", "tenant", "principal", "authenticated", "authorization", "crud"],
      example: "docs/CAPABILITIES.md#authentication-and-authorization",
    },
    {
      id: "WORKFLOW-OWNER-SCOPED-READ",
      kind: "workflow",
      name: "principal-derived owner-scoped database read",
      purpose: "Build an authenticated read whose owner predicate comes from the server-resolved Principal and is applied in the database before its bounded result is returned.",
      syntax: "async function listTasks(principal Principal, db capability<database>) -> task<list<Task>> { return wait for get tasks from Task where ownerAuthId is principal.id ordered by id ascending limited to 50 using db }\nserve GET /api/tasks requiring authenticated and database with listTasks",
      constraints: ["Derive the owner key from the injected Principal, never a request field supplied by the caller.", "Put tenant/owner predicates in the typed database query so filtering occurs before its limit.", "Add every workspace or repository scope predicate explicitly; BMEC does not inject a global tenant filter.", "Test anonymous denial, forged owner fields, cross-tenant reads, and no-write behavior for denied mutations."],
      related: ["owner", "tenant", "principal", "authenticated", "authentication", "authorization", "database", "pagination"],
      example: "docs/CAPABILITIES.md#authentication-and-authorization",
    },
  ];
  const symbols: KnowledgeRecord[] = [...constructs.map(item => ({ ...item, kind: "construct" })), ...stdlib, ...workflows];
  symbols.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const capabilities = CAPABILITY_KINDS.map(name => ({ name, stdlib: stdlib.filter(item => asStrings(item.capabilities).includes(name)).map(item => item.name) }));
  return {
    schemaVersion: "bmec.knowledge-index.v1",
    packageVersion,
    languageVersion: String(sources.examples.languageVersion ?? "0.1"),
    compatibility: "0.1-alpha",
    symbols,
    capabilities,
    diagnostics: sources.diagnostics,
    examples: sources.examples.examples ?? [],
    queryOptions: [
      { name: "category", values: ["all", "language", "stdlib", "workflow", "example", "capability", "diagnostic"], default: "all" },
      { name: "limit", minimum: 1, maximum: 20, default: 4 },
    ],
  };
}
export function createKnowledgeContext(query: string, index: KnowledgeIndex, options: { limit?: number; category?: KnowledgeCategory } = {}): KnowledgeContext {
  const cleanQuery = query.trim();
  const category = options.category ?? "all";
  const symbolLimit = options.limit ?? 6, exampleLimit = options.limit ?? 3;
  const ranked = index.symbols.filter(symbol => category === "all" || category === "language" && (symbol.kind === "construct" || symbol.kind === "language") || symbol.kind === category)
    .map(symbol => ({ symbol, score: relevance(cleanQuery, symbol) })).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.symbol.id).localeCompare(String(right.symbol.id))).slice(0, symbolLimit);
  const relevantSymbols = category === "example" || category === "diagnostic" || category === "capability" ? [] : ranked.map(({ symbol }) => ({
    id: symbol.id, kind: symbol.kind, name: symbol.name, purpose: symbol.purpose,
    ...(symbol.syntax ? { syntax: symbol.syntax } : {}), ...(symbol.types ? { types: symbol.types } : {}),
    ...(symbol.constraints ? { constraints: symbol.constraints } : {}), ...(symbol.errors ? { errors: symbol.errors } : {}),
    ...(symbol.effects ? { effects: symbol.effects } : {}), ...(symbol.related ? { related: symbol.related } : {}),
    ...(symbol.example ? { example: symbol.example } : {}),
  }));
  const relatedTerms = new Set([...expandedQuery(cleanQuery), ...ranked.flatMap(({ symbol }) => [String(symbol.name ?? ""), ...asStrings(symbol.related), ...asStrings(symbol.effects)]).flatMap(tokens)]);
  const examples = (category === "all" || category === "example" ? index.examples.map(example => ({ example, score: relevance(cleanQuery, example) + asStrings(example.constructs).filter(item => relatedTerms.has(item.toLocaleLowerCase())).length * 2 })) : [])
    .filter(item => item.score > 0).sort((left, right) => right.score - left.score || String(left.example.id).localeCompare(String(right.example.id))).slice(0, exampleLimit)
    .map(({ example }) => ({ id: example.id, name: example.name, title: example.title, purpose: example.purpose, source: example.source, check: example.check }));
  const capabilities = (category === "all" || category === "capability" ? index.capabilities.filter(capability => {
    const name = String(capability.name);
    return relatedTerms.has(name.toLocaleLowerCase()) || ranked.some(({ symbol }) => asStrings(symbol.capabilities).includes(name));
  }).slice(0, options.limit ?? 4) : []);
  const diagnosticGuidance = category === "all" || category === "diagnostic" ? ranked.flatMap(({ symbol }) => asStrings(symbol.errors)).slice(0, 4) : [];
  const diagnosticCodes = new Set<string>();
  for (const { symbol } of ranked) {
    const id = String(symbol.id ?? "");
    if (id.startsWith("STDLIB-")) diagnosticCodes.add("PIPE-FUNC");
    if (id.startsWith("UI-")) diagnosticCodes.add("PIPE-UI");
    if (id.startsWith("DB-")) { diagnosticCodes.add("PIPE-MODEL"); diagnosticCodes.add("PIPE-TYPE"); }
    if (id.startsWith("HTTP-")) { diagnosticCodes.add("PIPE-REF"); diagnosticCodes.add("PIPE-TYPE"); }
    if (id.startsWith("LANG-")) { diagnosticCodes.add("PIPE-SYN"); diagnosticCodes.add("PIPE-TYPE"); }
  }
  const diagnosticCategories = index.diagnostics.categories && typeof index.diagnostics.categories === "object" ? index.diagnostics.categories as Record<string, unknown> : {};
  const diagnostics = category === "diagnostic"
    ? Object.entries(diagnosticCategories).map(([code, name]) => ({ code, category: String(name) })).filter(item => relevance(cleanQuery, { id: item.code, name: item.category }) > 0).slice(0, options.limit ?? 4)
    : category === "all" ? [...diagnosticCodes].sort().map(code => ({ code, category: String(diagnosticCategories[code] ?? "compiler diagnostics") })) : [];
  const limitations = category === "example" || category === "diagnostic" || category === "capability" ? [] : ranked.flatMap(({ symbol }) => asStrings(symbol.constraints)).slice(0, 6);
  return {
    schemaVersion: "bmec.knowledge-context.v1",
    task: cleanQuery,
    relevant_symbols: relevantSymbols,
    syntax: [...new Set(ranked.map(({ symbol }) => symbol.syntax).filter((value): value is string => typeof value === "string"))].slice(0, 6),
    examples,
    diagnostics,
    diagnostic_guidance: diagnosticGuidance,
    capabilities,
    limitations,
    version: { package: index.packageVersion, language: index.languageVersion, compatibility: index.compatibility },
  };
}
