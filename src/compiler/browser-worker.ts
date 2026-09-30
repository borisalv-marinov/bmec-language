import { compile } from "./source.js";
import {
  createKnowledgeContext,
  type KnowledgeIndex,
} from "../cli/knowledge.js";
import { runPureFunction } from "./playground-runner.js";

type InitMessage = { type: "init"; index: KnowledgeIndex };
type SourceMessage = { type: "check" | "run"; id: number; source: string; functionName?: string; args?: unknown[] };
type PlaygroundMessage = InitMessage | SourceMessage;

const maxSourceLength = 50_000;
let index: KnowledgeIndex | undefined;

const workerScope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PlaygroundMessage>) => void,
  ): void;
  postMessage(message: unknown): void;
};

workerScope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    if (message.index?.schemaVersion === "bmec.knowledge-index.v1") {
      index = message.index;
      workerScope.postMessage({ type: "ready" });
    } else {
      workerScope.postMessage({ type: "error", message: "BMEC knowledge data is unavailable." });
    }
    return;
  }

  if (!Number.isSafeInteger(message.id) || typeof message.source !== "string") {
    workerScope.postMessage({ type: "error", message: "Invalid checker request." });
    return;
  }
  if (message.source.length > maxSourceLength) {
    workerScope.postMessage({ type: "error", id: message.id, message: "Source is over the 50,000-character limit." });
    return;
  }
  if (!index) {
    workerScope.postMessage({ type: "error", id: message.id, message: "The local checker is still starting." });
    return;
  }

  try {
    const result = compile(message.source, "playground.bmec");
    if (message.type === "run") {
      if (result.diagnostics.length || !result.ir) {
        workerScope.postMessage({ type: "run-result", id: message.id, ok: false, message: "Fix the BMEC diagnostics before running this function." });
        return;
      }
      try {
        const value = runPureFunction(result.ir.functions, message.functionName ?? "", message.args ?? []);
        workerScope.postMessage({ type: "run-result", id: message.id, ok: true, value });
      } catch (error) {
        workerScope.postMessage({ type: "run-result", id: message.id, ok: false, message: error instanceof Error ? error.message : "The selected function could not run." });
      }
      return;
    }
    const context = createKnowledgeContext(message.source.slice(0, 3_000), index);
    workerScope.postMessage({
      type: "result",
      id: message.id,
      diagnostics: result.diagnostics,
      ir: result.ir ?? null,
      functions: (result.ir?.functions ?? []).map(fn => ({ id: fn.id, name: fn.name, parameters: fn.parameters.map(parameter => ({ name: parameter.name, type: parameter.type })), async: Boolean(fn.async) })),
      context,
    });
  } catch {
    workerScope.postMessage({
      type: "error",
      id: message.id,
      message: "The local checker hit an internal error. No source was sent to a server.",
    });
  }
});
