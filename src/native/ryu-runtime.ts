import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ryuDirectory = join(dirname(fileURLToPath(import.meta.url)), "vendor", "ryu");
const readRyu = (name: string) => readFileSync(join(ryuDirectory, name), "utf8");
const inlineRyuIncludes = (source: string) => source.replace(/^\s*#include "ryu\/[^"]+"\s*$/gm, "");
const localRyuFunctions = (source: string) => source
  .replace(/^int d2s_buffered_n\(/m, "static int d2s_buffered_n(")
  .replace(/^void d2s_buffered\(/m, "static void d2s_buffered(")
  .replace(/^char\* d2s\(/m, "static char* d2s(");

/** Self-contained Ryu double-to-shortest runtime embedded in generated C. */
export const nativeRyuRuntime = [
  inlineRyuIncludes(readRyu("common.h")),
  inlineRyuIncludes(readRyu("digit_table.h")),
  inlineRyuIncludes(readRyu("d2s_intrinsics.h")),
  inlineRyuIncludes(readRyu("d2s_full_table.h")),
  localRyuFunctions(inlineRyuIncludes(readRyu("d2s.c"))),
].join("\n").trim().split("\n");
