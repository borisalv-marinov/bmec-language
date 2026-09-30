import { lex, type Token } from "../lexer/lexer.js";
import type {
  Program,
  Declaration,
  ImportDeclaration,
  IndexDeclaration,
  FieldDeclaration,
  Modifier,
  Statement,
  Expression,
  Parameter,
} from "../ast/ast.js";
export class PipeParseError extends Error {
  constructor(
    public code: string,
    message: string,
    public token: Token,
    public context: { kind?: string; expected?: string; received?: string; suggestions?: string[] } = {},
  ) {
    super(`${code}: ${message}`);
  }
}
export function parse(source: string, file = "<input>"): Program {
  const enumNames = new Set<string>();
  const sourceTokens = lex(source, file);
  sourceTokens.forEach((token, index) => {
    if (token.kind === "word" && token.value === "enum" && sourceTokens[index + 1]?.kind === "word")
      enumNames.add(sourceTokens[index + 1]!.value);
  });
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}/g))
    for (const item of match[1]!.split(",")) {
      const importedName = item.trim().split(/\s+as\s+/)[0];
      if (importedName) enumNames.add(importedName);
    }
  const methodOwners = new Map<string, string>();
  const ownerParams = new Map<string, string>();
  const constraints = new Map<
    string,
    { parameter: string; interfaceName: string }[]
  >();
  source = source.replace(
    /\b(let|var)\s+([A-Za-z_]\w*)\s+(?![A-Z][A-Za-z0-9_]*\b|(?:text|number|integer|boolean|money|date|datetime|id|list|result)\b)([A-Za-z_]\w*)\s+(?:is|be)(?=\s)/g,
    "$1 $2_$3 = ",
  );
  source = source.replace(
    /\b(let|var)(\s+[A-Za-z_]\w*)(\s+(?:text|number|integer|boolean|money|date|datetime|id|list<[^>]+>|result<[^>]+>|[A-Z][A-Za-z0-9_]*\??))?\s+(?:is|be)(?=\s)/g,
    "$1$2$3 = ",
  );
  for (const m of source.matchAll(/type\s+([A-Za-z_]\w*)\s*<([^>]+)>/g))
    ownerParams.set(m[1]!, m[2]!);
  source = source.replace(
    /function\s+([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)(?:<([^>]+)>)?\s*\(/g,
    (_, owner, name, explicit) => {
      methodOwners.set(name, owner);
      const params = explicit ?? ownerParams.get(owner);
      return `function ${name}${params ? "<" + params + ">" : ""}(`;
    },
  );
  source = source.replace(
    /function\s+([A-Za-z_]\w*)\s*<([^>]+)>\s*\(/g,
    (_, name, params) => {
      const clean = params
        .split(",")
        .map((x: string) => {
          const [p, i] = x.split(":").map((y) => y.trim());
          if (i) {
            const a = constraints.get(name) ?? [];
            a.push({ parameter: p!, interfaceName: i });
            constraints.set(name, a);
          }
          return p;
        })
        .join(",");
      return `function ${name}<${clean}>(`;
    },
  );
  for (let i = 0; i < 4; i++)
    source = source.replace(
      /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(([^()]*)\)/g,
      (_, receiver, name, args) => {
        if (enumNames.has(receiver)) return `${receiver}.${name}(${args})`;
        const extra = args.trim() ? "," + args : "";
        return name + "(" + receiver + extra + ")";
      },
    );
  const p = new Parser(lex(source, file)).program();
  for (const d of p.declarations)
    if (d.kind === "FunctionDeclaration") {
      if (d.parameters[0]?.name === "self" && methodOwners.has(d.name)) {
        d.receiverOwner = methodOwners.get(d.name);
        d.receiverType = d.receiverOwner;
      }
      if (constraints.has(d.name)) d.constraints = constraints.get(d.name);
    }
  return p;
}
function normalizeControlledDatabase(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length;) {
    const a = tokens[i],
      b = tokens[i + 1],
      c = tokens[i + 2],
      d = tokens[i + 3],
      e = tokens[i + 4],
      f = tokens[i + 5],
      g = tokens[i + 6],
      h = tokens[i + 7],
      iToken = tokens[i + 8],
      j = tokens[i + 9],
      k = tokens[i + 10],
      l = tokens[i + 11];
    const comparison =
      g?.kind === "word" && g.value === "is" && h?.kind === "word" && iToken?.kind === "word" &&
      j && (j.kind === "word" || j.kind === "number" || j.kind === "string") &&
      k?.kind === "word" && k.value === "using" && l?.kind === "word"
      ? ({
          "at least": ">=",
          "at most": "<=",
          "greater than": ">",
          "less than": "<",
          "equal to": "=",
        } as Record<string, "=" | ">=" | "<=" | ">" | "<">)[`${h.value} ${iToken.value}`]
      : undefined;
    if (
      a?.kind === "word" && a.value === "get" &&
      b?.kind === "word" && c?.kind === "word" && c.value === "from" &&
      d?.kind === "word" && e?.kind === "word" && e.value === "where" &&
      f?.kind === "word" && g?.kind === "word" && g.value === "is" &&
      h && (h.kind === "word" || h.kind === "number" || h.kind === "string") &&
      iToken?.kind === "word" && iToken.value === "using" && j?.kind === "word"
    ) {
      const span = { start: a.span.start, end: j.span.end };
      out.push(
        { kind: "word", value: "databaseSelectWhere", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: j.value, span: j.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        h,
        { kind: ")", value: ")", span },
      );
      i += 10;
      continue;
    }
    if (
      a?.kind === "word" && a.value === "get" &&
      b?.kind === "word" && c?.kind === "word" && c.value === "from" &&
      d?.kind === "word" && e?.kind === "word" && e.value === "where" &&
      f?.kind === "word" && g?.kind === "word" && g.value === "is" &&
      h?.kind === "word" && h.value === "not" &&
      iToken && (iToken.kind === "word" || iToken.kind === "number" || iToken.kind === "string") &&
      j?.kind === "word" && j.value === "using" && k?.kind === "word"
    ) {
      const span = { start: a.span.start, end: k.span.end };
      out.push(
        { kind: "word", value: "databaseSelectWhere", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: k.value, span: k.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: "!=", span: { start: g.span.start, end: h.span.end } },
        { kind: ",", value: ",", span },
        iToken,
        { kind: ")", value: ")", span },
      );
      i += 11;
      continue;
    }
    if (
      a?.kind === "word" && a.value === "get" &&
      b?.kind === "word" && c?.kind === "word" && c.value === "from" &&
      d?.kind === "word" && e?.kind === "word" && e.value === "where" &&
      f?.kind === "word" && comparison
    ) {
      const span = { start: a.span.start, end: l!.span.end };
      out.push(
        { kind: "word", value: "databaseSelectWhere", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: l!.value, span: l!.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: comparison, span: { start: g!.span.start, end: iToken!.span.end } },
        { kind: ",", value: ",", span },
        j!,
        { kind: ")", value: ")", span },
      );
      i += 12;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "get" &&
      b?.kind === "word" &&
      c?.kind === "word" &&
      c.value === "from" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "using" &&
      f?.kind === "word"
    ) {
      const span = { start: a.span.start, end: f.span.end };
      out.push(
        { kind: "word", value: "databaseSelect", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ")", value: ")", span },
      );
      i += 6;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "add" &&
      b?.kind === "word" &&
      c?.kind === "word" &&
      c.value === "to" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "using" &&
      f?.kind === "word"
    ) {
      const span = { start: a.span.start, end: f.span.end };
      out.push(
        { kind: "word", value: "databaseInsert", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ",", value: ",", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: ")", value: ")", span },
      );
      i += 6;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "remove" &&
      b?.kind === "word" &&
      c?.kind === "word" &&
      c.value === "with" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "using" &&
      f?.kind === "word"
    ) {
      const span = { start: a.span.start, end: f.span.end };
      out.push(
        { kind: "word", value: "databaseDelete", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: f.value, span: f.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: b.value, span: b.span },
        { kind: ",", value: ",", span },
        { kind: "word", value: d.value, span: d.span },
        { kind: ")", value: ")", span },
      );
      i += 6;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "change" &&
      b?.kind === "word" &&
      c?.kind === "word" &&
      c.value === "on" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      f?.kind === "word" &&
      f.value === "using" &&
      g?.kind === "word"
    ) {
      const span = { start: a.span.start, end: g.span.end };
      out.push(
        { kind: "word", value: "databaseUpdate", span },
        { kind: "(", value: "(", span },
        { kind: "word", value: g.value, span: g.span },
        { kind: ",", value: ",", span },
        { kind: "string", value: d.value, span: d.span },
        { kind: ",", value: ",", span },
        { kind: "word", value: e.value, span: e.span },
        { kind: ",", value: ",", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: ")", value: ")", span },
      );
      i += 7;
      continue;
    }
    out.push(a!);
    i++;
  }
  return out;
}
function normalizeControlledHttp(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length;) {
    const a = tokens[i],
      b = tokens[i + 1],
      c = tokens[i + 2],
      d = tokens[i + 3],
      e = tokens[i + 4],
      f = tokens[i + 5],
      g = tokens[i + 6],
      h = tokens[i + 7],
      j = tokens[i + 8],
      k = tokens[i + 9],
      l = tokens[i + 10];
    if (a?.kind === "word" && a.value === "when" && b?.kind === "word" && c?.kind === "word" && c.value === "is" && d?.kind === "word" && d.value === "clicked") {
      const span = { start: a.span.start, end: d.span.end };
      out.push(
        { kind: "word", value: "event", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "(", value: "(", span },
        { kind: ")", value: ")", span },
      );
      i += 4;
      continue;
    }
    if (a?.kind === "word" && a.value === "when" && b?.kind === "word" && c?.kind !== "{") {
      const span = { start: a.span.start, end: b.span.end };
      out.push(
        { kind: "word", value: "event", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "(", value: "(", span },
        { kind: ")", value: ")", span },
      );
      i += 2;
      continue;
    }
    if (a?.kind === "word" && a.value === "show" && b?.kind === "string") {
      const span = { start: a.span.start, end: b.span.end };
      out.push(
        { kind: "word", value: "text", span },
        { kind: "string", value: b.value, span: b.span },
      );
      i += 2;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "ask" &&
      b?.kind === "word" &&
      c?.kind === "word" &&
      c.value === "as" &&
      d?.kind === "word"
    ) {
      const span = { start: a.span.start, end: d.span.end };
      out.push(
        { kind: "word", value: "input", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "word", value: d.value, span: d.span },
      );
      i += 4;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(b.value) &&
      c?.kind === "operator" &&
      c.value === "/"
    ) {
      let cursor = i + 2;
      const pathTokens: Token[] = [];
      while (cursor < tokens.length && !(tokens[cursor]?.kind === "word" && ["requiring", "with", "returns"].includes(tokens[cursor]!.value))) {
        const token = tokens[cursor]!;
        if (token.kind !== "word" && token.kind !== ":" && !(token.kind === "operator" && ["/", "-"].includes(token.value))) break;
        pathTokens.push(token);
        cursor++;
      }
      const contract: Token[] = [];
      const modifier: Token[] = [];
      while (cursor < tokens.length && !(tokens[cursor]?.kind === "word" && tokens[cursor]!.value === "with")) {
        if (tokens[cursor]?.kind === "word" && tokens[cursor]!.value === "requiring") {
          cursor++;
          while (cursor < tokens.length && !(tokens[cursor]?.kind === "word" && ["returns", "with"].includes(tokens[cursor]!.value))) {
            const token = tokens[cursor]!;
            modifier.push(token.kind === "word" && token.value === "and" ? {kind: ",", value: ",", span: token.span} as Token : token);
            cursor++;
          }
          continue;
        }
        if (tokens[cursor]?.kind === "word" && tokens[cursor]!.value === "returns") {
          while (cursor < tokens.length && !(tokens[cursor]?.kind === "word" && ["requiring", "with"].includes(tokens[cursor]!.value))) {
            contract.push(tokens[cursor]!);
            cursor++;
          }
          continue;
        }
        break;
      }
      const withToken = tokens[cursor];
      const handler = tokens[cursor + 1];
      if (pathTokens.length > 1 && withToken?.kind === "word" && withToken.value === "with" && handler?.kind === "word") {
        const span = {start: a.span.start, end: handler.span.end};
        out.push(
          {kind: "word", value: "http", span},
          {kind: "word", value: b.value, span: b.span},
          ...pathTokens,
          ...contract,
          ...(modifier.length ? [{kind: "word", value: "requires", span: withToken.span}, ...modifier] as Token[] : []),
          {kind: "operator", value: "->", span: withToken.span},
          {kind: "word", value: handler.value, span: handler.span},
        );
        i = cursor + 2;
        continue;
      }
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      f.value === "authenticated" &&
      g?.kind === "word" &&
      g.value === "and" &&
      h?.kind === "word" &&
      ["http", "database", "environment", "time", "random", "secureRandom", "filesystem", "email"].includes(h.value) &&
      j?.kind === "word" &&
      j.value === "with" &&
      k?.kind === "word"
    ) {
      const capability = h, withToken = j, handler = k;
      const span = { start: a.span.start, end: handler.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: "authenticated", span: f.span },
        { kind: ",", value: ",", span: g.span },
        { kind: "word", value: capability.value, span: capability.span },
        { kind: "operator", value: "->", span: withToken.span },
        { kind: "word", value: handler.value, span: handler.span },
      );
      i += 10;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      (f.value === "role" || f.value === "attribute") &&
      g?.kind === "word" &&
      h?.kind === "word" &&
      h.value === "and" &&
      j?.kind === "word" &&
      ["http", "database", "environment", "time", "random", "secureRandom", "filesystem", "email"].includes(j.value) &&
      k?.kind === "word" &&
      k.value === "with" &&
      l?.kind === "word"
    ) {
      const policyKind = f, policyName = g, capability = j, withToken = k, handler = l;
      const span = { start: a.span.start, end: handler.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: policyKind.value, span: policyKind.span },
        { kind: "word", value: policyName.value, span: policyName.span },
        { kind: ",", value: ",", span: h.span },
        { kind: "word", value: capability.value, span: capability.span },
        { kind: "operator", value: "->", span: withToken.span },
        { kind: "word", value: handler.value, span: handler.span },
      );
      i += 11;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      ["http", "database", "environment", "time", "random", "secureRandom", "filesystem", "email"].includes(f.value) &&
      g?.kind === "word" &&
      g.value === "with" &&
      h?.kind === "word"
    ) {
      const capability = f, withToken = g, handler = h;
      const span = { start: a.span.start, end: handler.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: capability.value, span: capability.span },
        { kind: "operator", value: "->", span: withToken.span },
        { kind: "word", value: handler.value, span: handler.span },
      );
      i += 8;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      f.value === "role" &&
      g?.kind === "word" &&
      h?.kind === "word" &&
      h.value === "with" &&
      tokens[i + 8]?.kind === "word"
    ) {
      const role = g, withToken = h, handler = tokens[i + 8]!;
      const span = { start: a.span.start, end: handler.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: "role", span: f.span },
        { kind: "word", value: role.value, span: role.span },
        { kind: "operator", value: "->", span: withToken.span },
        { kind: "word", value: handler.value, span: handler.span },
      );
      i += 9;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      f.value === "attribute" &&
      g?.kind === "word" &&
      h?.kind === "word" &&
      h.value === "with" &&
      tokens[i + 8]?.kind === "word"
    ) {
      const attribute = g, withToken = h, handler = tokens[i + 8]!;
      const span = { start: a.span.start, end: handler.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: "attribute", span: f.span },
        { kind: "word", value: attribute.value, span: attribute.span },
        { kind: "operator", value: "->", span: withToken.span },
        { kind: "word", value: handler.value, span: handler.span },
      );
      i += 9;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "requiring" &&
      f?.kind === "word" &&
      f.value === "authenticated" &&
      g?.kind === "word" &&
      g.value === "with" &&
      h?.kind === "word"
    ) {
      const span = { start: a.span.start, end: h.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "word", value: "requires", span: e.span },
        { kind: "word", value: f.value, span: f.span },
        { kind: "operator", value: "->", span: g.span },
        { kind: "word", value: h.value, span: h.span },
      );
      i += 8;
      continue;
    }
    if (
      a?.kind === "word" &&
      a.value === "serve" &&
      b?.kind === "word" &&
      c?.kind === "operator" &&
      c.value === "/" &&
      d?.kind === "word" &&
      e?.kind === "word" &&
      e.value === "with" &&
      f?.kind === "word"
    ) {
      const span = { start: a.span.start, end: f.span.end };
      out.push(
        { kind: "word", value: "http", span },
        { kind: "word", value: b.value, span: b.span },
        { kind: "operator", value: "/", span: c.span },
        { kind: "word", value: d.value, span: d.span },
        { kind: "operator", value: "->", span },
        { kind: "word", value: f.value, span: f.span },
      );
      i += 6;
      continue;
    }
    out.push(a!);
    i++;
  }
  return out;
}
class Parser {
  constructor(
    private ts: Token[],
    private i = 0,
  ) {
    this.ts = normalizeControlledDatabase(normalizeControlledHttp(ts));
    for (const token of this.ts)
      if (token.kind === "word" && token.value === "otherwise")
        token.value = "else";
    for (let index = 0; index < this.ts.length - 3; index++) {
      const operator = this.ts[index + 1];
      const qualifier = this.ts[index + 2];
      const degree = this.ts[index + 3];
      const longPhrase = [operator?.value, qualifier?.value, degree?.value].join(" ");
      const shortPhrase = [operator?.value, qualifier?.value].join(" ");
      const normalized: Record<string, string> = { "is at least": ">=", "is at most": "<=", "is greater than": ">", "is less than": "<", "is equal to": "==", "is not": "!=", "is true": "==", "is false": "==" };
      const phrase = normalized[longPhrase] ? longPhrase : shortPhrase;
      const removeCount = normalized[longPhrase] ? 3 : phrase === "is not" ? 2 : 1;
      if (operator?.kind === "word" && qualifier?.kind === "word" && normalized[phrase]) {
        const end = removeCount === 3 ? degree!.span.end : qualifier.span.end;
        this.ts.splice(index + 1, removeCount, { kind: "operator", value: normalized[phrase]!, span: { start: operator.span.start, end } });
        index--;
      }
    }
    for (let index = 0; index < this.ts.length - 1; index++)
      if (
        this.ts[index]?.kind === "word" &&
        this.ts[index]?.value === "for" &&
        this.ts[index + 1]?.kind === "word" &&
        this.ts[index + 1]?.value === "each"
      )
        this.ts.splice(index + 1, 1);
    for (let index = 0; index < this.ts.length - 1; index++)
      if (
        this.ts[index]?.kind === "word" &&
        this.ts[index]?.value === "propagate" &&
        this.ts[index + 1]?.kind === "word"
      ) {
        const operand = this.ts[index + 1]!;
        this.ts.splice(index, 2, operand, {
          kind: "?",
          value: "?",
          span: operand.span,
        });
      }
  }
  private component = (k: Token): any => {
    const n = this.expect("word");
    let style: string | undefined;
    let form = false;
    if (this.t().kind === "word" && this.t().value === "uses") {
      this.take();
      this.expect("word", "style");
      style = this.expect("word").value;
    }
    if (this.t().kind === "word" && this.t().value === "form") {
      this.take();
      form = true;
    }
    this.expect("{");
    const children: any[] = [];
    while (this.t().kind !== "}") {
      const c = this.expect("word");
      if (c.value === "link") {
        const label = this.expect("string");
        this.expect("word", "to");
        const target = this.expect("word");
        const parameters: { name: string; path: string }[] = [];
        let end = target;
        if (this.t().kind === "word" && this.t().value === "with") {
          this.take();
          do {
            const name = this.expect("word");
            const path = this.expect("word");
            this.expect(".");
            const field = this.expect("word");
            parameters.push({ name: name.value, path: `${path.value}.${field.value}` });
            end = field;
            if (this.t().kind !== ",") break;
            this.take();
          } while (true);
        }
        children.push({ kind: "PageLinkDeclaration", label: label.value, target: target.value, ...(parameters.length ? { parameters } : {}), span: this.end(c, end) });
        continue;
      }
      if (c.value === "dialog") {
        const label = this.expect("string");
        this.expect("word", "title");
        const title = this.expect("string");
        this.expect("word", "message");
        const message = this.expect("string");
        children.push({ kind: "PageDialogDeclaration", label: label.value, title: title.value, message: message.value, span: this.end(c, message) });
        continue;
      }
      if (c.value === "text") {
        const value = this.expect("string");
        children.push({
          kind: "ComponentTextDeclaration",
          value: value.value,
          span: this.end(c, value),
        });
        continue;
      }
      if (c.value === "show" && this.t().kind === "word" && this.t().value === "total") {
        this.take();
        this.expect("word", "of");
        const source = this.expect("word");
        this.expect("word", "by");
        const field = this.expect("word");
        let multiplier: string | undefined;
        let end = field;
        if (this.t().kind === "word" && this.t().value === "times") {
          this.take();
          const factor = this.expect("word");
          multiplier = factor.value;
          end = factor;
        }
        children.push({ kind: "ComponentAggregateDeclaration", source: source.value, field: field.value, ...(multiplier ? { multiplier } : {}), span: this.end(c, end) });
        continue;
      }
      if (c.value === "show" && this.t().kind === "word" && this.ts[this.i + 1]?.kind === "word") {
        const receiver = this.take();
        const field = this.take();
        children.push({
          kind: "ComponentBindingDeclaration",
          path: `${receiver.value}.${field.value}`,
          span: this.end(c, field),
        });
        continue;
      }
      if (c.value === "event") {
        const label = this.expect("word");
        this.expect("(");
        this.expect(")");
        children.push({
          kind: "ComponentButtonDeclaration",
          label: label.value,
          event: label.value,
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      if (c.value === "when") {
        const label = this.expect("word");
        this.expect("word", "is");
        this.expect("word", "clicked");
        children.push({
          kind: "ComponentButtonDeclaration",
          label: label.value,
          event: label.value,
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      if (c.value === "button") {
        const label = this.expect("string");
        let event: string | undefined;
        const arguments_: { name: string; path: string }[] = [];
        if (this.t().kind === "word" && this.t().value === "on") {
          this.take();
          event = this.expect("word").value;
        }
        if (this.t().kind === "word" && this.t().value === "with") {
          this.take();
          do {
            const name = this.expect("word");
            this.expect("word", "from");
            const receiver = this.expect("word");
            const path = this.t().kind === "." ? (this.take(), `${receiver.value}.${this.expect("word").value}`) : receiver.value;
            arguments_.push({ name: name.value, path });
            if (this.t().kind !== "word" || this.t().value !== "and") break;
            this.take();
          } while (true);
        }
        if (arguments_.length && !event)
          throw new PipeParseError("PIPE-SYN-003", 'A button argument requires an event, for example: button "Add" on add with productId from product.id or items from cart', label);
        children.push({
          kind: "ComponentButtonDeclaration",
          label: label.value,
          event,
          ...(arguments_.length ? { arguments: arguments_ } : {}),
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      if (c.value === "use") {
        const component = this.expect("word");
        children.push({
          kind: "PageUseDeclaration",
          name: component.value,
          component: component.value,
          span: this.end(c, component),
        });
        continue;
      }
      if (c.value === "input") {
        const name = this.expect("word");
        const type = this.typeRef();
        let label: string | undefined;
        let placeholder: string | undefined;
        let help: string | undefined;
        let disabled = false;
        let readOnly = false;
        let password = false;
        let validation: string | undefined;
        let event: string | undefined;
        if (this.t().kind === "word" && this.t().value === "label") {
          this.take();
          label = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "placeholder") {
          this.take();
          placeholder = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "help") {
          this.take();
          help = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "disabled") {
          this.take();
          disabled = true;
        }
        if (this.t().kind === "word" && this.t().value === "readonly") {
          this.take();
          readOnly = true;
        }
        if (this.t().kind === "word" && this.t().value === "password") {
          this.take();
          password = true;
        }
        if (this.t().kind === "word" && this.t().value === "validate") {
          this.take();
          validation = this.expect("word").value;
        }
        if (this.t().kind === "word" && this.t().value === "on") {
          this.take();
          event = this.expect("word").value;
        }
        children.push({
          kind: "PageInputDeclaration",
          name: name.value,
          type,
          label,
          placeholder,
          help,
          disabled,
          readOnly,
          password,
          validation,
          event,
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      throw new PipeParseError(
        "PIPE-SYN-003",
        `Unknown component child ${c.value}`,
        c,
      );
    }
    const close = this.expect("}");
    return {
      kind: "ComponentDeclaration",
      name: n.value,
      style,
      form,
      children,
      span: this.end(k, close),
    };
    };
  private styleBlock = (): any => {
    this.expect("{");
    const style: any = { values: [], properties: [], states: [] };
    const numeric = (name: string, code = "PIPE-STYLE-020") => {
      const negative = this.t().kind === "operator" && this.t().value === "-";
      if (negative) this.take();
      const value = this.expect("number");
      const number = Number(`${negative ? "-" : ""}${value.value}`);
      if (!Number.isFinite(number) || number < 0 || (name.includes("columns") && (!Number.isInteger(number) || number < 1)))
        throw new PipeParseError(code, `Unsupported ${name} value "${value.value}"`, value);
      return number;
    };
    const backgroundColor = (): "blue" | "neutral" | "red" | "green" | "dark-blue" => {
      const value = this.expect("word");
      if (value.value === "dark") {
        this.expect("word", "blue");
        return "dark-blue";
      }
      if (value.value !== "blue" && value.value !== "neutral" && value.value !== "red" && value.value !== "green")
        throw new PipeParseError("PIPE-STYLE-003", `Unsupported background value "${value.value}"`, value, { kind: "style_background", expected: "blue, neutral, red, green, or dark blue", received: value.value });
      return value.value;
    };
    while (this.t().kind !== "}") {
      const keyword = this.expect("word");
      if (["padding", "gap", "margin", "width", "height", "columns"].includes(keyword.value)) {
        this.expect("word", "is");
        style[keyword.value] = numeric(keyword.value);
      } else if (keyword.value === "opacity") {
        this.expect("word", "is");
        const value = numeric("opacity", "PIPE-STYLE-028");
        this.expect("word", "percent");
        if (value > 100) throw new PipeParseError("PIPE-STYLE-028", `Unsupported opacity value "${value} percent"`, this.ts[this.i - 2]!);
        style.opacity = value / 100;
      } else if (keyword.value === "responsive") {
        if (this.t().kind === "word" && this.t().value === "columns") {
          this.take();
          this.expect("word", "is");
          style.responsiveColumns = numeric("responsive columns");
        } else {
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "stacked" && value.value !== "fluid") throw new PipeParseError("PIPE-STYLE-005", `Unsupported responsive style value "${value.value}"`, value);
          style.responsive = value.value;
        }
      } else if (keyword.value === "on") {
        this.expect("word", "small");
        this.expect("word", "screens");
        this.expect("{");
        const responsiveProperty = this.expect("word");
        if (responsiveProperty.value === "font") {
          const property = this.expect("word");
          if (property.value === "size") { this.expect("word", "is"); style.responsiveFontSize = numeric("responsive font size", "PIPE-STYLE-023"); }
          else if (property.value === "line") { this.expect("word", "height"); this.expect("word", "is"); style.responsiveLineHeight = numeric("responsive line height", "PIPE-STYLE-022"); }
          else throw new PipeParseError("PIPE-STYLE-027", `Unknown responsive font property "${property.value}"`, property);
        } else {
          this.expect("word", "is");
          if (responsiveProperty.value === "layout") {
            const value = this.expect("word");
            if (value.value !== "row" && value.value !== "column" && value.value !== "grid")
              throw new PipeParseError("PIPE-STYLE-006", `Unsupported responsive layout value "${value.value}"`, value);
            style.responsiveLayout = value.value;
          } else if (responsiveProperty.value === "columns") style.responsiveColumns = numeric("responsive columns");
          else if (responsiveProperty.value === "gap") style.responsiveGap = numeric("responsive gap");
          else if (responsiveProperty.value === "padding") style.responsivePadding = numeric("responsive padding");
          else if (responsiveProperty.value === "margin") style.responsiveMargin = numeric("responsive margin");
          else throw new PipeParseError("PIPE-STYLE-027", `Unknown responsive style property "${responsiveProperty.value}"`, responsiveProperty);
        }
        this.expect("}");
        continue;
      } else if (keyword.value === "background") {
        this.expect("word", "is");
        const value = backgroundColor();
        style.properties.push({ kind: "StyleProperty", name: "background", value, span: this.end(keyword, this.ts[this.i - 1]!) });
      } else if (keyword.value === "state" || keyword.value === "when") {
        const state = this.expect("word");
        if (!["hovered", "focused", "active", "disabled"].includes(state.value)) throw new PipeParseError("PIPE-STYLE-004", `Unsupported style state "${state.value}"`, state);
        if (keyword.value === "when") this.expect("{");
        if (keyword.value === "when" && state.value === "focused" && this.t().kind === "word" && this.t().value === "show") {
          this.take();
          this.expect("word", "focus");
          this.expect("word", "ring");
          this.expect("}");
          style.focus = "ringed";
          continue;
        }
        const property = this.expect("word");
        let propertyValue: string | number;
        let propertyName: "background" | "opacity" | "textColor" = property.value as "background" | "opacity" | "textColor";
        if (property.value === "text") {
          this.expect("word", "color");
          propertyName = "textColor";
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "white" && value.value !== "black" && value.value !== "inherit")
            throw new PipeParseError("PIPE-STYLE-029", `Unsupported text color value "${value.value}"`, value);
          propertyValue = value.value;
        } else if (property.value === "background") {
          this.expect("word", "is");
          propertyValue = backgroundColor();
        } else if (property.value === "opacity") {
          this.expect("word", "is");
          const value = numeric("opacity", "PIPE-STYLE-028");
          this.expect("word", "percent");
          if (value > 100) throw new PipeParseError("PIPE-STYLE-028", `Unsupported opacity value "${value} percent"`, this.ts[this.i - 2]!);
          propertyValue = value / 100;
        } else throw new PipeParseError("PIPE-STYLE-027", `Unknown style state property "${property.value}"`, property);
        if (keyword.value === "when") this.expect("}");
        style.states.push({ kind: "StyleState", state: state.value, properties: [{ kind: "StyleProperty", name: propertyName, value: propertyValue, span: this.end(state, this.ts[this.i - 1]!) }], span: this.end(keyword, this.ts[this.i - 1]!) });
      } else if (keyword.value === "layout") {
        this.expect("word", "is");
        const value = this.expect("word");
        if (!["row", "column", "grid"].includes(value.value)) throw new PipeParseError("PIPE-STYLE-006", `Unsupported layout style value "${value.value}"`, value);
        style.layout = value.value;
      } else if (keyword.value === "alignment") {
        this.expect("word", "is");
        const value = this.expect("word");
        if (!["start", "center", "end", "stretch"].includes(value.value)) throw new PipeParseError("PIPE-STYLE-024", `Unsupported alignment style value "${value.value}"`, value);
        style.alignment = value.value;
      } else if (keyword.value === "text" && this.t().kind === "word" && this.t().value === "color") {
        this.take();
        this.expect("word", "is");
        const value = this.expect("word");
        if (value.value !== "white" && value.value !== "black" && value.value !== "inherit") throw new PipeParseError("PIPE-STYLE-029", `Unsupported text color value "${value.value}"`, value);
        style.textColor = value.value;
      } else if (keyword.value === "radius") {
        this.expect("word", "is");
        style.radius = numeric("radius", "PIPE-STYLE-030");
      } else if (keyword.value === "transition") {
        const property = this.expect("word");
        this.expect("word", "is");
        if (property.value === "duration") style.transitionDuration = numeric("transition duration", "PIPE-STYLE-031");
        else if (property.value === "property") {
          const value = this.expect("word");
          if (!["all", "background", "color", "transform", "opacity"].includes(value.value)) throw new PipeParseError("PIPE-STYLE-032", `Unsupported transition property "${value.value}"`, value);
          style.transitionProperty = value.value;
        } else if (property.value === "easing") {
          const value = this.expect("word");
          if (value.value !== "ease" && value.value !== "linear") throw new PipeParseError("PIPE-STYLE-033", `Unsupported transition easing "${value.value}"`, value);
          style.transitionEasing = value.value;
        } else throw new PipeParseError("PIPE-STYLE-031", `Unsupported transition property "${property.value}"`, property);
      } else if (keyword.value === "typography" || keyword.value === "spacing" || keyword.value === "theme" || keyword.value === "color" || keyword.value === "border" || keyword.value === "shadow" || keyword.value === "corners" || keyword.value === "disabled" || keyword.value === "focus" || keyword.value === "surface" || keyword.value === "text") {
        this.expect("word", "is");
        const value = this.expect("word");
        const allowed: Record<string, string[]> = { typography: ["readable", "compact"], spacing: ["comfortable", "compact"], theme: ["light", "dark", "calm", "contrast"], color: ["blue", "muted", "red", "green"], border: ["subtle", "strong", "red", "green"], shadow: ["soft", "strong"], corners: ["rounded", "pill"], disabled: ["guarded"], focus: ["ringed"], surface: ["elevated"], text: ["muted"] };
        if (!allowed[keyword.value]!.includes(value.value)) throw new PipeParseError(`PIPE-STYLE-${keyword.value === "typography" ? "007" : keyword.value === "spacing" ? "008" : keyword.value === "theme" ? "009" : keyword.value === "color" ? "010" : keyword.value === "border" ? "011" : keyword.value === "shadow" ? "012" : keyword.value === "corners" ? "013" : keyword.value === "disabled" ? "014" : keyword.value === "focus" ? "015" : keyword.value === "surface" ? "016" : "017"}`, `Unsupported ${keyword.value} style value "${value.value}"`, value);
        style[keyword.value] = value.value;
      } else if (keyword.value === "font") {
        const property = this.expect("word");
        this.expect("word", "is");
        if (property.value === "size") style.fontSize = numeric("font size", "PIPE-STYLE-023");
        else if (property.value === "weight") {
          const value = this.expect("word");
          if (value.value !== "normal" && value.value !== "bold") throw new PipeParseError("PIPE-STYLE-021", `Unsupported font weight value "${value.value}"`, value);
          style.fontWeight = value.value;
        } else throw new PipeParseError("PIPE-STYLE-021", `Unsupported font property "${property.value}"`, property);
      } else if (keyword.value === "line") {
        this.expect("word", "height");
        this.expect("word", "is");
        style.lineHeight = numeric("line height", "PIPE-STYLE-022");
      } else if (keyword.value === "composes") {
        style.composes = [];
        do {
          style.composes.push(this.expect("word").value);
          if (this.t().kind === ",") this.take(); else break;
        } while (this.t().kind === "word");
      } else throw new PipeParseError("PIPE-STYLE-027", `Unknown style block property "${keyword.value}"`, keyword);
    }
    this.expect("}");
    if (!style.properties.length) delete style.properties;
    if (!style.states.length) delete style.states;
    return style;
  };
  private t() {
    return this.ts[this.i];
  }
  private take() {
    return this.ts[this.i++];
  }
  private expect(kind: Token["kind"], value?: string) {
    const t = this.take();
    if (t.kind !== kind || (value !== undefined && t.value !== value))
      throw new PipeParseError(
        "PIPE-SYN-003",
        `Expected ${value ?? kind}, got ${t.value || t.kind}`,
        t,
      );
    return t;
  }
  private end(a: Token, b: Token) {
    return { start: a.span.start, end: b.span.end };
  }
  program(): Program {
    const declarations: Declaration[] = [];
    const imports: ImportDeclaration[] = [];
    const start = this.t();
    while (this.t().kind !== "eof") {
      if (this.t().kind === "word" && this.t().value === "import")
        imports.push(this.importDeclaration());
      else declarations.push(this.declaration());
    }
    return {
      kind: "Program",
      declarations,
      imports,
      span: this.end(start, this.ts[this.i - 1] || start),
    };
  }
  importDeclaration(): ImportDeclaration {
    const start = this.expect("word", "import");
    this.expect("{");
    const names: string[] = [];
    while (this.t().kind !== "}") {
      names.push(this.expect("word").value);
      if (this.t().kind === ",") this.take();
      else if (this.t().kind !== "}")
        throw new PipeParseError(
          "PIPE-SYN-003",
          "Expected comma or }",
          this.t(),
        );
    }
    this.expect("}");
    this.expect("word", "from");
    const path = this.expect("string");
    if (
      !path.value.endsWith(".bmec") &&
      !path.value.endsWith(".pipe") &&
      !path.value.startsWith("std.")
    )
      throw new PipeParseError(
        "PIPE-SYN-008",
        "Import path must end with .bmec or .pipe or be a built-in std module",
        path,
      );
    return {
      kind: "ImportDeclaration",
      names,
      path: path.value,
      span: this.end(start, path),
    };
  }
  declaration(): any {
    const k = this.expect("word");
    if (k.value === "public") {
      const declaration = this.declaration();
      declaration.visibility = "public";
      return declaration;
    }
    if (k.value === "test") {
      const n = this.expect("string");
      this.expect("{");
      const body = this.statements();
      const close = this.expect("}");
      return {
        kind: "TestDeclaration",
        name: n.value,
        body,
        span: this.end(k, close),
      };
    }
    if (k.value === "app") {
      const n = this.expect("word");
      const metadata: { description?: string; canonical?: string } = {};
      const metadataSpans: { description?: Token["span"]; canonical?: Token["span"] } = {};
      let end = n;
      if (this.t().kind === "{") {
        this.take();
        while (this.t().kind !== "}") {
          if (this.t().kind === "eof") this.expect("}");
          const property = this.expect("word");
          if (property.value !== "description" && property.value !== "canonical")
            throw new PipeParseError(
              "PIPE-SYN-003",
              `Unknown app metadata field "${property.value}"`,
              property,
              { expected: "description or canonical", received: property.value },
            );
          if (Object.prototype.hasOwnProperty.call(metadata, property.value))
            throw new PipeParseError(
              "PIPE-SYN-003",
              `Duplicate app metadata field "${property.value}"`,
              property,
              { received: property.value },
            );
          const value = this.expect("string");
          metadata[property.value] = value.value;
          metadataSpans[property.value] = value.span;
          if (this.t().kind === ",") this.take();
          end = this.ts[this.i - 1]!;
        }
        end = this.expect("}");
      }
      return {
        kind: "AppDeclaration",
        name: n.value,
        ...(Object.keys(metadata).length ? { metadata } : {}),
        ...(Object.keys(metadataSpans).length ? { metadataSpans } : {}),
        span: this.end(k, end),
      };
    }
    if (k.value === "model") return this.model(k, "ModelDeclaration");
    if (k.value === "index") return this.indexDeclaration(k);
    if (k.value === "type") return this.model(k, "RecordDeclaration");
    if (k.value === "enum") return this.enumDeclaration(k);
    if (k.value === "page") return this.page(k);
    if (k.value === "component") return this.component(k);
    if (k.value === "api") return this.api(k);
    if (k.value === "http") return this.http(k);
    if (k.value === "function") return this.functionDeclaration(k);
    if (k.value === "interface") return this.interfaceDeclaration(k);
    if (k.value === "impl") return this.implDeclaration(k);
    if (k.value === "style") {
      let token = false;
      let name: string | undefined;
      let properties: any[] | undefined;
      let states: any[] | undefined;
      let responsive: "stacked" | "fluid" | undefined;
      let layout: "row" | "column" | "grid" | undefined;
      let alignment: "start" | "center" | "end" | "stretch" | undefined;
      let typography: "readable" | "compact" | undefined;
      let fontWeight: "normal" | "bold" | undefined;
      let fontSize: number | undefined;
      let lineHeight: number | undefined;
      let spacing: "comfortable" | "compact" | undefined;
      let theme: "light" | "dark" | "calm" | "contrast" | undefined;
      let color: "blue" | "muted" | "red" | "green" | undefined;
      let border: "subtle" | "strong" | "red" | "green" | undefined;
      let shadow: "soft" | "strong" | undefined;
      let corners: "rounded" | "pill" | undefined;
      let radius: number | undefined;
      let disabled: "guarded" | undefined;
      let focus: "ringed" | undefined;
      let surface: "elevated" | undefined;
      let text: "muted" | undefined;
      let textColor: "white" | "black" | "inherit" | undefined;
      let transitionDuration: number | undefined;
      let transitionProperty: "all" | "background" | "color" | "transform" | "opacity" | undefined;
      let transitionEasing: "ease" | "linear" | undefined;
      let composes: string[] | undefined;
      let padding: number | undefined;
      let gap: number | undefined;
      let margin: number | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let opacity: number | undefined;
      let columns: number | undefined;
      let responsiveColumns: number | undefined;
      let responsiveGap: number | undefined;
      let responsivePadding: number | undefined;
      let responsiveMargin: number | undefined;
      let responsiveFontSize: number | undefined;
      let responsiveLineHeight: number | undefined;
      let responsiveLayout: "row" | "column" | "grid" | undefined;
      if (this.t().kind === "word" && (this.t().value === "named" || this.t().value === "token")) {
        token = this.t().value === "token";
        this.take();
        name = this.expect("word").value;
        if (this.t().kind === "{") {
          const block = this.styleBlock();
          properties = block.properties;
          states = block.states;
          responsive = block.responsive;
          layout = block.layout;
          alignment = block.alignment;
          typography = block.typography;
          fontWeight = block.fontWeight;
          fontSize = block.fontSize;
          lineHeight = block.lineHeight;
          spacing = block.spacing;
          theme = block.theme;
          color = block.color;
          border = block.border;
          shadow = block.shadow;
          corners = block.corners;
          radius = block.radius;
          disabled = block.disabled;
          focus = block.focus;
          surface = block.surface;
          text = block.text;
          textColor = block.textColor;
          transitionDuration = block.transitionDuration;
          transitionProperty = block.transitionProperty;
          transitionEasing = block.transitionEasing;
          composes = block.composes;
          padding = block.padding;
          gap = block.gap;
          margin = block.margin;
          width = block.width;
          height = block.height;
          opacity = block.opacity;
          columns = block.columns;
          responsiveColumns = block.responsiveColumns;
          responsiveGap = block.responsiveGap;
          responsivePadding = block.responsivePadding;
          responsiveMargin = block.responsiveMargin;
          responsiveFontSize = block.responsiveFontSize;
          responsiveLineHeight = block.responsiveLineHeight;
          responsiveLayout = block.responsiveLayout;
        } else if (this.t().kind === "word" && this.t().value === "uses") {
          this.take();
        } else if (this.t().kind === "word" && ["padding", "gap", "margin", "width", "height", "columns"].includes(this.t().value)) {
          const property = this.take();
          this.expect("word", "is");
          const negative = this.t().kind === "operator" && this.t().value === "-";
          if (negative) this.take();
          const value = this.expect("number");
          const numeric = Number(`${negative ? "-" : ""}${value.value}`);
          if (!Number.isFinite(numeric) || numeric < 0 || (property.value === "columns" && (!Number.isInteger(numeric) || numeric < 1)))
            throw new PipeParseError("PIPE-STYLE-020", `Unsupported ${property.value} value "${value.value}"`, value);
          if (property.value === "padding") padding = numeric;
          else if (property.value === "gap") gap = numeric;
          else if (property.value === "margin") margin = numeric;
          else if (property.value === "width") width = numeric;
          else if (property.value === "height") height = numeric;
          else columns = numeric;
        } else if (this.t().kind === "word" && this.t().value === "opacity") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("number");
          this.expect("word", "percent");
          const numeric = Number(value.value);
          if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100)
            throw new PipeParseError("PIPE-STYLE-028", `Unsupported opacity value "${value.value} percent"`, value);
          opacity = numeric / 100;
        } else if (this.t().kind === "word" && this.t().value === "background") {
          const property = this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "blue" && value.value !== "neutral" && value.value !== "red" && value.value !== "green")
            throw new PipeParseError("PIPE-STYLE-003", `Unsupported background value "${value.value}"`, value, { kind: "style_background", expected: "blue, neutral, red, or green", received: value.value });
          properties = [{ kind: "StyleProperty", name: property.value, value: value.value, span: this.end(property, value) }];
        } else if (this.t().kind === "word" && this.t().value === "state") {
          this.take();
          const state = this.expect("word");
          if (state.value !== "hovered" && state.value !== "focused" && state.value !== "active" && state.value !== "disabled")
            throw new PipeParseError("PIPE-STYLE-004", `Unsupported style state "${state.value}"`, state);
          const property = this.expect("word");
          let propertyName: "background" | "textColor" = "background";
          if (property.value === "text") {
            this.expect("word", "color");
            propertyName = "textColor";
          } else if (property.value !== "background") {
            throw new PipeParseError("PIPE-STYLE-027", `Unknown style state property "${property.value}"`, property);
          }
          this.expect("word", "is");
          const value = this.expect("word");
          if (propertyName === "textColor") {
            if (value.value !== "white" && value.value !== "black" && value.value !== "inherit")
              throw new PipeParseError("PIPE-STYLE-029", `Unsupported text color value "${value.value}"`, value);
          } else if (value.value !== "blue" && value.value !== "neutral" && value.value !== "red" && value.value !== "green")
            throw new PipeParseError("PIPE-STYLE-003", `Unsupported background value "${value.value}"`, value, { kind: "style_background", expected: "blue, neutral, red, or green", received: value.value });
          states = [{ kind: "StyleState", state: state.value, properties: [{ kind: "StyleProperty", name: propertyName, value: value.value, span: this.end(property, value) }], span: this.end(state, value) }];
        } else if (this.t().kind === "word" && this.t().value === "responsive") {
          const responsiveKeyword = this.take();
          if (this.t().kind === "word" && this.t().value === "layout") {
            this.take();
            this.expect("word", "is");
            const value = this.expect("word");
            if (value.value !== "row" && value.value !== "column" && value.value !== "grid")
              throw new PipeParseError("PIPE-STYLE-006", `Unsupported responsive layout value "${value.value}"`, value);
            responsiveLayout = value.value;
          } else if (this.t().kind === "word" && this.t().value === "columns") {
            this.take();
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isInteger(numeric) || numeric < 1)
              throw new PipeParseError("PIPE-STYLE-020", `Unsupported responsive columns value "${value.value}"`, value);
            responsiveColumns = numeric;
          } else if (this.t().kind === "word" && this.t().value === "gap") {
            this.take();
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0)
              throw new PipeParseError("PIPE-STYLE-020", `Unsupported responsive gap value "${value.value}"`, value);
            responsiveGap = numeric;
          } else if (this.t().kind === "word" && this.t().value === "padding") {
            this.take();
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0)
              throw new PipeParseError("PIPE-STYLE-020", `Unsupported responsive padding value "${value.value}"`, value);
            responsivePadding = numeric;
          } else if (this.t().kind === "word" && this.t().value === "margin") {
            this.take();
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0)
              throw new PipeParseError("PIPE-STYLE-020", `Unsupported responsive margin value "${value.value}"`, value);
            responsiveMargin = numeric;
          } else if (this.t().kind === "word" && this.t().value === "font") {
            this.take();
            this.expect("word", "size");
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0)
              throw new PipeParseError("PIPE-STYLE-023", `Unsupported responsive font size value "${value.value}"`, value);
            responsiveFontSize = numeric;
          } else if (this.t().kind === "word" && this.t().value === "line") {
            this.take();
            this.expect("word", "height");
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0)
              throw new PipeParseError("PIPE-STYLE-022", `Unsupported responsive line height value "${value.value}"`, value);
            responsiveLineHeight = numeric;
          } else {
            this.expect("word", "is");
            const value = this.expect("word");
            if (value.value !== "stacked" && value.value !== "fluid")
              throw new PipeParseError("PIPE-STYLE-005", `Unsupported responsive style value "${value.value}"`, value);
            properties = undefined;
            states = undefined;
            responsive = value.value;
          }
        } else if (this.t().kind === "word" && this.t().value === "layout") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "row" && value.value !== "column" && value.value !== "grid")
            throw new PipeParseError("PIPE-STYLE-006", `Unsupported layout style value "${value.value}"`, value);
          layout = value.value;
        } else if (this.t().kind === "word" && this.t().value === "alignment") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "start" && value.value !== "center" && value.value !== "end" && value.value !== "stretch")
            throw new PipeParseError("PIPE-STYLE-024", `Unsupported alignment style value "${value.value}"`, value);
          alignment = value.value;
        } else if (this.t().kind === "word" && this.t().value === "typography") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "readable" && value.value !== "compact")
            throw new PipeParseError("PIPE-STYLE-007", `Unsupported typography style value "${value.value}"`, value);
          typography = value.value;
        } else if (this.t().kind === "word" && this.t().value === "spacing") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "comfortable" && value.value !== "compact")
            throw new PipeParseError("PIPE-STYLE-008", `Unsupported spacing style value "${value.value}"`, value);
          spacing = value.value;
        } else if (this.t().kind === "word" && this.t().value === "font") {
          this.take();
          const property = this.expect("word");
          if (property.value === "size") {
            this.expect("word", "is");
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric <= 0)
              throw new PipeParseError("PIPE-STYLE-023", `Unsupported font size value "${value.value}"`, value);
            fontSize = numeric;
          } else if (property.value === "weight") {
            this.expect("word", "is");
            const value = this.expect("word");
            if (value.value !== "normal" && value.value !== "bold")
              throw new PipeParseError("PIPE-STYLE-021", `Unsupported font weight value "${value.value}"`, value);
            fontWeight = value.value;
          } else {
            throw new PipeParseError("PIPE-STYLE-021", `Unsupported font property "${property.value}"`, property);
          }
        } else if (this.t().kind === "word" && this.t().value === "line") {
          const property = this.take();
          this.expect("word", "height");
          this.expect("word", "is");
          const value = this.expect("number");
          const numeric = Number(value.value);
          if (!Number.isFinite(numeric) || numeric <= 0)
            throw new PipeParseError("PIPE-STYLE-022", `Unsupported line height value "${value.value}"`, value);
          lineHeight = numeric;
        } else if (this.t().kind === "word" && this.t().value === "transition") {
          this.take();
          const property = this.expect("word");
          this.expect("word", "is");
          if (property.value === "duration") {
            const value = this.expect("number");
            const numeric = Number(value.value);
            if (!Number.isFinite(numeric) || numeric < 0) throw new PipeParseError("PIPE-STYLE-031", `Unsupported transition duration value "${value.value}"`, value);
            transitionDuration = numeric;
          } else if (property.value === "property") {
            const value = this.expect("word");
            if (!["all", "background", "color", "transform", "opacity"].includes(value.value)) throw new PipeParseError("PIPE-STYLE-032", `Unsupported transition property "${value.value}"`, value);
            transitionProperty = value.value as typeof transitionProperty;
          } else if (property.value === "easing") {
            const value = this.expect("word");
            if (value.value !== "ease" && value.value !== "linear") throw new PipeParseError("PIPE-STYLE-033", `Unsupported transition easing "${value.value}"`, value);
            transitionEasing = value.value;
          } else throw new PipeParseError("PIPE-STYLE-031", `Unsupported transition property "${property.value}"`, property);
        } else if (this.t().kind === "word" && this.t().value === "theme") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "light" && value.value !== "dark" && value.value !== "calm" && value.value !== "contrast")
            throw new PipeParseError("PIPE-STYLE-009", `Unsupported theme style value "${value.value}"`, value);
          theme = value.value;
        } else if (this.t().kind === "word" && this.t().value === "color") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "blue" && value.value !== "muted" && value.value !== "red" && value.value !== "green")
            throw new PipeParseError("PIPE-STYLE-010", `Unsupported color style value "${value.value}"`, value);
          color = value.value;
        } else if (this.t().kind === "word" && this.t().value === "border") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "subtle" && value.value !== "strong" && value.value !== "red" && value.value !== "green")
            throw new PipeParseError("PIPE-STYLE-011", `Unsupported border style value "${value.value}"`, value);
          border = value.value;
        } else if (this.t().kind === "word" && this.t().value === "shadow") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "soft" && value.value !== "strong")
            throw new PipeParseError("PIPE-STYLE-012", `Unsupported shadow style value "${value.value}"`, value);
          shadow = value.value;
        } else if (this.t().kind === "word" && this.t().value === "radius") {
          this.take();
          this.expect("word", "is");
          const negative = this.t().kind === "operator" && this.t().value === "-";
          if (negative) this.take();
          const radiusValue = this.expect("number");
          const radiusNumber = Number(`${negative ? "-" : ""}${radiusValue.value}`);
          if (!Number.isFinite(radiusNumber) || radiusNumber < 0) throw new PipeParseError("PIPE-STYLE-030", `Unsupported radius value "${radiusValue.value}"`, radiusValue);
          radius = radiusNumber;
        } else if (this.t().kind === "word" && this.t().value === "corners") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "rounded" && value.value !== "pill")
            throw new PipeParseError("PIPE-STYLE-013", `Unsupported corner style value "${value.value}"`, value);
          corners = value.value;
        } else if (this.t().kind === "word" && this.t().value === "disabled") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "guarded")
            throw new PipeParseError("PIPE-STYLE-014", `Unsupported disabled style value "${value.value}"`, value);
          disabled = "guarded";
        } else if (this.t().kind === "word" && this.t().value === "focus") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "ringed")
            throw new PipeParseError("PIPE-STYLE-015", `Unsupported focus style value "${value.value}"`, value);
          focus = "ringed";
        } else if (this.t().kind === "word" && this.t().value === "surface") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "elevated")
            throw new PipeParseError("PIPE-STYLE-016", `Unsupported surface style value "${value.value}"`, value);
          surface = "elevated";
        } else if (this.t().kind === "word" && this.t().value === "text" && this.ts[this.i + 1]?.kind === "word" && this.ts[this.i + 1]?.value === "color") {
          this.take();
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "white" && value.value !== "black" && value.value !== "inherit")
            throw new PipeParseError("PIPE-STYLE-029", `Unsupported text color value "${value.value}"`, value);
          textColor = value.value;
        } else if (this.t().kind === "word" && this.t().value === "text") {
          this.take();
          this.expect("word", "is");
          const value = this.expect("word");
          if (value.value !== "muted")
            throw new PipeParseError("PIPE-STYLE-017", `Unsupported text style value "${value.value}"`, value);
          text = "muted";
        }
      }
      while (this.t().kind === "word" && (this.t().value === "layout" || this.t().value === "alignment")) {
        const modifier = this.take();
        this.expect("word", "is");
        const value = this.expect("word");
        if (modifier.value === "layout") {
          if (layout !== undefined) throw new PipeParseError("PIPE-STYLE-025", "Duplicate layout style modifier", modifier);
          if (value.value !== "row" && value.value !== "column" && value.value !== "grid")
            throw new PipeParseError("PIPE-STYLE-006", `Unsupported layout style value "${value.value}"`, value);
          layout = value.value;
        } else {
          if (alignment !== undefined) throw new PipeParseError("PIPE-STYLE-026", "Duplicate alignment style modifier", modifier);
          if (value.value !== "start" && value.value !== "center" && value.value !== "end" && value.value !== "stretch")
            throw new PipeParseError("PIPE-STYLE-024", `Unsupported alignment style value "${value.value}"`, value);
          alignment = value.value;
        }
      }
      const declarationKeywords = new Set([
        "app", "model", "type", "enum", "page", "component", "style",
        "api", "http", "function", "interface", "impl", "test", "import",
      ]);
      if (this.t().kind === "word" && this.t().value === "composes") {
        this.take();
        composes = [];
        do {
          composes.push(this.expect("word").value);
          if (this.t().kind === ",") this.take();
          else break;
        } while (this.t().kind === "word" && !declarationKeywords.has(this.t().value));
      }
      const vals: string[] = [];
      while ((this.t().kind === "word" && !declarationKeywords.has(this.t().value)) || this.t().kind === "string")
        vals.push(this.take().value);
       if (!vals.length && !composes?.length && padding === undefined && gap === undefined && margin === undefined && width === undefined && height === undefined && columns === undefined && responsiveColumns === undefined && responsiveGap === undefined && responsivePadding === undefined && responsiveMargin === undefined && responsiveFontSize === undefined && responsiveLineHeight === undefined && responsiveLayout === undefined && fontSize === undefined && lineHeight === undefined && !properties?.length && !states?.length && !responsive && !layout && !alignment && !typography && !fontWeight && !spacing && !theme && !color && !border && !shadow && !corners && radius === undefined && !disabled && !focus && !surface && !text && !textColor && transitionDuration === undefined && transitionProperty === undefined && transitionEasing === undefined)
        throw new PipeParseError(
          "PIPE-SYN-004",
          "Style needs at least one value",
          this.t(),
        );
      const last = this.ts[this.i - 1];
      return {
        kind: "StyleDeclaration",
        token,
        name,
        values: vals,
        composes,
        padding,
        gap,
        margin,
        width,
        height,
        opacity,
        columns,
        responsiveColumns,
        responsiveGap,
        responsivePadding,
        responsiveMargin,
        responsiveFontSize,
        responsiveLineHeight,
        responsiveLayout,
        properties,
        states,
        responsive,
        layout,
        alignment,
        typography,
        fontWeight,
        fontSize,
        lineHeight,
        spacing,
        theme,
        color,
        border,
        shadow,
        corners,
        radius,
        disabled,
        focus,
        surface,
        text,
        textColor,
        transitionDuration,
        transitionProperty,
        transitionEasing,
        span: this.end(k, last),
      };
    }
    throw new PipeParseError(
      "PIPE-SYN-005",
      `Unknown declaration ${k.value}`,
      k,
    );
  }
  enumDeclaration(k: Token) {
    const n = this.expect("word");
    const typeParameters: string[] = [];
    if (this.t().kind === "operator" && this.t().value === "<") {
      this.take();
      while (!(this.t().kind === "operator" && this.t().value === ">")) {
        typeParameters.push(this.expect("word").value);
        if (this.t().kind === ",") this.take();
      }
      this.take();
    }
    this.expect("{");
    const variants: any[] = [];
    while (this.t().kind !== "}") {
      const v = this.expect("word");
      let payload: string | undefined;
      if (this.t().kind === "(") {
        this.take();
        payload = this.typeRef();
        this.expect(")");
      }
      variants.push({
        kind: "EnumVariant",
        name: v.value,
        payload,
        span: this.end(v, this.ts[this.i - 1]),
      });
      if (this.t().kind === ",") this.take();
    }
    const close = this.expect("}");
    if (!variants.length)
      throw new PipeParseError(
        "PIPE-SYN-009",
        "Enum needs at least one variant",
        n,
      );
    return {
      kind: "EnumDeclaration",
      name: n.value,
      typeParameters,
      variants,
      span: this.end(k, close),
    };
  }
  interfaceDeclaration(k: Token) {
    const n = this.expect("word");
    this.expect("{");
    const methods: any[] = [];
    while (this.t().kind !== "}") {
      const name = this.expect("word");
      this.expect("(");
      const parameters: any[] = [];
      while (this.t().kind !== ")") {
        const pn = this.expect("word");
        const pt = pn.value === "self" ? "text" : this.typeRef();
        parameters.push({
          kind: "Parameter",
          name: pn.value,
          type: pt,
          span: this.end(pn, this.ts[this.i - 1]),
        });
        if (this.t().kind === ",") this.take();
      }
      this.expect(")");
      this.expect("operator", "->");
      const ret = this.typeRef();
      methods.push({
        kind: "InterfaceMethod",
        name: name.value,
        parameters,
        returnType: ret,
        span: this.end(name, this.ts[this.i - 1]),
      });
    }
    const close = this.expect("}");
    return {
      kind: "InterfaceDeclaration",
      name: n.value,
      methods,
      span: this.end(k, close),
    };
  }
  implDeclaration(k: Token) {
    const iface = this.expect("word");
    this.expect("word", "for");
    const type = this.expect("word");
    this.expect("{");
    const methods: any[] = [];
    while (this.t().kind !== "}") {
      const fk = this.expect("word", "function");
      methods.push(this.functionDeclaration(fk));
    }
    const close = this.expect("}");
    return {
      kind: "ImplDeclaration",
      interfaceName: iface.value,
      typeName: type.value,
      methods,
      span: this.end(k, close),
    };
  }
  api(k: Token) {
    this.expect("operator", "/");
    const route = this.expect("word");
    const from = this.expect("word", "from");
    const model = this.expect("word");
    let policyId: string | undefined;
    if (this.t().kind === "word" && this.t().value === "requiring") {
      this.take();
      const requirement = this.expect("word");
      if (requirement.value === "authenticated") policyId = "authenticated";
      else if (requirement.value === "role") {
        const role = this.expect("word");
        policyId = `role:${role.value}`;
      } else if (requirement.value === "attribute") {
        const attribute = this.expect("word");
        policyId = `attribute:${attribute.value}`;
      } else {
        throw new PipeParseError(
          "PIPE-SYN-005",
          `Unknown API authorization requirement ${requirement.value}`,
          requirement,
        );
      }
    }
    return {
      kind: "ApiDeclaration",
      route: `/${route.value}`,
      model: model.value,
      ...(policyId ? { policyId } : {}),
      span: this.end(k, this.ts[this.i - 1] ?? model),
    };
  }
  http(k: Token) {
    const method = this.expect("word");
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method.value))
      throw new PipeParseError(
        "PIPE-SYN-005",
        `Unknown HTTP method ${method.value}`,
        method,
        { kind: "invalid_route_method", expected: "GET, POST, PUT, PATCH, or DELETE", received: method.value },
      );
    this.expect("operator", "/");
    let path = "/";
    while (
      !(this.t().kind === "operator" && this.t().value === "->") &&
      !(this.t().kind === "word" && (this.t().value === "headers" || this.t().value === "requires" || this.t().value === "returns"))
    ) {
      const token = this.take();
      if (
        token.kind !== "word" &&
        token.kind !== ":" &&
        !(
          token.kind === "operator" &&
          (token.value === "-" || token.value === "/")
        )
      )
        throw new PipeParseError(
          "PIPE-SYN-003",
          "Expected an HTTP path before ->",
          token,
        );
      path += token.value;
    }
    const headers: string[] = [];
    if (this.t().kind === "word" && this.t().value === "headers") {
      this.take();
      while (!(this.t().kind === "operator" && this.t().value === "->") && !(this.t().kind === "word" && (this.t().value === "requires" || this.t().value === "returns"))) {
        headers.push(this.expect("word").value);
        if (this.t().kind === ",") this.take();
      }
    }
    let status: number | undefined;
    const errorStatuses: number[] = [];
    if (this.t().kind === "word" && this.t().value === "returns") {
      this.take();
      const value = this.expect("number");
      status = Number(value.value);
      if (!Number.isInteger(status) || status < 100 || status > 599)
        throw new PipeParseError("PIPE-SYN-005", "HTTP status must be an integer from 100 through 599", value);
      if (this.t().kind === "word" && this.t().value === "errors") {
        this.take();
        while (!(this.t().kind === "operator" && this.t().value === "->") && !(this.t().kind === "word" && this.t().value === "requires")) {
          const error = this.expect("number");
          const code = Number(error.value);
          if (!Number.isInteger(code) || code < 400 || code > 599 || code === status)
            throw new PipeParseError("PIPE-SYN-005", "HTTP error status must be a distinct integer from 400 through 599", error);
          errorStatuses.push(code);
          if (this.t().kind === ",") this.take();
        }
      }
    }
    const capabilities: string[] = [];
    let policyId: string | undefined;
    if (this.t().kind === "word" && this.t().value === "requires") {
      this.take();
      while (!(this.t().kind === "operator" && this.t().value === "->")) {
        const capability = this.expect("word");
        if (capability.value === "authenticated") {
          policyId = "authenticated";
        } else if (capability.value === "role") {
          const role = this.expect("word");
          policyId = `role:${role.value}`;
        } else if (capability.value === "attribute") {
          const attribute = this.expect("word");
          policyId = `attribute:${attribute.value}`;
        } else {
          if (
            ![
              "http",
              "database",
              "environment",
              "time",
              "random",
              "secureRandom",
              "filesystem",
              "email",
            ].includes(capability.value)
          )
            throw new PipeParseError(
              "PIPE-SYN-005",
              `Unknown HTTP capability ${capability.value}`,
              capability,
            );
          capabilities.push(capability.value);
        }
        if (this.t().kind === ",") this.take();
      }
    }
    this.take();
    const handler = this.expect("word");
    return {
      kind: "HttpDeclaration",
      method: method.value,
      path,
      handler: handler.value,
      ...(headers.length ? {headers} : {}),
      ...(status === undefined ? {} : {status}),
      ...(errorStatuses.length ? {errorStatuses} : {}),
      capabilities: capabilities.length ? capabilities : undefined,
      policyId,
      span: this.end(k, handler),
    };
  }
  model(
    k: Token,
    kind: "ModelDeclaration" | "RecordDeclaration" = "ModelDeclaration",
  ) {
    const n = this.expect("word");
    const typeParameters: string[] = [];
    if (this.t().kind === "operator" && this.t().value === "<") {
      this.take();
      while (!(this.t().kind === "operator" && this.t().value === ">")) {
        typeParameters.push(this.expect("word").value);
        if (this.t().kind === ",") this.take();
      }
      this.take();
    }
    this.expect("{");
    const fields: FieldDeclaration[] = [];
    while (this.t().kind !== "}") {
      if (this.t().kind === "eof") this.expect("}");
      const f = this.take();
      if (f.kind !== "word")
        throw new PipeParseError("PIPE-SYN-006", "Expected field name", f);
      const ty = this.typeRef();
      const modifiers: Modifier[] = [];
      while (
        this.t().kind === "word" ||
        this.t().kind === "string" ||
        this.t().kind === "number" ||
        (this.t().kind === "operator" && this.t().value === "-")
      ) {
        const m = this.take();
        if (m.value === "required" || m.value === "unique")
          modifiers.push({ kind: m.value });
        else if (m.value === "default") {
          let v = this.take();
          let negative = false;
          if (v.kind === "operator" && v.value === "-") {
            negative = true;
            v = this.take();
          }
          if (!["word", "string", "number"].includes(v.kind))
            throw new PipeParseError(
              "PIPE-SYN-007",
              "Expected default value",
              v,
            );
          const value =
            v.kind === "number"
              ? (negative ? -1 : 1) * Number(v.value)
              : v.kind === "word"
                ? v.value === "true"
                  ? true
                  : v.value === "false"
                    ? false
                    : v.value
                : v.value;
          modifiers.push({ kind: "default", value });
        } else {
          this.i--;
          break;
        }
      }
      fields.push({
        kind: "FieldDeclaration",
        name: f.value,
        type: ty,
        modifiers,
        span: this.end(f, this.ts[this.i - 1]),
      });
    }
    const close = this.expect("}");
    return {
      kind,
      name: n.value,
      typeParameters,
      fields,
      span: this.end(k, close),
    };
  }
  indexDeclaration(k:Token):IndexDeclaration {
    const name=this.expect("word");
    this.expect("word","on");
    const model=this.expect("word");
    this.expect("word","by");
    const fields=[this.expect("word").value];
    while(this.t().kind===","){this.take();fields.push(this.expect("word").value)}
    return {kind:"IndexDeclaration",name:name.value,model:model.value,fields,span:this.end(k,this.ts[this.i-1]!)};
  }
  page(k: Token) {
    const n = this.expect("word");
    let route: string | undefined;
    if (this.t().kind === "word" && this.t().value === "at") { this.take(); route = this.expect("string").value; }
    this.expect("{");
    const statements: any[] = [];
    while (this.t().kind !== "}") {
      if (this.t().kind === "eof") this.expect("}");
      const c = this.expect("word");
      if (c.value === "crud") {
        const m = this.expect("word");
        const excludedFields: string[] = [];
        if (this.t().kind === "word" && this.t().value === "excluding") {
          this.take();
          excludedFields.push(this.expect("word").value);
          while (this.t().kind === ",") {
            this.take();
            excludedFields.push(this.expect("word").value);
          }
        }
        statements.push({
          kind: "CrudStatement",
          model: m.value,
          ...(excludedFields.length ? { excludedFields } : {}),
          span: this.end(c, m),
        });
        continue;
      }
      if (c.value === "link") {
        const label = this.expect("string");
        this.expect("word", "to");
        const target = this.expect("word");
        const parameters: { name: string; path: string }[] = [];
        let end = target;
        if (this.t().kind === "word" && this.t().value === "with") {
          this.take();
          do {
            const name = this.expect("word");
            const path = this.expect("word");
            this.expect(".");
            const field = this.expect("word");
            parameters.push({ name: name.value, path: `${path.value}.${field.value}` });
            end = field;
            if (this.t().kind !== ",") break;
            this.take();
          } while (true);
        }
        statements.push({ kind: "PageLinkDeclaration", label: label.value, target: target.value, ...(parameters.length ? { parameters } : {}), span: this.end(c, end) });
        continue;
      }
      if (c.value === "dialog") {
        const label = this.expect("string");
        this.expect("word", "title");
        const title = this.expect("string");
        this.expect("word", "message");
        const message = this.expect("string");
        statements.push({ kind: "PageDialogDeclaration", label: label.value, title: title.value, message: message.value, span: this.end(c, message) });
        continue;
      }
      if (c.value === "for") {
        const item = this.expect("word");
        this.expect("word", "in");
        const source = this.expect("word");
        this.expect("word", "show");
        const component = this.expect("word");
        let bindingPath: string | undefined;
        let end = component;
        if (component.value === item.value && this.t().kind === "word" && this.t().value !== "empty") {
          const field = this.take();
          bindingPath = `${component.value}.${field.value}`;
          end = field;
        }
        let empty: string | undefined, filterBy: string | undefined, filterLabel: string | undefined, pageSize: number | undefined;
        while (this.t().kind === "word" && (this.t().value === "empty" || this.t().value === "filter" || this.t().value === "paginate")) {
          if (this.t().value === "empty") { this.take(); const value = this.expect("string"); empty = value.value; end = value; }
          else if (this.t().value === "filter") { this.take(); const by = this.expect("word"); if (by.value !== "by") throw new PipeParseError("PIPE-SYN-007", "Expected 'by' after filter", by); const field = this.expect("word"); filterBy = field.value; end = field; if (this.t().value === "label") { this.take(); const value = this.expect("string"); filterLabel = value.value; end = value; } }
          else { this.take(); const size = this.expect("number"); pageSize = Number(size.value); end = size; }
        }
        statements.push({
          kind: "PageListDeclaration",
          name: source.value,
          source: source.value,
          item: item.value,
          component: component.value,
          bindingPath,
          empty,
          filterBy,
          filterLabel,
          pageSize,
          span: this.end(c, end),
        });
        continue;
      }
      if (c.value === "state") {
        const name = this.expect("word");
        const type = this.typeRef();
        let initial: any = undefined;
        if (this.t().kind === "operator" && this.t().value === "=") {
          this.take();
          if (this.t().kind === "[") {
            const open = this.take();
            const close = this.expect("]");
            if (!type.startsWith("list<")) throw new PipeParseError("PIPE-SYN-007", "An empty list initial value requires a list state type", open);
            initial = [];
          } else {
          const value = this.take();
          if (value.kind === "number") initial = Number(value.value);
          else if (value.kind === "string") initial = value.value;
          else if (
            value.kind === "word" &&
            (value.value === "true" || value.value === "false")
          )
            initial = value.value === "true";
          else
            throw new PipeParseError(
              "PIPE-SYN-007",
              "Expected state initial value",
              value,
            );
          }
        }
        let persisted: "local" | undefined;
        if (this.t().kind === "word" && this.t().value === "persisted") {
          this.take();
          this.expect("word", "in");
          this.expect("word", "local");
          this.expect("word", "storage");
          persisted = "local";
        }
        let source: { method: "GET"; path: string; next?: { method: "GET"; path: string; parameter: string; cursorField: string }; search?: { method: "GET"; path: string; parameter: string; next?: { method: "GET"; path: string; parameter: string; cursorField: string } } } | undefined;
        if (this.t().kind === "word" && this.t().value === "from") {
          this.take();
          this.expect("word", "GET");
          const path = this.expect("string");
          source = { method: "GET", path: path.value };
          if (this.t().kind === "word" && this.t().value === "next") {
            this.take();
            this.expect("word", "GET");
            const nextPath = this.expect("string");
            this.expect("word", "cursor");
            this.expect("word", "by");
            const cursorField = this.expect("word");
            const parameters = [...nextPath.value.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
            const sourceParameters = [...source.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
            const cursorParameters = parameters.filter(parameter => !sourceParameters.includes(parameter));
            source.next = { method: "GET", path: nextPath.value, parameter: cursorParameters.length === 1 ? cursorParameters[0]! : "", cursorField: cursorField.value };
          }
          if (this.t().kind === "word" && this.t().value === "search") {
            this.take();
            this.expect("word", "GET");
            const searchPath = this.expect("string");
            const parameters = [...searchPath.value.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
            const sourceParameters = [...source.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
            const searchParameters = parameters.filter(parameter => !sourceParameters.includes(parameter));
            source.search = { method: "GET", path: searchPath.value, parameter: searchParameters.length === 1 ? searchParameters[0]! : "" };
            if (this.t().kind === "word" && this.t().value === "next") {
              this.take();
              this.expect("word", "GET");
              const nextPath = this.expect("string");
              this.expect("word", "cursor");
              this.expect("word", "by");
              const cursorField = this.expect("word");
              const nextParameters = [...nextPath.value.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]!);
              const searchParameter = source.search.parameter;
              const cursorParameters = nextParameters.filter(parameter => parameter !== searchParameter && !sourceParameters.includes(parameter));
              source.search.next = { method: "GET", path: nextPath.value, parameter: cursorParameters.length === 1 ? cursorParameters[0]! : "", cursorField: cursorField.value };
            }
          }
        }
        statements.push({
          kind: "PageStateDeclaration",
          name: name.value,
          type,
          initial,
          ...(persisted ? { persisted } : {}),
          source,
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      if (c.value === "loading" || c.value === "error") {
        const value = this.expect("string");
        statements.push({
          kind: "PageFeedbackDeclaration",
          name: c.value,
          value: value.value,
          span: this.end(c, value),
        });
        continue;
      }
      if (c.value === "list") {
        const source = this.expect("word");
        const item = this.expect("word");
        const component = this.expect("word");
        let empty: string | undefined, filterBy: string | undefined, filterLabel: string | undefined, pageSize: number | undefined;
        let end = component;
        while (this.t().kind === "word" && (this.t().value === "empty" || this.t().value === "filter" || this.t().value === "paginate")) {
          if (this.t().value === "empty") { this.take(); const value = this.expect("string"); empty = value.value; end = value; }
          else if (this.t().value === "filter") { this.take(); const by = this.expect("word"); if (by.value !== "by") throw new PipeParseError("PIPE-SYN-007", "Expected 'by' after filter", by); const field = this.expect("word"); filterBy = field.value; end = field; if (this.t().value === "label") { this.take(); const value = this.expect("string"); filterLabel = value.value; end = value; } }
          else { this.take(); const size = this.expect("number"); pageSize = Number(size.value); end = size; }
        }
        statements.push({
          kind: "PageListDeclaration",
          name: source.value,
          source: source.value,
          item: item.value,
          component: component.value,
          empty,
          filterBy,
          filterLabel,
          pageSize,
          span: this.end(c, end),
        });
        continue;
      }
      if (c.value === "event") {
        const name = this.expect("word");
        this.expect("(");
        const parameters: any[] = [];
        while (this.t().kind !== ")") {
          const pn = this.expect("word");
          const type = this.typeRef();
          parameters.push({
            kind: "Parameter",
            name: pn.value,
            type,
            span: this.end(pn, this.ts[this.i - 1]),
          });
          if (this.t().kind === ",") this.take();
          else if (this.t().kind !== ")")
            throw new PipeParseError(
              "PIPE-SYN-003",
              "Expected comma or )",
              this.t(),
            );
        }
        const close = this.expect(")");
        let action: { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; idempotencyKey?: boolean } | undefined;
        let stateUpdate: { operation: "append" | "remove" | "increment" | "decrement"; state: string; parameter: string; field?: string; projection?: import('../ast/ast.js').RecordValueExpression } | undefined;
        let successUpdate: { operation: "clear"; state: string } | undefined;
        if (this.t().kind === "word" && this.t().value === "sends") {
          this.take();
          const method = this.expect("word");
          if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.value))
            throw new PipeParseError("PIPE-SYN-005", `UI actions cannot send ${method.value}; use POST, PUT, PATCH, or DELETE`, method);
          const path = this.expect("string");
          if (!path.value.startsWith("/") || path.value.includes("?"))
            throw new PipeParseError("PIPE-SYN-003", "UI action route must be an absolute path without a query string", path);
          let idempotencyKey=false;
          if(this.t().kind==='word'&&this.t().value==='with'){
            this.take();const idempotency=this.expect('word'),key=this.expect('word');
            if(idempotency.value!=='idempotency'||key.value!=='key')throw new PipeParseError('PIPE-SYN-003','Expected "with idempotency key" after the UI action route',idempotency);
            idempotencyKey=true;
          }
          action = { method: method.value as "POST" | "PUT" | "PATCH" | "DELETE", path: path.value, ...(idempotencyKey?{idempotencyKey:true}:{}) };
        }
        if (this.t().kind === "word" && (this.t().value === "appends" || this.t().value === "removes")) {
          const operation = this.take();
          const parameter = this.expect("word");
          let projection: import('../ast/ast.js').RecordValueExpression | undefined;
          if (operation.value === 'appends' && this.t().kind === 'word' && this.t().value === 'as') {
            this.take();
            const typeName = this.expect('word');
            const open = this.expect('{');
            const fields: import('../ast/ast.js').RecordValueExpression['fields'] = [];
            while (this.t().kind !== '}') {
              const field = this.expect('word'); this.expect(':'); const value = this.expression();
              fields.push({ name: field.value, value, span: { start: field.span.start, end: value.span.end } });
              if (this.t().kind === ',') this.take(); else if (this.t().kind !== '}') throw new PipeParseError('PIPE-SYN-003', 'Expected comma or } in append projection', this.t());
            }
            const close = this.expect('}');
            projection = { kind: 'RecordValueExpression', typeName: typeName.value, fields, span: this.end(typeName, close) };
          }
          this.expect("word", operation.value === "appends" ? "to" : "from");
          const state = this.expect("word");
          stateUpdate = { operation: operation.value === "appends" ? "append" : "remove", state: state.value, parameter: parameter.value, ...(projection ? { projection } : {}) };
        }
        if (this.t().kind === "word" && (this.t().value === "increases" || this.t().value === "decreases")) {
          const operation = this.take();
          const field = this.expect("word");
          this.expect("word", "of");
          const parameter = this.expect("word");
          this.expect("word", "in");
          const state = this.expect("word");
          stateUpdate = { operation: operation.value === "increases" ? "increment" : "decrement", state: state.value, parameter: parameter.value, field: field.value };
        }
        if (this.t().kind === "word" && this.t().value === "then") {
          this.take();
          this.expect("word", "clears");
          const state = this.expect("word");
          this.expect("word", "on");
          this.expect("word", "success");
          successUpdate = { operation: "clear", state: state.value };
        }
        const eventEnd = this.ts[this.i - 1] ?? close;
        statements.push({
          kind: "PageEventDeclaration",
          name: name.value,
          parameters,
          ...(action ? { action } : {}),
          ...(stateUpdate ? { stateUpdate } : {}),
          ...(successUpdate ? { successUpdate } : {}),
          span: this.end(c, eventEnd),
        });
        continue;
      }
      if (c.value === "input") {
        const name = this.expect("word");
        const type = this.typeRef();
        let label: string | undefined;
        let placeholder: string | undefined;
        let help: string | undefined;
        let disabled = false;
        let readOnly = false;
        let password = false;
        let validation: string | undefined;
        let event: string | undefined;
        if (this.t().kind === "word" && this.t().value === "label") {
          this.take();
          label = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "placeholder") {
          this.take();
          placeholder = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "help") {
          this.take();
          help = this.expect("string").value;
        }
        if (this.t().kind === "word" && this.t().value === "disabled") {
          this.take();
          disabled = true;
        }
        if (this.t().kind === "word" && this.t().value === "readonly") {
          this.take();
          readOnly = true;
        }
        if (this.t().kind === "word" && this.t().value === "password") {
          this.take();
          password = true;
        }
        if (this.t().kind === "word" && this.t().value === "validate") {
          this.take();
          validation = this.expect("word").value;
        }
        if (this.t().kind === "word" && this.t().value === "on") {
          this.take();
          event = this.expect("word").value;
        }
        statements.push({
          kind: "PageInputDeclaration",
          name: name.value,
          type,
          label,
          placeholder,
          help,
          disabled,
          readOnly,
          password,
          validation,
          event,
          span: this.end(c, this.ts[this.i - 1]),
        });
        continue;
      }
      if (c.value === "use") {
        if (this.t().kind === "word" && this.t().value === "style") {
          this.take();
          const style = this.expect("word");
          statements.push({
            kind: "PageUseStyleDeclaration",
            style: style.value,
            span: this.end(c, style),
          });
          continue;
        }
        const component = this.expect("word");
        statements.push({
          kind: "PageUseDeclaration",
          name: component.value,
          component: component.value,
          span: this.end(c, component),
        });
        continue;
      }
      throw new PipeParseError(
        "PIPE-SYN-003",
        c.value === "text"
          ? "Page bodies cannot contain bare text statements"
          : `Unknown page statement ${c.value}`,
        c,
        {
          received: c.value,
          expected: "a supported page member such as state, event, input, use, list, or crud",
          suggestions:
            c.value === "text"
              ? [
                  'Put visible text in a component, then attach it with `use`; for example: component Heading { text "Welcome" } and page Home { use Heading }.',
                ]
              : [
                  "Declare page structure with a supported page member such as state, event, input, use, list, or crud.",
                ],
        },
      );
    }
    const close = this.expect("}");
    return {
      kind: "PageDeclaration",
      name: n.value,
      ...(route ? { route } : {}),
      statements,
      span: this.end(k, close),
    };
  }
  functionDeclaration(k: Token) {
    const n = this.expect("word");
    const typeParameters: string[] = [];
    if (this.t().kind === "operator" && this.t().value === "<") {
      this.take();
      while (!(this.t().kind === "operator" && this.t().value === ">")) {
        typeParameters.push(this.expect("word").value);
        if (this.t().kind === ",") this.take();
        else if (!(this.t().kind === "operator" && this.t().value === ">"))
          throw new PipeParseError(
            "PIPE-SYN-003",
            "Expected comma or >",
            this.t(),
          );
      }
      this.take();
    }
    this.expect("(");
    const parameters: Parameter[] = [];
    while (this.t().kind !== ")") {
      const name = this.expect("word");
      const type = this.typeRef();
      parameters.push({
        kind: "Parameter",
        name: name.value,
        type,
        span: this.end(name, this.ts[this.i - 1]),
      });
      if (this.t().kind === ",") this.take();
      else if (this.t().kind !== ")")
        throw new PipeParseError(
          "PIPE-SYN-003",
          "Expected comma or )",
          this.t(),
        );
    }
    this.expect(")");
    this.expect("operator", "->");
    const ret = this.typeRef();
    this.expect("{");
    const body = this.statements();
    const close = this.expect("}");
    return {
      kind: "FunctionDeclaration",
      name: n.value,
      typeParameters,
      parameters,
      returnType: ret,
      body,
      span: this.end(k, close),
    };
  }
  typeRef(): string {
    if (this.t().kind === "(") {
      this.take();
      const parts: string[] = [];
      while (this.t().kind !== ")") {
        parts.push(this.typeRef());
        if (this.t().kind === ",") this.take();
        else if (this.t().kind !== ")")
          throw new PipeParseError(
            "PIPE-SYN-003",
            "Expected comma or )",
            this.t(),
          );
      }
      this.expect(")");
      this.expect("operator", "->");
      return `(${parts.join(",")}) -> ${this.typeRef()}`;
    }
    const base = this.expect("word");
    let out = base.value;
    if (base.value === "list") {
      this.expect("operator", "<");
      out = `list<${this.typeRef()}>`;
      this.expect("operator", ">");
    } else if (base.value === "result") {
      this.expect("operator", "<");
      const ok = this.typeRef();
      this.expect(",");
      const error = this.typeRef();
      out = `result<${ok},${error}>`;
      this.expect("operator", ">");
    } else if (this.t().kind === "operator" && this.t().value === "<") {
      this.take();
      const args: string[] = [];
      while (!(this.t().kind === "operator" && this.t().value === ">")) {
        args.push(this.typeRef());
        if (this.t().kind === ",") this.take();
      }
      this.take();
      out = `${base.value}<${args.join(",")}>`;
    }
    if (this.t().kind === "?") {
      this.take();
      out += "?";
    }
    return out;
  }
  private conditional(k: Token): any {
    const condition = this.expression();
    this.expect("{");
    const thenBody = this.statements();
    const thenClose = this.expect("}");
    let elseBody: Statement[] | undefined;
    let end = thenClose;
    if (this.t().kind === "word" && this.t().value === "else") {
      this.take();
      if (this.t().kind === "word" && this.t().value === "if") {
        const nested = this.take();
        elseBody = [this.conditional(nested)];
        end = this.ts[this.i - 1]!;
      } else {
        this.expect("{");
        elseBody = this.statements();
        end = this.expect("}");
      }
    }
    return { kind: "IfStatement", condition, thenBody, elseBody, span: { start: k.span.start, end: end.span.end } };
  }
  statements(): Statement[] {
    const out: Statement[] = [];
    while (this.t().kind !== "}") {
      if (this.t().kind === "eof") this.expect("}");
      const k = this.expect("word");
      if (k.value === "expect") {
        this.expect("(");
        const actual = this.expression();
        this.expect(")");
        this.expect(".");
        this.expect("word", "toEqual");
        this.expect("(");
        const expected = this.expression();
        const close = this.expect(")");
        out.push({
          kind: "ExpectStatement",
          actual,
          expected,
          span: { start: k.span.start, end: close.span.end },
        } as any);
      } else if (k.value === "let" || k.value === "var") {
        const n = this.expect("word");
        let declaredType: string | undefined;
        if (this.t().kind === "word") {
          declaredType = this.typeRef();
        }
        this.expect("operator", "=");
        const value = this.expression();
        out.push({
          kind: "LetStatement",
          name: n.value,
          declaredType,
          value,
          mutable: k.value === "var",
          span: this.end(k, { span: value.span } as Token),
        } as any);
      } else if (k.value === "return") {
        const value = this.expression();
        out.push({
          kind: "ReturnStatement",
          value,
          span: { start: k.span.start, end: value.span.end },
        });
      } else if (k.value === "if") {
        out.push(this.conditional(k));
      } else if (k.value === "for") {
        const n = this.expect("word");
        this.expect("word", "in");
        const iterable = this.expression();
        this.expect("{");
        const body = this.statements();
        const close = this.expect("}");
        out.push({
          kind: "ForStatement",
          name: n.value,
          iterable,
          body,
          span: this.end(k, close),
        });
      } else if (k.value === "while") {
        const condition = this.expression();
        this.expect("{");
        const body = this.statements();
        const close = this.expect("}");
        out.push({
          kind: "WhileStatement",
          condition,
          body,
          span: this.end(k, close),
        });
      } else if (k.value === "repeat") {
        const count = this.expression();
        this.expect("{");
        const body = this.statements();
        const close = this.expect("}");
        out.push({
          kind: "RepeatStatement",
          count,
          body,
          span: this.end(k, close),
        });
      } else if (k.value === "transaction") {
        this.expect("word", "using");
        const database = this.expect("word");
        this.expect("{");
        const body = this.statements();
        const close = this.expect("}");
        out.push({
          kind: "TransactionStatement",
          database: database.value,
          body,
          span: this.end(k, close),
        });
      } else if (k.value === "await") {
        throw new PipeParseError(
          "PIPE-SYN-005",
          "An awaited operation cannot stand alone; bind its result with let",
          k,
          {
            kind: "syntax",
            received: k.value,
            suggestions: [
              "Use let inserted = await add item to Item using db",
            ],
          },
        );
      } else if (k.value === "break" || k.value === "continue") {
        out.push({
          kind: k.value === "break" ? "BreakStatement" : "ContinueStatement",
          span: k.span,
        } as any);
      } else if (this.t().kind === "operator" && this.t().value === "=") {
        this.take();
        const value = this.expression();
        out.push({
          kind: "AssignStatement",
          name: k.value,
          value,
          span: { start: k.span.start, end: value.span.end },
        });
      } else
        throw new PipeParseError(
          "PIPE-SYN-005",
          `Unknown statement ${k.value}`,
          k,
        );
    }
    return out;
  }
  genericCallAhead() {
    if (this.t().kind !== "operator" || this.t().value !== "<") return false;
    let depth = 0;
    for (let j = this.i; j < this.ts.length; j++) {
      const token = this.ts[j];
      if (token.kind === "operator" && token.value === "<") depth++;
      else if (
        token.kind === "operator" &&
        token.value === ">" &&
        --depth === 0
      )
        return this.ts[j + 1]?.kind === "(";
    }
    return false;
  }
  expression(min = 0): Expression {
    let left = this.primary();
    while (true) {
      if (this.t().kind === "?" && min === 0) {
        const q = this.take();
        left = {
          kind: "PropagateExpression",
          operand: left,
          span: { start: left.span.start, end: q.span.end },
        };
        continue;
      }
      if (left.kind === "IdentifierExpression" && this.genericCallAhead()) {
        this.take();
        const typeArguments: string[] = [];
        while (!(this.t().kind === "operator" && this.t().value === ">")) {
          typeArguments.push(this.typeRef());
          if (this.t().kind === ",") this.take();
          else if (!(this.t().kind === "operator" && this.t().value === ">"))
            throw new PipeParseError(
              "PIPE-SYN-003",
              "Expected comma or >",
              this.t(),
            );
        }
        this.take();
        left = { ...left, typeArguments };
      }
      if (this.t().kind === "(" && (left.kind === "IdentifierExpression" || left.kind === "FieldAccessExpression")) {
        this.take();
        const args: Expression[] = [];
        while (this.t().kind !== ")") {
          args.push(this.expression());
          if (this.t().kind === ",") this.take();
          else if (this.t().kind !== ")")
            throw new PipeParseError(
              "PIPE-SYN-003",
              "Expected comma or )",
              this.t(),
            );
        }
        const close = this.expect(")");
        left = {
          kind: "CallExpression",
          callee: left.kind === "IdentifierExpression" ? left.name : left.field,
          typeArguments: left.kind === "IdentifierExpression" ? left.typeArguments : undefined,
          args,
          ...(left.kind === "FieldAccessExpression" ? { receiver: left.object, methodName: left.field } : {}),
          span: { start: left.span.start, end: close.span.end },
        };
        continue;
      }
      if (this.t().kind === "[") {
        this.take();
        const index = this.expression();
        const close = this.expect("]");
        left = {
          kind: "IndexExpression",
          object: left,
          index,
          span: { start: left.span.start, end: close.span.end },
        };
        continue;
      }
      if (this.t().kind === ".") {
        this.take();
        const field = this.expect("word");
        left = {
          kind: "FieldAccessExpression",
          object: left,
          field: field.value,
          span: { start: left.span.start, end: field.span.end },
        };
        continue;
      }
      if (
        this.t().kind === "word" &&
        left.kind !== "LiteralExpression" &&
        left.kind !== "NoneLiteralExpression" &&
        !(this.ts[this.i + 1]?.kind === "operator" && this.ts[this.i + 1]?.value === "=") &&
        this.ts[this.i + 1]?.value !== "=>" &&
        !["and", "or", "in", "using", "where", "from", "show", "return", "if", "for", "while", "repeat", "else", "otherwise", "await", "break", "continue", "let", "var", "expect", "assert"].includes(this.t().value)
      ) {
        const field = this.take();
        left = {
          kind: "FieldAccessExpression",
          object: left,
          field: field.value,
          span: { start: left.span.start, end: field.span.end },
        };
        continue;
      }
      const op = this.t();
      const value = op.value;
      const precedence =
        value === "or"
          ? 1
          : value === "and"
            ? 2
            : ["==", "!=", "<", "<=", ">", ">="].includes(value)
              ? 3
              : ["+", "-"].includes(value)
                ? 4
                : ["*", "/", "%"].includes(value)
                  ? 5
                  : 0;
      if ((op.kind !== "operator" && op.kind !== "word") || precedence <= min)
        break;
      this.take();
      const right = this.expression(precedence);
      left = {
        kind: "BinaryExpression",
        operator: value,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }
  matchExpression(): Expression {
    const start = this.expect("word", "match");
    const value = this.expression();
    this.expect("{");
    const arms: any[] = [];
    while (this.t().kind !== "}") {
      const variant = this.expect("word");
      let binding: string | undefined;
      let fields: string[] | undefined;
      if (this.t().kind === "(") {
        this.take();
        binding = this.expect("word").value;
        this.expect(")");
      } else if (this.t().kind === "{") {
        this.take();
        fields = [];
        while (this.t().kind !== "}") {
          fields.push(this.expect("word").value);
          if (this.t().kind === ",") this.take();
          else if (this.t().kind !== "}")
            throw new PipeParseError(
              "PIPE-SYN-003",
              "Expected comma or }",
              this.t(),
            );
        }
        this.expect("}");
      }
      this.expect("operator", "=>");
      const armValue = this.expression();
      arms.push({
        kind: "MatchArm",
        variant: variant.value,
        binding,
        fields,
        value: armValue,
        span: { start: variant.span.start, end: armValue.span.end },
      });
      if (this.t().kind === ",") this.take();
    }
    const close = this.expect("}");
    return {
      kind: "MatchExpression",
      value,
      arms,
      span: this.end(start, close),
    };
  }
  lambdaExpression(): Expression {
    const start = this.expect("word", "lambda");
    this.expect("(");
    const parameters: Parameter[] = [];
    while (this.t().kind !== ")") {
      const name = this.expect("word");
      const type = this.typeRef();
      parameters.push({
        kind: "Parameter",
        name: name.value,
        type,
        span: this.end(name, this.ts[this.i - 1]),
      });
      if (this.t().kind === ",") this.take();
      else if (this.t().kind !== ")")
        throw new PipeParseError(
          "PIPE-SYN-003",
          "Expected comma or )",
          this.t(),
        );
    }
    this.expect(")");
    this.expect("operator", "->");
    const returnType = this.typeRef();
    this.expect("{");
    const body = this.statements();
    const close = this.expect("}");
    return {
      kind: "LambdaExpression",
      parameters,
      returnType,
      body,
      span: this.end(start, close),
    };
  }
  primary(): Expression {
    if (this.t().kind === "word" && this.t().value === "match")
      return this.matchExpression();
    if (this.t().kind === "word" && this.t().value === "lambda")
      return this.lambdaExpression();
    if (this.t().kind === "[") {
      const open = this.take();
      const elements: Expression[] = [];
      while (this.t().kind !== "]") {
        elements.push(this.expression());
        if (this.t().kind === ",") this.take();
        else if (this.t().kind !== "]")
          throw new PipeParseError(
            "PIPE-SYN-003",
            "Expected comma or ]",
            this.t(),
          );
      }
      const close = this.expect("]");
      return {
        kind: "ListLiteralExpression",
        elements,
        span: this.end(open, close),
      };
    }
    const t = this.take();
    if (t.kind === "number")
      return {
        kind: "LiteralExpression",
        value: t.value,
        valueType: t.value.includes(".") ? "number" : "integer",
        span: t.span,
      };
    if (t.kind === "string")
      return {
        kind: "LiteralExpression",
        value: t.value,
        valueType: "text",
        span: t.span,
      };
    if (t.kind === "word" && t.value === "none")
      return { kind: "NoneLiteralExpression", span: t.span };
    if (t.kind === "word" && ["true", "false"].includes(t.value))
      return {
        kind: "LiteralExpression",
        value: t.value === "true",
        valueType: "boolean",
        span: t.span,
      };
    if (t.kind === "word" && t.value === "not") {
      const operand = this.primary();
      return {
        kind: "UnaryExpression",
        operator: "not",
        operand,
        span: { start: t.span.start, end: operand.span.end },
      };
    }
    if (t.kind === "operator" && t.value === "-") {
      const operand = this.primary();
      return {
        kind: "UnaryExpression",
        operator: "-",
        operand,
        span: { start: t.span.start, end: operand.span.end },
      };
    }
    if (t.kind === "word") {
      if (
        this.t().kind === "{" &&
        this.ts[this.i + 1]?.kind === "word" &&
        this.ts[this.i + 2]?.kind === ":"
      ) {
        this.take();
        const fields: { name: string; value: Expression; span: any }[] = [];
        while (this.t().kind !== "}") {
          const f = this.expect("word");
          this.expect(":");
          const value = this.expression();
          fields.push({
            name: f.value,
            value,
            span: { start: f.span.start, end: value.span.end },
          });
          if (this.t().kind === ",") this.take();
        }
        const close = this.expect("}");
        return {
          kind: "RecordValueExpression",
          typeName: t.value,
          fields,
          span: this.end(t, close),
        };
      }
      return { kind: "IdentifierExpression", name: t.value, span: t.span };
    }
    if (t.kind === "(") {
      const e = this.expression();
      this.expect(")");
      return e;
    }
    throw new PipeParseError(
      "PIPE-SYN-003",
      `Expected expression, got ${t.value || t.kind}`,
      t,
    );
  }
}
