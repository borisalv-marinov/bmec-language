import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectIR } from "../ir/ir.js";
import { assertSerializedIR } from "../ir/validate.js";
import { lowerNativeC } from "./codegen.js";

export class NativeBuildError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NativeBuildError";
  }
}

export interface NativeBuildOptions {
  outputDirectory: string;
  entry?: string;
  compiler?: string;
}

export interface NativeBuildResult {
  executable: string;
  generatedC: string;
  compiler: string;
  compilerVersion: string;
  flags: string[];
}

export interface NativeCompiler {
  path: string;
  version: string;
  kind: "gnu" | "msvc";
  env?: NodeJS.ProcessEnv;
}

let visualStudioCompilerCache: NativeCompiler | null | undefined;

function probeCompiler(candidate: string, env?: NodeJS.ProcessEnv, msvc = false): string | undefined {
  const result = spawnSync(candidate, [msvc ? "/?" : "--version"], { encoding: "utf8", windowsHide: true, env });
  if (result.error || result.status !== 0) return undefined;
  return (msvc ? result.stderr || result.stdout : result.stdout || result.stderr).split(/\r?\n/, 1)[0]?.trim() || candidate;
}

function findVisualStudioCompiler(requestedCompilerPath?: string): NativeCompiler | undefined {
  if (process.platform !== "win32") return undefined;
  if (!requestedCompilerPath && visualStudioCompilerCache !== undefined) return visualStudioCompilerCache ?? undefined;
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) {
    visualStudioCompilerCache = null;
    return undefined;
  }
  const installation = spawnSync(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ], { encoding: "utf8", windowsHide: true });
  const installationPath = installation.status === 0 ? installation.stdout.trim() : "";
  if (!installationPath || /["\r\n%]/.test(installationPath)) {
    visualStudioCompilerCache = null;
    return undefined;
  }
  const developerCommand = join(installationPath, "Common7", "Tools", "VsDevCmd.bat");
  if (!existsSync(developerCommand)) {
    visualStudioCompilerCache = null;
    return undefined;
  }

  const captured = spawnSync("cmd.exe", [
    "/d",
    "/c",
    `call "${developerCommand}" -arch=x64 -host_arch=x64 >nul && set`,
  ], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, maxBuffer: 4 * 1024 * 1024 });
  if (captured.error || captured.status !== 0) {
    visualStudioCompilerCache = null;
    return undefined;
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const line of captured.stdout.split(/\r?\n/)) {
    if (!line || line.startsWith("=")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const existing = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase());
    if (existing) delete env[existing];
    env[key] = line.slice(separator + 1);
  }
  const located = requestedCompilerPath
    ? undefined
    : spawnSync("where.exe", ["cl.exe"], { encoding: "utf8", windowsHide: true, env });
  const compilerPath = requestedCompilerPath ?? (located?.status === 0 ? located.stdout.split(/\r?\n/, 1)[0]?.trim() : undefined);
  const expectedCompilerRoot = join(installationPath, "VC", "Tools", "MSVC").toLowerCase() + "\\";
  if (!compilerPath || !existsSync(compilerPath) || !compilerPath.toLowerCase().startsWith(expectedCompilerRoot)) {
    if (!requestedCompilerPath) visualStudioCompilerCache = null;
    return undefined;
  }
  const version = probeCompiler(compilerPath, env, true);
  const compiler = version ? { path: compilerPath, version, kind: "msvc" as const, env } : undefined;
  if (!requestedCompilerPath) visualStudioCompilerCache = compiler ?? null;
  return compiler;
}

function findCompiler(requested?: string): NativeCompiler {
  const explicit = requested ?? process.env.BMEC_CC;
  const candidates = requested
    ? [requested]
    : process.env.BMEC_CC
      ? [process.env.BMEC_CC]
      : process.platform === "win32"
        ? ["clang", "clang.exe", "gcc", "gcc.exe"]
        : ["clang", "clang-20", "clang-19", "clang-18", "clang-17", "gcc", "cc"];
  for (const candidate of candidates) {
    const executable = candidate.includes("/") || candidate.includes("\\") ? resolve(candidate) : candidate;
    const version = probeCompiler(executable);
    if (version) return { path: executable, version, kind: "gnu" };
  }
  const explicitMsvc = process.platform === "win32" && explicit && /^cl(?:\.exe)?$/i.test(explicit.split(/[\\/]/).at(-1) ?? "")
    ? findVisualStudioCompiler(explicit.includes("/") || explicit.includes("\\") ? resolve(explicit) : undefined)
    : undefined;
  if (explicitMsvc) return explicitMsvc;
  const msvc = !explicit ? findVisualStudioCompiler() : undefined;
  if (msvc) return msvc;
  throw new NativeBuildError(
    "PIPE-NATIVE-002",
    `No supported C compiler was found. Install Clang (preferred) or GCC, or set BMEC_CC to a compiler path.${process.platform === "win32" && !explicit ? " Visual Studio C++ Build Tools are also searched automatically." : ""} Tried: ${candidates.join(", ")}`,
  );
}

export function resolveNativeCompiler(requested?: string): NativeCompiler {
  return findCompiler(requested);
}

export function compileNativeSource(
  compiler: NativeCompiler,
  sourcePath: string,
  executable: string,
  language: "c" | "c++" = "c",
  extraFlags: string[] = [],
): string[] {
  const standard = compiler.kind === "msvc"
    ? language === "c" ? "/std:c11" : "/std:c++17"
    : language === "c" ? "-std=c11" : "-std=c++17";
  const flags = compiler.kind === "msvc"
    ? ["/nologo", "/O2", standard, ...extraFlags, sourcePath, `/Fe:${executable}`]
    : ["-O3", standard, ...extraFlags, sourcePath, "-o", executable];
  if (compiler.kind === "gnu" && process.platform !== "win32") flags.push("-lm");
  const built = spawnSync(compiler.path, flags, {
    cwd: dirname(resolve(executable)),
    encoding: "utf8",
    windowsHide: true,
    env: compiler.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (built.error || built.status !== 0 || !existsSync(executable)) {
    const details = [built.stdout, built.stderr, built.error?.message].filter(Boolean).join("\n").trim();
    throw new NativeBuildError(
      "PIPE-NATIVE-004",
      `${language === "c" ? "C" : "C++"} compiler failed to build the standalone executable${details ? `:\n${details}` : ""}`,
    );
  }
  return flags;
}

export function buildNative(
  ir: ProjectIR,
  options: NativeBuildOptions,
): NativeBuildResult {
  try {
    assertSerializedIR(JSON.parse(JSON.stringify(ir)));
  } catch (error) {
    throw new NativeBuildError(
      "PIPE-NATIVE-003",
      `Native build requires validated serialized BMEC IR: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const cSource = lowerNativeC(ir, options.entry ?? "main");
  const outputDirectory = resolve(options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const sourcePath = join(outputDirectory, "main.c");
  writeFileSync(sourcePath, cSource, "utf8");
  const compiler = resolveNativeCompiler(options.compiler);
  const executableName = process.platform === "win32" ? "bmec-native.exe" : "bmec-native";
  const executable = join(outputDirectory, executableName);
  compileNativeSource(compiler, sourcePath, executable);
  const result: NativeBuildResult = {
    executable,
    generatedC: sourcePath,
    compiler: compiler.path,
    compilerVersion: compiler.version,
    flags: compiler.kind === "msvc"
      ? ["/nologo", "/O2", "/std:c11"]
      : process.platform === "win32" ? ["-O3", "-std=c11"] : ["-O3", "-std=c11", "-lm"],
  };
  writeFileSync(join(outputDirectory, "build.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
