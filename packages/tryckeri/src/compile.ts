/**
 * Top-level compile functions — the primary public API.
 */

import { DataMap } from "./data-map.js";
import { HastReader } from "./hast-reader.js";
import { visitHast } from "./hast-visitor.js";
import { runPluginsOnBuffer, ProcessorContext } from "./pipeline.js";
import type { MdastPluginDefinition, HastPluginDefinition } from "./plugin.js";
import {
  parseToBuffer,
  parseMdxToBuffer,
  mdastBufferToHastBuffer,
  hastBufferToHtmlStr,
  compileHastBufferToJs,
  applyMutations,
} from "../index.js";

// ---------------------------------------------------------------------------
// Plugin initialization
// ---------------------------------------------------------------------------

function initPlugins<T>(
  plugins: { name: string; createOnce(ctx: ProcessorContext): T }[],
): { instance: T; name: string }[] {
  const ctx = new ProcessorContext();
  return plugins.map((def) => ({
    instance: def.createOnce(ctx),
    name: def.name,
  }));
}

// ---------------------------------------------------------------------------
// HAST plugin runner
// ---------------------------------------------------------------------------

function runHastPlugins(
  hastBuf: Uint8Array,
  plugins: HastPluginDefinition[],
): Uint8Array {
  if (plugins.length === 0) return hastBuf;

  const instances = initPlugins(plugins);
  let currentBuffer: Uint8Array = hastBuf;

  for (const { instance } of instances) {
    const reader = new HastReader(currentBuffer);
    const dataMap = new DataMap();
    const result = visitHast(reader, instance, dataMap);

    if (result.hasMutations) {
      currentBuffer = applyMutations(currentBuffer, result.commandBuffer);
    }
  }

  return currentBuffer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Configuration for static subtree collapsing during MDX compilation. */
export interface OptimizeStaticConfig {
  /** Component/element name to wrap collapsed HTML in (e.g. "Fragment", "div"). */
  component: string;
  /** Prop name for the HTML string (e.g. "set:html", "dangerouslySetInnerHTML"). */
  prop: string;
  /** If true, prop value is wrapped as `{ __html: "..." }` (React-style). Default: false. */
  wrapPropValue?: boolean;
  /** Element tag names to exclude from collapsing (e.g. ["h1", "p"]). */
  ignoreElements?: string[];
}

export interface CompileOptions {
  mdastPlugins?: MdastPluginDefinition[];
  hastPlugins?: HastPluginDefinition[];
  /**
   * When set, fully-static subtrees are collapsed into raw HTML strings
   * instead of nested `_jsx()` calls, reducing JS output size.
   */
  optimizeStatic?: OptimizeStaticConfig;
}

export function compileMarkdownToHtml(
  source: string,
  options: CompileOptions = {},
): string {
  const { mdastPlugins = [], hastPlugins = [] } = options;

  let mdastBuf: Uint8Array = parseToBuffer(source);

  if (mdastPlugins.length > 0) {
    const instances = initPlugins(mdastPlugins);
    const result = runPluginsOnBuffer(mdastBuf, instances);
    mdastBuf =
      result.buffer instanceof Uint8Array
        ? result.buffer
        : new Uint8Array(result.buffer);
  }

  let hastBuf = mdastBufferToHastBuffer(mdastBuf);
  hastBuf = runHastPlugins(hastBuf, hastPlugins);

  return hastBufferToHtmlStr(hastBuf);
}

export function compileMdxToJs(
  source: string,
  options: CompileOptions = {},
): string {
  const { mdastPlugins = [], hastPlugins = [], optimizeStatic } = options;

  let mdastBuf: Uint8Array = parseMdxToBuffer(source);

  if (mdastPlugins.length > 0) {
    const instances = initPlugins(mdastPlugins);
    const result = runPluginsOnBuffer(mdastBuf, instances);
    mdastBuf =
      result.buffer instanceof Uint8Array
        ? result.buffer
        : new Uint8Array(result.buffer);
  }

  let hastBuf = mdastBufferToHastBuffer(mdastBuf);
  hastBuf = runHastPlugins(hastBuf, hastPlugins);

  const mdxOptions = optimizeStatic
    ? { optimizeStatic }
    : undefined;

  return compileHastBufferToJs(hastBuf, mdxOptions);
}
