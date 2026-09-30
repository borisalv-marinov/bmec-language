import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/source.js";
import { runPureFunction } from "../src/compiler/playground-runner.js";
import { executeValue, ListValue } from "../src/core/interpreter.js";

const source = `app Playground
function add(left integer, right integer) -> integer { return left + right }
function sameLists() -> boolean { return [1, 2] == [1, 2] }
function countList(items list<integer>) -> integer { return length(items) }
function joinText(left text, right text) -> text { return left + right }
function maybeDivide(value integer) -> integer { return 10 / value }
function maximum() -> integer { return 9223372036854775807 }
function overflow() -> integer { return 9223372036854775807 + 1 }
`;

function functions() {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  return result.ir!.functions;
}

function plain(value: unknown): unknown {
  if (value instanceof ListValue) return value.items.map(plain);
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

describe("browser playground pure-function runner", () => {
  it("matches reference results for supported values and structural list equality", () => {
    const compiled = functions();
    for (const [name, args] of [["add", [20, 22]], ["sameLists", []], ["maximum", []]] as const) {
      expect(runPureFunction(compiled, name, [...args])).toEqual(plain(executeValue(compiled, name, [...args])));
    }
    expect(runPureFunction(compiled, "sameLists", [])).toBe(true);
  });

  it("rejects integer overflow like the reference runtime", () => {
    const compiled = functions();
    expect(() => runPureFunction(compiled, "overflow", [])).toThrow(/Integer overflow/);
    expect(() => executeValue(compiled, "overflow", [])).toThrow(/Integer overflow/);
    expect(() => runPureFunction(compiled, "add", [9223372036854775807n, 1n])).toThrow(/signed 64-bit/);
  });

  it("bounds list and text growth before concatenating", () => {
    const compiled = functions();
    expect(() => runPureFunction(compiled, "countList", [Array(1_001).fill(1)])).toThrow(/lists to 1,000/);
    expect(() => runPureFunction(compiled, "countList", [[1, "not-an-integer"]])).toThrow(/Integer arguments/);
    expect(() => runPureFunction(compiled, "joinText", ["x".repeat(30_000), "y".repeat(20_001)])).toThrow(/text values to 50,000/);
  });

  it("rejects unsupported runtime operations and preserves ordinary failures", () => {
    const compiled = functions();
    expect(() => runPureFunction(compiled, "maybeDivide", [0])).toThrow(/Division by zero/);
    expect(runPureFunction(compiled, "maybeDivide", [2])).toBe(5n);
    expect(runPureFunction(compiled, "maybeDivide", [2])).toEqual(plain(executeValue(compiled, "maybeDivide", [2])));
  });
});
