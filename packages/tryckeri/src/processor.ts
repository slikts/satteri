import { ProcessorContext, runPluginsOnBuffer } from "./pipeline.js";
import { MdastReader } from "./mdast/mdast-reader.js";
import { materializeTree } from "./mdast/mdast-materializer.js";
import { DataMap } from "./data-map.js";
import type { MdastPluginDefinition } from "./plugin.js";
import type { MdastNode } from "./types.js";
import type { MdastDiagnostic } from "./mdast/mdast-visitor.js";

export { ProcessorContext };

export interface ProcessBufferResult {
  buffer: ArrayBuffer | Uint8Array;
  dataMap: DataMap;
  diagnostics: MdastDiagnostic[];
  mutationCount: number;
  structuralMutationCount: number;
}

export interface ProcessTreeResult {
  tree: MdastNode;
  dataMap: DataMap;
  diagnostics: MdastDiagnostic[];
  mutationCount: number;
}

export function createProcessor({
  plugins = [],
}: { plugins?: MdastPluginDefinition[] } = {}): Processor {
  return new Processor(plugins);
}

class Processor {
  readonly #pluginDefs: MdastPluginDefinition[];
  readonly #processorCtx: ProcessorContext;
  #initializedPlugins:
    | { instance: ReturnType<MdastPluginDefinition["createOnce"]>; name: string }[]
    | null = null;

  constructor(pluginDefs: MdastPluginDefinition[]) {
    for (const def of pluginDefs) {
      if (!def.name || typeof def.createOnce !== "function") {
        throw new Error(`Invalid plugin: ${JSON.stringify(def.name)}`);
      }
    }
    this.#pluginDefs = pluginDefs;
    this.#processorCtx = new ProcessorContext();
  }

  #getPluginInstances(): {
    instance: ReturnType<MdastPluginDefinition["createOnce"]>;
    name: string;
  }[] {
    if (this.#initializedPlugins === null) {
      this.#initializedPlugins = this.#pluginDefs.map((def) => ({
        instance: def.createOnce(this.#processorCtx),
        name: def.name,
      }));
    }
    return this.#initializedPlugins;
  }

  processBuffer(
    buffer: ArrayBuffer | Uint8Array,
    options: { filename?: string } = {},
  ): ProcessBufferResult {
    return runPluginsOnBuffer(buffer, this.#getPluginInstances(), options);
  }

  processBufferToTree(
    buffer: ArrayBuffer | Uint8Array,
    options: { filename?: string } = {},
  ): ProcessTreeResult {
    const result = this.processBuffer(buffer, options);
    const reader = new MdastReader(result.buffer);
    const tree = materializeTree(reader, result.dataMap);
    return {
      tree,
      dataMap: result.dataMap,
      diagnostics: result.diagnostics,
      mutationCount: result.mutationCount,
    };
  }

  getDiagnostics(): MdastDiagnostic[] {
    return this.#processorCtx.getDiagnostics();
  }
}
