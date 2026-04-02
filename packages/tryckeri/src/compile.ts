/**
 * Top-level compile functions — the primary public API.
 *
 * Both MDAST and HAST arenas stay in Rust memory via opaque handles.
 * Only matched nodes and mutation commands cross the NAPI boundary.
 */

import {
  visitHastHandle,
  resolveSubscriptions,
  type HastHandle,
} from "./hast/hast-visitor.js";
import {
  visitMdastHandle,
  resolveMdastSubscriptions,
  type MdastPluginInstance,
} from "./mdast/mdast-visitor.js";
import type { MdastPluginDefinition, HastPluginDefinition } from "./plugin.js";
import {
  parseToHtml,
  compileMdx,
  createHastHandle,
  createMdxHastHandle,
  renderHandle,
  compileHandle,
  applyCommandsToHandle,
  dropHandle,
  createMdastHandle,
  createMdxMdastHandle,
  applyCommandsToMdastHandle,
  convertMdastToHastHandle,
  applyCommandsAndConvertToHastHandle,
  getHandleSource,
} from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initPlugins<T>(
  plugins: { name: string; createOnce(): T }[],
): { instance: T; name: string }[] {
  return plugins.map((def) => ({
    instance: def.createOnce(),
    name: def.name,
  }));
}

// ---------------------------------------------------------------------------
// MDAST plugin runner (handle-based)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MdastHandle = any;

type MdastPipelineResult = { handle: MdastHandle; pendingCommands: Uint8Array | null };

function runMdastPluginsOnHandle(
  handle: MdastHandle,
  plugins: MdastPluginDefinition[],
  filename: string,
): MdastPipelineResult | Promise<MdastPipelineResult> {
  const instances = initPlugins(plugins);
  let pendingCommands: Uint8Array | null = null;
  const source = getHandleSource(handle);

  let i = 0;
  const runNext = (): MdastPipelineResult | Promise<MdastPipelineResult> => {
    while (i < instances.length) {
      const idx = i++;
      const { instance } = instances[idx]!;
      const subs = resolveMdastSubscriptions(instance as MdastPluginInstance);
      const result = visitMdastHandle(
        handle,
        instance as MdastPluginInstance,
        subs,
        source,
        filename,
      );

      if (result instanceof Promise) {
        return result.then((r) => {
          applyMdastResult(r, idx, instances.length, handle);
          return runNext();
        });
      }

      applyMdastResult(result, idx, instances.length, handle);
    }
    return { handle, pendingCommands };
  };

  function applyMdastResult(
    result: { commandBuffer: Uint8Array; hasMutations: boolean },
    idx: number,
    total: number,
    h: MdastHandle,
  ) {
    if (result.hasMutations) {
      if (idx === total - 1) {
        pendingCommands = result.commandBuffer;
      } else {
        applyCommandsToMdastHandle(h, result.commandBuffer);
      }
    }
  }

  return runNext();
}

// ---------------------------------------------------------------------------
// HAST plugin runner (handle-based)
// ---------------------------------------------------------------------------

function runHastPluginsOnHandle(
  handle: HastHandle,
  plugins: HastPluginDefinition[],
  source: string,
  filename: string,
): void | Promise<void> {
  if (plugins.length === 0) return;

  const instances = initPlugins(plugins);

  let i = 0;
  const runNext = (): void | Promise<void> => {
    while (i < instances.length) {
      const { instance } = instances[i]!;
      i++;

      const subs = resolveSubscriptions(instance);
      const result = visitHastHandle(handle, instance, subs, source, filename);
      if (result instanceof Promise) {
        return result.then(runNext);
      }
    }
  };

  return runNext();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Configuration for static subtree collapsing during MDX compilation. */
export interface OptimizeStaticConfig {
  component: string;
  prop: string;
  wrapPropValue?: boolean;
  ignoreElements?: string[];
}

export interface CompileOptions {
  mdastPlugins?: MdastPluginDefinition[];
  hastPlugins?: HastPluginDefinition[];
  optimizeStatic?: OptimizeStaticConfig;
  filename?: string;
}

export function compileMarkdownToHtml(
  source: string,
  options: CompileOptions = {},
): string | Promise<string> {
  const { mdastPlugins = [], hastPlugins = [], filename = "<unknown>" } = options;

  if (mdastPlugins.length === 0 && hastPlugins.length === 0) {
    return parseToHtml(source);
  }

  const handleResult = createHastHandleFromMdast(source, mdastPlugins, false, filename);

  const finish = (hastHandle: HastHandle): string | Promise<string> => {
    const asyncResult = runHastPluginsOnHandle(hastHandle, hastPlugins, source, filename);
    if (asyncResult instanceof Promise) {
      return asyncResult.then(() => {
        const html = renderHandle(hastHandle);
        dropHandle(hastHandle);
        return html;
      });
    }
    const html = renderHandle(hastHandle);
    dropHandle(hastHandle);
    return html;
  };

  if (handleResult instanceof Promise) {
    return handleResult.then(finish);
  }
  return finish(handleResult);
}

export function compileMdxToJs(
  source: string,
  options: CompileOptions = {},
): string | Promise<string> {
  const { mdastPlugins = [], hastPlugins = [], optimizeStatic, filename = "<unknown>" } = options;
  const mdxOptions = optimizeStatic ? { optimizeStatic } : undefined;

  if (mdastPlugins.length === 0 && hastPlugins.length === 0) {
    return compileMdx(source, mdxOptions);
  }

  const handleResult = createHastHandleFromMdast(source, mdastPlugins, true, filename);

  const finish = (hastHandle: HastHandle): string | Promise<string> => {
    const asyncResult = runHastPluginsOnHandle(hastHandle, hastPlugins, source, filename);
    if (asyncResult instanceof Promise) {
      return asyncResult.then(() => {
        const js = compileHandle(hastHandle, mdxOptions);
        dropHandle(hastHandle);
        return js;
      });
    }
    const js = compileHandle(hastHandle, mdxOptions);
    dropHandle(hastHandle);
    return js;
  };

  if (handleResult instanceof Promise) {
    return handleResult.then(finish);
  }
  return finish(handleResult);
}

// ---------------------------------------------------------------------------
// Pipeline: parse → mdast plugins → hast conversion → hast plugins
// All arenas stay in Rust. No intermediate buffer copies to JS.
// ---------------------------------------------------------------------------

/** Parse + mdast plugins + convert to HAST handle. */
function createHastHandleFromMdast(
  source: string,
  mdastPlugins: MdastPluginDefinition[],
  mdx: boolean,
  filename: string,
): HastHandle | Promise<HastHandle> {
  if (mdastPlugins.length === 0) {
    return mdx ? createMdxHastHandle(source) : createHastHandle(source);
  }

  const mdastHandle = mdx ? createMdxMdastHandle(source) : createMdastHandle(source);
  const mdastResult = runMdastPluginsOnHandle(mdastHandle, mdastPlugins, filename);

  const convert = (r: MdastPipelineResult): HastHandle => {
    if (r.pendingCommands) {
      return applyCommandsAndConvertToHastHandle(r.handle, r.pendingCommands);
    }
    return convertMdastToHastHandle(r.handle);
  };

  if (mdastResult instanceof Promise) {
    return mdastResult.then(convert);
  }
  return convert(mdastResult);
}
