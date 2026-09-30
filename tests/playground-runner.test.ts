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
function maybeNumberDivide(value number) -> number { return 1.0 / value }
function numberMath(value number) -> number { return value / 2.0 + 0.25 }
function both(left boolean, right boolean) -> boolean { return left and right }
function choose(value boolean) -> integer { if value { return 7 } else { return 9 } }
function buildList(value integer) -> list<integer> { return [value, value + 1] }
function composed(value integer) -> integer { return add(value, 1) * 2 }
function echoTextList(items list<text>) -> list<text> { return items }
function eagerAnd() -> boolean { return false and (10 / 0 == 0) }
function eagerOr() -> boolean { return true or (10 / 0 == 0) }
function mutateInBranch(flag boolean) -> integer {
  var total integer = 1
  if flag { total = 4 }
  return total
}
function descend(value integer) -> integer { if value > 0 { return descend(value - 1) } else { return 0 } }
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
    for (const [name, args] of [
      ["add", [20, 22]], ["sameLists", []], ["maximum", []],
      ["numberMath", [3.5]], ["both", [true, false]], ["choose", [true]],
      ["countList", [[4, 5, 6]]], ["buildList", [8]], ["composed", [20]],
      ["mutateInBranch", [true]], ["mutateInBranch", [false]],
    ] as const) {
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
    expect(() => runPureFunction(compiled, "echoTextList", [Array(3).fill("x".repeat(40_000))])).toThrow(/returned text to 100,000 characters total/);
    expect(() => runPureFunction(compiled, "countList", [Array.from({ length: 1_000 }, () => Array(5).fill(1))])).toThrow(/5,000 values/);
    const deepArgument: unknown[] = [];
    let cursor = deepArgument;
    for (let depth = 0; depth < 33; depth += 1) { const child: unknown[] = []; cursor.push(child); cursor = child; }
    expect(() => runPureFunction(compiled, "countList", [deepArgument])).toThrow(/nesting to 32 levels/);
    expect(() => runPureFunction(compiled, "descend", [40])).toThrow(/32-call depth limit/);

    const manyRows = `app PlaygroundOutputLimit\nfunction row() -> list<text> { return ["a", "b", "c", "d"] }\nfunction manyRows() -> list<list<text>> { return [${Array(1_000).fill("row()").join(", ")}] }`;
    const manyRowsResult = compile(manyRows);
    expect(manyRowsResult.diagnostics).toEqual([]);
    expect(() => runPureFunction(manyRowsResult.ir!.functions, "manyRows", [])).toThrow(/5,000 values/);
  });

  it("rejects unsupported runtime operations and preserves ordinary failures", () => {
    const compiled = functions();
    expect(() => runPureFunction(compiled, "maybeDivide", [0])).toThrow(/Division by zero/);
    expect(runPureFunction(compiled, "maybeDivide", [2])).toBe(5n);
    expect(runPureFunction(compiled, "maybeDivide", [2])).toEqual(plain(executeValue(compiled, "maybeDivide", [2])));
    expect(() => runPureFunction(compiled, "maybeNumberDivide", [0])).toThrow(/Division by zero/);
    expect(() => executeValue(compiled, "maybeNumberDivide", [0])).toThrow(/Division by zero/);
    for (const name of ["eagerAnd", "eagerOr"]) {
      expect(() => runPureFunction(compiled, name, [])).toThrow(/Division by zero/);
      expect(() => executeValue(compiled, name, [])).toThrow(/Division by zero/);
    }
  });
});
