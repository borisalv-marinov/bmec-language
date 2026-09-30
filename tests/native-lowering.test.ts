import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler.js";
import { executeValue, publicValue } from "../src/core/interpreter.js";
import { lowerNativeC, NativeLoweringError } from "../src/native/codegen.js";

describe("typed IR to native C lowering", () => {
  it("lowers primitive control flow and canonical direct calls deterministically", () => {
    const result = compile(`app NativeSmoke
      function add(a integer, b integer) -> integer { return a + b }
      function main() -> integer {
        var total integer = 0
        repeat 5 { total = add(total, 7) }
        if total == 35 { return total } else { return 1 }
      }`);
    expect(result.diagnostics).toEqual([]);
    const first = lowerNativeC(result.ir!);
    expect(lowerNativeC(result.ir!)).toBe(first);
    expect(first).toContain("__builtin_add_overflow");
    expect(first).toContain("PIPE-RUNTIME-004: Integer overflow");
    expect(first).toContain("Maximum call depth exceeded");
    expect(first).toContain("for (int64_t bmec_i_");
    expect(first).toContain("bmec_add(");
  });

  it("rejects unsupported runtime values and operations explicitly", () => {
    const text = compile(`function unsupported() -> integer {
      let replaced = textReplace("BMEC", "B", "X")
      return 0
    }
    function main() -> integer { return unsupported() }`);
    expect(text.diagnostics).toEqual([]);
    expect(() => lowerNativeC(text.ir!)).toThrow(NativeLoweringError);
    expect(() => lowerNativeC(text.ir!)).toThrow(/supports only direct BMEC calls/);

    const entryArgs = compile("function main(limit integer) -> integer { return limit }");
    expect(entryArgs.diagnostics).toEqual([]);
    expect(() => lowerNativeC(entryArgs.ir!)).toThrow(/must not require parameters/);
  });

  it("keeps exact signed integer boundary and division guards in generated C", () => {
    const result = compile(`function main() -> integer {
      let minimum integer = -9223372036854775807 - 1
      return minimum % -1
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("INT64_MIN");
    expect(c).toContain("bmec_mod(");
    expect(c).toContain("if (!b) bmec_fail(\"PIPE-RUNTIME-003: Division by zero\")");
  });

  it("fuses integer multiply-by-three plus one with an exact checked range", () => {
    const result = compile("function transform(value integer) -> integer { return value * 3 + 1 }\nfunction main() -> integer { let value integer = 7 return transform(value) }");
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_mul3_add1(");
    expect(c).toContain("const int64_t low = INT64_MIN / 3");
    expect(c).toContain("const int64_t high = (INT64_MAX - 1) / 3");
    expect(c).toContain("if (offset > width) bmec_fail(\"PIPE-RUNTIME-004: Integer overflow\")");
  });

  it("combines step guards around a safe if condition and branch-leading statements", () => {
    const result = compile(`function main() -> integer {
      var value integer = 7
      if value % 2 == 0 { value = value + 1 } else { value = value + 1 }
      return value
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c.match(/bmec_local_steps \+= 2;/g)).toHaveLength(2);

    const throwingCondition = compile(`function main() -> integer {
      var value integer = 7
      if 1 / value > 0 { value = value + 1 } else { value = value + 1 }
      return value
    }`);
    expect(throwingCondition.diagnostics).toEqual([]);
    expect(lowerNativeC(throwingCondition.ir!)).not.toContain("bmec_step_many(2);");
  });

  it("uses local step counters around pure textContains builtins", () => {
    const result = compile(`function main() -> integer {
      if textContains("BMEC", "ME") { return 1 } else { return 0 }
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("int64_t bmec_local_steps = bmec_steps;");
    expect(c).toContain("bmec_steps = bmec_local_steps;");
  });

  it("lowers boolean returns and short-circuit operators without boxing", () => {
    const result = compile(`function positive(value integer) -> boolean { return value > 0 }
      function main() -> boolean { return positive(1) and not false }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain(" && ");
    expect(c).toContain("puts(");
    expect(c).toContain("true");
    const main = result.ir!.functions.find((fn) => fn.name === "main")!;
    const mainSymbol = `bmec_fn_${[...new TextEncoder().encode(String(main.id))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const mainStart = c.indexOf(`${mainSymbol}(`);
    const mainEnd = c.indexOf("\n}", mainStart);
    expect(mainStart).toBeGreaterThanOrEqual(0);
    expect(c.slice(mainStart, mainEnd)).toContain("++bmec_steps");
    expect(c.slice(mainStart, mainEnd)).not.toContain("bmec_local_steps");
  });

  it("lowers fixed integer lists and indexed iteration without boxing", () => {
    const result = compile(`function main() -> integer {
      var total integer = 0
      let values list<integer> = [1, 2, 3]
      for value in values { total = total + value }
      return total
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("int64_t bmec_v_");
    expect(c).toContain("bmec_list_i_");
    expect(c).toContain("_length");
    expect(c).not.toContain("does not yet support list iteration");
  });

  it("lowers finite number arithmetic with matching runtime guards", () => {
    const result = compile("function calculate(value number) -> number { return (value * 2.0) + 0.5 }\nfunction main() -> number { return calculate(1.25) }");
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_number_mul");
    expect(c).toContain("bmec_number_add");
    expect(c).toContain("bmec_number_div");
    expect(c).toContain("PIPE-RUNTIME-005: Invalid numeric value");
    expect(c).toContain("printf(\"%.17g\\n\"");
  });

  it("folds finite constant number expressions while retaining runtime error guards", () => {
    const result = compile("function main() -> number { return 7919.0 * 0.25 - 126.0 }");
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    const main = result.ir!.functions.find((fn) => fn.name === "main")!;
    const symbol = `bmec_fn_${[...new TextEncoder().encode(String(main.id))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const start = c.indexOf(`double ${symbol}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = c.slice(start, c.indexOf("\n}", start));
    expect(body).toContain("1853.75");
    expect(body).not.toMatch(/bmec_number_(?:add|sub|mul|div|mod)\(/);

    const negativeZero = compile("function main() -> number { return 0.0 * -1.0 }");
    expect(negativeZero.diagnostics).toEqual([]);
    expect(lowerNativeC(negativeZero.ir!)).toContain("bmec_result = -0.0;");

    const overflow = compile("function multiply(value number) -> number { return value * value }\nfunction main() -> number { return multiply(2.0) }");
    expect(overflow.diagnostics).toEqual([]);
    expect(lowerNativeC(overflow.ir!)).toContain("bmec_number_mul(");

    const divisionByZero = compile("function main() -> number { return 1.0 / 0.0 }");
    expect(divisionByZero.diagnostics).toEqual([]);
    expect(lowerNativeC(divisionByZero.ir!)).toContain("bmec_number_div(");
  });

  it("lowers filesystem entries through an injected root and serializes text Results", () => {
    const result = compile(`app NativeFiles
      function summarize(fs capability<filesystem>, input text) -> result<text,text> {
        return readTextFile(fs, input)
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!, "summarize");
    expect(c).toContain("RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS");
    expect(c).toContain("bmec_fs_init_root(bmec_fs_root)");
    expect(c).toContain("bmec_builtin_readTextFile(");
    expect(c).toContain("bmec_fs_args[bmec_arg_1]");
    expect(c).toContain("bmec_json_text(bmec_entry_result.payload.ok)");
    expect(c).toContain("bmec_entry_result.payload.error");
  });

  it("lowers scalar-field records to canonical C structs and direct reads", () => {
    const result = compile(`type Sample { count integer enabled boolean ratio number }
      function main() -> integer {
        let sample = Sample { count: 17, enabled: true, ratio: 1.5 }
        if sample.enabled { return sample.count } else { return 0 }
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("typedef struct");
    expect(c).toContain(".bmec_field_");
    expect(c).toContain("bmec_record_");
    expect(c).toContain(" = ((bmec_record_");
  });

  it("lowers text fields in scalar records and rejects record entry returns", () => {
    const textField = compile('type Label { name text } function main() -> integer { let label = Label { name: "x" } return 0 }');
    expect(textField.diagnostics).toEqual([]);
    expect(lowerNativeC(textField.ir!)).toContain("bmec_text bmec_field_");

    const recordEntry = compile("type Point { x integer } function main() -> Point { return Point { x: 1 } }");
    expect(recordEntry.diagnostics).toEqual([]);
    expect(() => lowerNativeC(recordEntry.ir!)).toThrow(/must return a supported primitive value/);
  });

  it("passes and returns scalar records by value in direct calls", () => {
    const result = compile(`type Point { x integer enabled boolean }
      function shift(point Point, amount integer) -> Point {
        return Point { x: point.x + amount, enabled: point.enabled }
      }
      function read(point Point) -> integer { if point.enabled { return point.x } else { return 0 } }
      function main() -> integer { let moved = shift(Point { x: 17, enabled: true }, 8) return read(moved) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_record_");
    expect(c).toContain("bmec_fn_");
    expect(c).toContain("return bmec_result;");
  });

  it("lowers primitive optionals as tagged values and narrows only after presence checks", () => {
    const result = compile(`function wrap(value integer) -> integer? { if value > 0 { return some(value) } else { return none } }
      function unwrap(value integer?) -> integer { if value != none { return value } else { return -1 } }
      function main() -> integer { return unwrap(wrap(5)) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bool present; int64_t value;");
    expect(c).toContain(".present = true");
    expect(c).toContain(".present = false");
    expect(c).toContain(".value");
  });

  it("supports text Optional payloads and rejects Optional entry results", () => {
    const textOptional = compile('function main() -> integer { let label text? = some("x") return 0 }');
    expect(textOptional.diagnostics).toEqual([]);
    expect(lowerNativeC(textOptional.ir!)).toContain("bool present; bmec_text value;");

    const optionalEntry = compile("function main() -> integer? { return some(1) }");
    expect(optionalEntry.diagnostics).toEqual([]);
    expect(() => lowerNativeC(optionalEntry.ir!)).toThrow(/must return a supported primitive value/);
  });

  it("lowers scalar Results, checked payload access, and error propagation", () => {
    const result = compile(`function wrap(value integer) -> result<integer,integer> { return ok(value + 1) }
      function pass(value result<integer,integer>) -> result<integer,integer> { let unwrapped = value? return ok(unwrapped) }
      function main() -> integer { let answer = pass(wrap(3)) if isOk(answer) { return answer.value } else { return -1 } }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bool is_ok; union");
    expect(c).toContain("bmec_try_");
    expect(c).toContain("payload.error =");
    expect(c).toContain("Cannot extract Result.value from err");
    expect(c).toContain(".is_ok");
  });

  it("supports text Result payloads and rejects money payloads", () => {
    const textError = compile('function produce() -> result<integer,text> { return err("bad") } function main() -> integer { let value = produce() return 0 }');
    expect(textError.diagnostics).toEqual([]);
    expect(lowerNativeC(textError.ir!)).toContain("bmec_text error;");

    const moneyError = compile('function produce() -> result<integer,money> { return err(1.25) } function main() -> integer { let value = produce() return 0 }');
    expect(moneyError.diagnostics).toEqual([]);
    expect(() => lowerNativeC(moneyError.ir!)).toThrow(/Native Result payload money is unsupported/);
  });

  it("lowers exact money values and arithmetic without bounding minor units to int64", () => {
    const result = compile(`function add(left money, right money) -> money { return left + right }
      function divide(value money, divisor integer) -> money { return value / divisor }
      function greater(left money, right money) -> boolean { return left > right }
      function main() -> integer {
        let value = add(999999999999999999999999999999999999999999999999.99, 0.01)
        if greater(divide(value, 2), 0.00) { return 42 } else { return 0 }
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("typedef struct { bmec_text digits; bool negative; } bmec_money;");
    expect(c).toContain("bmec_money_add_abs");
    expect(c).toContain("bmec_money_divide_integer");
    expect(c).toContain("bmec_money_compare");

    const reversedMultiply = compile(`function multiply(factor integer, value money) -> money { return factor * value }
      function negative(value money, zero money) -> boolean { return value < zero }
      function main() -> integer { let value = multiply(-2, 12.34) if negative(value, 0.00) { return 1 } else { return 0 } }`);
    expect(reversedMultiply.diagnostics).toEqual([]);
    expect(() => lowerNativeC(reversedMultiply.ir!)).toThrow(/Native binary operation \* has unsupported operands/);

    const moneyEntry = compile("function main() -> money { return 1.23 }");
    expect(moneyEntry.diagnostics).toEqual([]);
    expect(() => lowerNativeC(moneyEntry.ir!)).toThrow(/entry function .* must return a supported primitive value/);
  });

  it("lowers plain scalar records inside Optional and Result payloads", () => {
    const result = compile(`type Point { x integer enabled boolean }
      function maybePoint(value integer) -> Point? { if value > 0 { return some(Point { x: value, enabled: true }) } else { return none } }
      function getPoint(value integer) -> result<Point,Point> { if value > 0 { return ok(Point { x: value, enabled: true }) } else { return err(Point { x: -value, enabled: false }) } }
      function main() -> integer {
        let maybe = maybePoint(6)
        if maybe != none { let success = getPoint(maybe.x) if isOk(success) { return success.value.x } else { return success.error.x } } else { return 0 }
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c.indexOf("bmec_record_")).toBeLessThan(c.indexOf("bmec_result_type_"));
    expect(c).toContain("bool present;");
    expect(c).toContain("bool is_ok; union");
    expect(c).toContain(".present");
    expect(c).toContain("bmec_field_78");
  });

  it("lowers exhaustive Optional and Result matches with typed payload bindings", () => {
    const result = compile(`type Point { x integer enabled boolean }
      function readMaybe(value Point?) -> integer { return match value { some(point) => point.x, none => 0 } }
      function readResult(value result<Point,Point>) -> integer { return match value { ok(point) => point.x, err(problem) => problem.x } }
      function hasValue(value Point?) -> integer { return match value { some(unused) => 1, none => 0 } }
      function main() -> integer { return readMaybe(some(Point { x: 8, enabled: true })) + readResult(err(Point { x: 9, enabled: false })) + hasValue(none) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain(".present) ?");
    expect(c).toContain(".is_ok) ?");
    expect(c).toContain(".payload.error");
    expect(c).toContain("bmec_field_78");
  });

  it("lowers non-generic enum construction and exhaustive scalar-payload matching", () => {
    const result = compile(`enum Event { Started Stopped ExitCode(integer) Message(text) Enabled(boolean) Ratio(number) }
      function matches(item Event) -> boolean {
        return match item {
          Started => false, Stopped => false, ExitCode(code) => code == 7,
          Message(text) => text == "done", Enabled(flag) => flag, Ratio(value) => value == 1.25
        }
      }
      function main() -> boolean {
        let noPayload = Event.Started
        let integerPayload = Event.ExitCode(7)
        let textPayload = Event.Message("done")
        let booleanPayload = Event.Enabled(true)
        let numberPayload = Event.Ratio(1.25)
        return matches(noPayload) == false and matches(integerPayload) and matches(textPayload) and matches(booleanPayload) and matches(numberPayload)
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("uint32_t tag;");
    expect(c).toContain("union { int64_t bmec_variant_");
    expect(c).toContain("bmec_text bmec_variant_");
    expect(c).toContain(".tag = 0");
    expect(c).toContain(".payload.bmec_variant_");
    expect(c).toContain(".tag == 5u");
  });

  it("rejects generic enums and non-scalar enum payloads until their layouts are defined", () => {
    const recordPayload = compile(`type Point { x integer }
      enum Shape { PointValue(Point) }
      function main() -> integer { let shape = Shape.PointValue(Point { x: 1 }) return 0 }`);
    expect(recordPayload.diagnostics).toEqual([]);
    expect(() => lowerNativeC(recordPayload.ir!)).toThrow(/supports only integer, number, boolean, or text payloads/);

    const generic = compile(`enum Box<T> { Value(T) }
      function main() -> integer { let box = Box.Value(1) return 0 }`);
    expect(generic.diagnostics).toEqual([]);
    expect(() => lowerNativeC(generic.ir!)).toThrow(/Native generic enum Box is unsupported/);
  });

  it("rejects temporary Optional and Result match scrutinees explicitly", () => {
    const result = compile(`function main() -> integer { return match some(1) { some(value) => value, none => 0 } }`);
    expect(result.diagnostics).toEqual([]);
    expect(() => lowerNativeC(result.ir!)).toThrow(/requires a named local scrutinee/);
  });

  it("lowers borrowed UTF-8 text literals, equality, and substring search", () => {
    const result = compile(`function same(left text, right text) -> boolean { return left == right }
      function main() -> integer { if same("αβ", "αβ") and textContains("αβγ", "β") { return 1 } else { return 0 } }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("size_t length;");
    expect(c).toContain("bmec_text_equal");
    expect(c).toContain("bmec_text_contains");
  });

  it("lowers text concatenation through the invocation arena", () => {
    const result = compile(`function concatenate(left text, right text) -> text { return left + right }
      function main() -> boolean { return concatenate("héllo ", "🌍") == "héllo 🌍" }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_concat");
    expect(c).toContain("bmec_arena_alloc(length)");
  });

  it("lowers arena-backed split/join text lists and cleanup", () => {
    const result = compile(`function main() -> integer {
      let pieces = split("α|β||", "|")
      let rebuilt = join(pieces, ",")
      var total integer = 0
      for piece in pieces { if piece == "" { total = total + 1 } }
      if rebuilt == "α,β,," and total == 2 { return 1 } else { return 0 }
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_arena_alloc");
    expect(c).toContain("#ifdef BMEC_NATIVE_ARENA_METRICS");
    expect(c).toContain("bmec_text_split");
    expect(c).toContain("bmec_text_split_empty");
    expect(c).toContain("bmec_text_join");
    expect(c).toContain("bmec_arena_release();");
    expect(c).toContain("bmec_text_list bmec_v_");
  });

  it("lowers captureless primitive-list mapping to arena-backed typed lists", () => {
    const result = compile(`function main() -> boolean {
      let values = split("α|β", "|")
      let mapped = map(values, lambda(value text) -> text { return value + "!" })
      return join(mapped, ",") == "α!,β!"
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_map");
    expect(c).toContain("bmec_text (*");

    const integerMap = compile(`function main() -> integer {
      let values list<integer> = [1, 2]
      let mapped = map(values, lambda(value integer) -> integer { return value + 1 })
      var total integer = 0
      for value in mapped { total = total + value }
      return total
    }`);
    expect(integerMap.diagnostics).toEqual([]);
    expect(lowerNativeC(integerMap.ir!)).toContain("bmec_integer_map");

    const crossTypeMap = compile(`function main() -> integer {
      let values list<integer> = [1, 2]
      let mapped = map(values, lambda(value integer) -> boolean { return value > 1 })
      var total integer = 0
      for value in mapped { if value { total = total + 1 } }
      return total
    }`);
    expect(crossTypeMap.diagnostics).toEqual([]);
    const crossTypeC = lowerNativeC(crossTypeMap.ir!);
    expect(crossTypeC).toContain("bmec_integer_to_boolean_map");
    expect(crossTypeC).not.toContain("bmec_integer_to_text_map");

    const captured = compile(`function main() -> integer {
      let suffix text = "!"
      let values = split("a", "|")
      let mapped = map(values, lambda(value text) -> text { return value + suffix })
      return length(mapped)
    }`);
    expect(captured.diagnostics).toEqual([]);
    expect(() => lowerNativeC(captured.ir!)).toThrow(/captured closures/);
  });

  it("lowers captureless text filter lambdas and rejects captured ones", () => {
    const captureless = compile(`function main() -> integer {
      let lines = split("INFO\\nERROR disk\\nWARN", "\\n")
      let errors = filter(lines, lambda(line text) -> boolean { return textContains(line, "ERROR") })
      return length(errors)
    }`);
    expect(captureless.diagnostics).toEqual([]);
    const c = lowerNativeC(captureless.ir!);
    expect(c).toContain("bmec_text_filter");
    expect(c).toContain(".length)");
    expect(c).toContain("bool bmec_fn_");

    const captured = compile(`function main() -> integer {
      let needle text = "ERROR"
      let lines = split("ERROR", "|")
      let errors = filter(lines, lambda(line text) -> boolean { return textContains(line, needle) })
      return 0
    }`);
    expect(captured.diagnostics).toEqual([]);
    expect(() => lowerNativeC(captured.ir!)).toThrow(/captured closures/);
  });

  it("lowers UTF-8 text prefix and suffix checks", () => {
    const result = compile(`function check(value text, prefix text, suffix text) -> boolean {
      return startsWith(value, prefix) and endsWith(value, suffix)
    }
    function main() -> boolean {
      return check("αβγ", "αβ", "βγ") and startsWith("🌍!", "🌍") and endsWith("🌍!", "!") and startsWith("", "") and endsWith("", "") and startsWith("short", "long") == false and endsWith("short", "long") == false
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_starts_with");
    expect(c).toContain("bmec_text_ends_with");
  });

  it("lowers textLength with Unicode code-point semantics", () => {
    const result = compile(`function main() -> integer {
      return textLength("Aé🌍")
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_length_codepoints");
  });

  it("lowers textIndexOf to an optional Unicode code-point index", () => {
    const result = compile(`function main() -> boolean {
      let found = textIndexOf("A🌍α", "α")
      return match found { some(index) => index == 2, none => false }
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_index_of");
    expect(c).toContain("bmec_text_length_codepoints(prefix)");
  });

  it("lowers substring as a checked, allocation-free code-point slice", () => {
    const result = compile(`function main() -> boolean {
      return substring("Aé🌍Z", 1, 3) == "é🌍"
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_byte_offset");
    expect(c).toContain("bmec_text_substring");
  });

  it("lowers captureless integer folds over text lines", () => {
    const result = compile(`function main() -> integer {
      let lines = split("ERROR\nINFO\nERROR", "\n")
      return fold(lines, 0, lambda(count integer, line text) -> integer {
        if textContains(line, "ERROR") { return count + 1 } else { return count }
      })
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_fold_integer");
    expect(c).toContain("int64_t (*callback)(int64_t, bmec_text)");

    const captured = compile(`function main() -> integer {
      let needle text = "ERROR"
      let lines = split("ERROR", "\\n")
      return fold(lines, 0, lambda(count integer, line text) -> integer {
        if textContains(line, needle) { return count + 1 } else { return count }
      })
    }`);
    expect(captured.diagnostics).toEqual([]);
    expect(() => lowerNativeC(captured.ir!)).toThrow(/captured closures/);
  });

  it("sorts text lists with BMEC UTF-16 ordering and a copied arena buffer", () => {
    const result = compile(`function main() -> boolean {
      let values = ["", "𐀀", "z", "a"]
      let sorted = sort(values)
      return join(sorted, ",") == "a,z,𐀀," and join(values, ",") == ",𐀀,z,a"
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_text_sort");
    expect(c).toContain("bmec_text_compare_utf16");
  });

  it("lowers integer and number list sorting to typed copied buffers", () => {
    const result = compile(`function main() -> boolean {
      let integerValues = [9223372036854775807, 0, -9223372036854775807 - 1]
      let numberValues = [3.5, -1.25, 2.0]
      let integers = sort(integerValues)
      let numbers = sort(numberValues)
      return length(integers) == 3 and length(numbers) == 3
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_integer_sort");
    expect(c).toContain("bmec_number_sort");
    expect(c).toContain("bmec_number_intro_sort");
    expect(c).not.toContain("qsort(items, input.length, sizeof(double), bmec_number_qsort_compare)");
  });

  it("lowers typed JSON encoding for integer, number, boolean, and text primitives", () => {
    const result = compile(`function main() -> boolean {
      return encodeJson(42) == "{\\"version\\":1,\\"kind\\":\\"integer\\",\\"value\\":\\"42\\"}" and
        encodeJson(1.25) == "{\\"version\\":1,\\"kind\\":\\"number\\",\\"value\\":1.25}" and
        encodeJson(true) == "{\\"version\\":1,\\"kind\\":\\"boolean\\",\\"value\\":true}" and
        encodeJson("a\\nb") == "{\\"version\\":1,\\"kind\\":\\"text\\",\\"value\\":\\"a\\\\nb\\"}"
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_encode_integer");
    expect(c).toContain("bmec_json_encode_number");
    expect(c).toContain("bmec_json_encode_boolean");
    expect(c).toContain("bmec_json_encode_text");
  });

  it("lowers typed JSON encoding for primitive lists", () => {
    const result = compile(`function main() -> boolean {
      let integers list<integer> = [1]
      let numbers list<number> = [1.5]
      let flags list<boolean> = [true]
      let words list<text> = ["π"]
      return encodeJson(integers) != "" and encodeJson(numbers) != "" and encodeJson(flags) != "" and encodeJson(words) != ""
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_encode_integer_list");
    expect(c).toContain("bmec_json_encode_number_list");
    expect(c).toContain("bmec_json_encode_boolean_list");
    expect(c).toContain("bmec_json_encode_text_list");
  });

  it("lowers typed JSON encoding for supported plain records", () => {
    const result = compile(`type Sample { count integer label text words list<text> maybe integer? amount money }
      function make() -> Sample { let words = split("a|b", "|") let maybe = some(9) let amount money = 9.25 return Sample { count: 3, label: "π", words: words, maybe: maybe, amount: amount } }
      function main() -> boolean {
        let sample = make()
        return encodeJson(sample) != ""
      }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_encode_record_");
    expect(c).toContain("\\\"kind\\\":\\\"record\\\"");
    expect(c).toContain("\\\"elementType\\\"");
    expect(c).toContain("bmec_json_encode_optional_integer");
    expect(c).toContain("bmec_json_encode_money");
  });

  it("rejects plain-record JSON fields without a native encoder", () => {
    const result = compile(`type Child { value integer }
      type Sample { child Child }
      function main() -> boolean {
        let child = Child { value: 42 }
        let sample = Sample { child: child }
        return encodeJson(sample) != ""
      }`);
    expect(result.diagnostics).toEqual([]);
    expect(() => lowerNativeC(result.ir!)).toThrow(/record Sample\.child has unsupported field type record/);
  });

  it("lowers UTF-8 Base64 encoding", () => {
    const result = compile(`function main() -> boolean {
      return base64Encode("Hello 😀") == "SGVsbG8g8J+YgA=="
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_base64_encode");
  });

  it("lowers strict UTF-8 Base64 decoding", () => {
    const result = compile(`function decode(value text) -> result<text,text> { return base64Decode(value) }
      function main() -> boolean { return isOk(decode("SGk=")) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_base64_decode_");
    expect(c).toContain("bmec_utf8_valid");
  });

  it("lowers typed scalar JSON decoding with a generated parser", () => {
    const result = compile(`function main() -> boolean {
      let decoded result<integer,text> = decodeJson("{\\"version\\":1,\\"kind\\":\\"integer\\",\\"value\\":\\"42\\"}")
      if isOk(decoded) { return decoded.value == 42 } else { return false }
    }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_scalar_parse");
    expect(c).toContain("bmec_json_decode_");
  });

  it("lowers typed JSON decoding into scalar Optional payloads", () => {
    const result = compile(`function read(source text) -> result<integer?,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("{\\"version\\":1,\\"kind\\":\\"none\\"}")) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("optional_present");
    expect(c).toContain("bmec_json_decode_");
  });

  it("lowers typed JSON decoding into scalar Result payloads", () => {
    const result = compile(`function read(source text) -> result<result<integer,text>,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("{\\"version\\":1,\\"kind\\":\\"result\\",\\"state\\":\\"ok\\",\\"value\\":{\\"version\\":1,\\"kind\\":\\"integer\\",\\"value\\":\\"42\\"}}")) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("result_payload");
    expect(c).toContain("bmec_json_decode_");
  });

  it("lowers typed JSON decoding into text-list payloads", () => {
    const result = compile(`function read(source text) -> result<list<text>,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("{\\"version\\":1,\\"kind\\":\\"list\\",\\"elementType\\":{\\"kind\\":\\"primitive\\",\\"name\\":\\"text\\"},\\"items\\":[]}")) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_scalar_list_parse");
    expect(c).toContain("bmec_json_decode_");
  });

  it("lowers typed JSON decoding into scalar-record payloads", () => {
    const result = compile(`type Payload { count integer label text }
      function read(source text) -> result<Payload,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("{}")) }`);
    expect(result.diagnostics).toEqual([]);
    const c = lowerNativeC(result.ir!);
    expect(c).toContain("bmec_json_object_has_only");
    expect(c).toContain("bmec_json_decode_");
  });

  it("documents the native/reference gap for JSON lists of records", () => {
    const result = compile(`type Attendee { name text age integer }
      function read(source text) -> result<list<Attendee>,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("[]")) }`);
    expect(result.diagnostics).toEqual([]);
    expect(publicValue(executeValue(result.ir!.functions, "read", ['[{"name":"Ana","age":18},{"name":"Ivo","age":17}]']))).toEqual({
      state: "ok",
      value: [{ name: "Ana", age: 18 }, { name: "Ivo", age: 17 }],
    });
    expect(() => lowerNativeC(result.ir!)).toThrow(expect.objectContaining({
      code: "PIPE-NATIVE-001",
      message: "Native Result payload list is unsupported in FUNC-002",
    }));
  });

  it("rejects JSON record fields outside the native decoder boundary", () => {
    const result = compile(`type Payload { count money }
      function read(source text) -> result<Payload,text> { return decodeJson(source) }
      function main() -> boolean { return isOk(read("{}")) }`);
    expect(result.diagnostics).toEqual([]);
    expect(() => lowerNativeC(result.ir!)).toThrow(/Native decodeJson record Payload.count has unsupported field type money/);
  });
});
