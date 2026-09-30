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
}
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
  const symbols: KnowledgeRecord[] = [...constructs.map(item => ({ ...item, kind: "construct" })), ...stdlib];
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
  };
}
export function createKnowledgeContext(query: string, index: KnowledgeIndex): KnowledgeContext {
  const cleanQuery = query.trim();
  const ranked = index.symbols.map(symbol => ({ symbol, score: relevance(cleanQuery, symbol) })).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.symbol.id).localeCompare(String(right.symbol.id))).slice(0, 6);
  const relevantSymbols = ranked.map(({ symbol }) => ({
    id: symbol.id, kind: symbol.kind, name: symbol.name, purpose: symbol.purpose,
    ...(symbol.syntax ? { syntax: symbol.syntax } : {}), ...(symbol.types ? { types: symbol.types } : {}),
    ...(symbol.constraints ? { constraints: symbol.constraints } : {}), ...(symbol.errors ? { errors: symbol.errors } : {}),
    ...(symbol.effects ? { effects: symbol.effects } : {}), ...(symbol.related ? { related: symbol.related } : {}),
    ...(symbol.example ? { example: symbol.example } : {}),
  }));
  const relatedTerms = new Set([...expandedQuery(cleanQuery), ...ranked.flatMap(({ symbol }) => [String(symbol.name ?? ""), ...asStrings(symbol.related), ...asStrings(symbol.effects)]).flatMap(tokens)]);
  const examples = index.examples.map(example => ({ example, score: relevance(cleanQuery, example) + asStrings(example.constructs).filter(item => relatedTerms.has(item.toLocaleLowerCase())).length * 2 }))
    .filter(item => item.score > 0).sort((left, right) => right.score - left.score || String(left.example.id).localeCompare(String(right.example.id))).slice(0, 3)
    .map(({ example }) => ({ id: example.id, name: example.name, title: example.title, purpose: example.purpose, source: example.source, check: example.check }));
  const capabilities = index.capabilities.filter(capability => {
    const name = String(capability.name);
    return relatedTerms.has(name.toLocaleLowerCase()) || ranked.some(({ symbol }) => asStrings(symbol.capabilities).includes(name));
  });
  const diagnosticGuidance = ranked.flatMap(({ symbol }) => asStrings(symbol.errors)).slice(0, 4);
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
  const diagnostics = [...diagnosticCodes].sort().map(code => ({ code, category: String(diagnosticCategories[code] ?? "compiler diagnostics") }));
  const limitations = ranked.flatMap(({ symbol }) => asStrings(symbol.constraints)).slice(0, 6);
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
