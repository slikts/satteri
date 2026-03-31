import { visitMdast } from "./mdast/mdast-visitor.js";
import { DataMap } from "./data-map.js";
import { MdastReader } from "./mdast/mdast-reader.js";
import { materializeNode } from "./mdast/mdast-materializer.js";
import type { MdastPluginDefinition } from "./plugin.js";
import type { MdastNode } from "./types.js";
import type { MdastDiagnostic } from "./mdast/mdast-visitor.js";

// applyMutations is the NAPI function that takes an arena buffer + command
// buffer and returns a new arena buffer with all mutations applied.
import { applyMutations } from "../index.js";

export class ProcessorContext {
  readonly #diagnostics: MdastDiagnostic[] = [];

  report(diagnostic: MdastDiagnostic): void {
    this.#diagnostics.push(diagnostic);
  }

  getDiagnostics(): MdastDiagnostic[] {
    return [...this.#diagnostics];
  }
}

interface FileContext {
  source: string;
  filename: string;
  get root(): MdastNode;
}

interface RunResult {
  buffer: ArrayBuffer | Uint8Array;
  /** If set, the last plugin's mutations were deferred for fusion with the next step. */
  pendingCommands: Uint8Array | null;
  dataMap: DataMap;
  diagnostics: MdastDiagnostic[];
  mutationCount: number;
  structuralMutationCount: number;
}

/**
 * Process one arena buffer through an ordered list of initialized plugin instances.
 */
export function runPluginsOnBuffer(
  buffer: ArrayBuffer | Uint8Array,
  pluginInstances: { instance: ReturnType<MdastPluginDefinition["createOnce"]>; name: string }[],
  { filename = "<unknown>", dataMap, deferLast = false }: { filename?: string; dataMap?: DataMap; deferLast?: boolean } = {},
): RunResult {
  const dm = dataMap ?? new DataMap();
  const allMdastDiagnostics: MdastDiagnostic[] = [];
  let totalMutations = 0;
  let structuralMutations = 0;
  let currentBuffer = buffer;

  for (let i = 0; i < pluginInstances.length; i++) {
    const { instance } = pluginInstances[i]!;
    const reader = new MdastReader(currentBuffer);

    const fileContext: FileContext = {
      source: reader.getSource(),
      filename,
      get root() {
        return materializeNode(reader, 0, dm);
      },
    };

    const wrappedPlugin = wrapInstance(instance, fileContext);
    const result = visitMdast(reader, wrappedPlugin, dm);
    allMdastDiagnostics.push(...result.diagnostics);

    if (result.hasMutations) {
      totalMutations += 1;
      structuralMutations += 1;

      if (deferLast && i === pluginInstances.length - 1) {
        // Last plugin — defer mutations for fusion with the next pipeline step
        return {
          buffer: currentBuffer,
          pendingCommands: result.commandBuffer,
          dataMap: dm,
          diagnostics: allMdastDiagnostics,
          mutationCount: totalMutations,
          structuralMutationCount: structuralMutations,
        };
      }

      const arenaBuf =
        currentBuffer instanceof Uint8Array ? currentBuffer : new Uint8Array(currentBuffer);
      currentBuffer = applyMutations(arenaBuf, result.commandBuffer);
    }
  }

  return {
    buffer: currentBuffer,
    pendingCommands: null,
    dataMap: dm,
    diagnostics: allMdastDiagnostics,
    mutationCount: totalMutations,
    structuralMutationCount: structuralMutations,
  };
}

function wrapInstance(
  instance: ReturnType<MdastPluginDefinition["createOnce"]>,
  fileContext: FileContext,
): ReturnType<MdastPluginDefinition["createOnce"]> {
  const wrapped: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(instance as Record<string, unknown>)) {
    if (key !== "before" && key !== "after" && key !== "transformRoot") {
      if (typeof val === "function") {
        wrapped[key] = val;
      }
    }
  }

  const inst = instance as Record<string, unknown>;
  if (typeof inst.before === "function") {
    wrapped.before = (visitorContext: unknown) =>
      (inst.before as (fc: FileContext, vc: unknown) => unknown)(fileContext, visitorContext);
  }
  if (typeof inst.after === "function") {
    wrapped.after = (visitorContext: unknown) =>
      (inst.after as (fc: FileContext, vc: unknown) => unknown)(fileContext, visitorContext);
  }
  if (typeof inst.transformRoot === "function") {
    wrapped.transformRoot = (root: MdastNode, visitorContext: unknown) =>
      (inst.transformRoot as (r: MdastNode, fc: FileContext, vc: unknown) => unknown)(
        root,
        fileContext,
        visitorContext,
      );
  }

  return wrapped as ReturnType<MdastPluginDefinition["createOnce"]>;
}
