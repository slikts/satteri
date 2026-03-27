import { materializeHastNode, type HastNode } from "./hast-materializer.js";
import {
  HastReader,
  HAST_ROOT,
  HAST_ELEMENT,
  HAST_TEXT,
  HAST_COMMENT,
  HAST_RAW,
  HAST_MDX_JSX_ELEMENT,
  HAST_MDX_JSX_TEXT_ELEMENT,
  HAST_MDX_EXPRESSION,
  HAST_MDX_ESM,
} from "./hast-reader.js";
import { CommandBuffer } from "./command-buffer.js";
import type { DataMap } from "./data-map.js";

export interface Diagnostic {
  message: string;
  nodeId?: number | undefined;
  severity: "error" | "warning" | "info";
}

export interface HastVisitorContext {
  removeNode(node: HastNode): void;
  replaceNode(node: HastNode, newNode: HastNode): void;
  setProperty(node: HastNode, key: string, value: unknown): void;
  report(opts: { message: string; node?: HastNode; severity?: "error" | "warning" | "info" }): void;
  getDiagnostics(): Diagnostic[];
}

/** Inject `_hast: true` marker on a HastNode and all its children for JSON serialization. */
function markHast(node: HastNode): Record<string, unknown> {
  const obj: Record<string, unknown> = { _hast: true, type: node.type };
  if (node.tagName !== undefined) obj.tagName = node.tagName;
  if (node.properties !== undefined) obj.properties = node.properties;
  if (node.value !== undefined) obj.value = node.value;
  // MDX JSX elements store name and attributes on the node
  if (node.name !== undefined) obj.name = node.name;
  if (node.attributes !== undefined) obj.attributes = node.attributes;
  if (node.children) {
    obj.children = node.children.map(markHast);
  }
  return obj;
}

class HastVisitorContextImpl implements HastVisitorContext {
  readonly #commandBuffer: CommandBuffer = new CommandBuffer();
  readonly #diagnostics: Diagnostic[] = [];
  /** Track accumulated node state for multiple setProperty calls on the same node. */
  readonly #pendingNodes: Map<number, HastNode> = new Map();

  removeNode(node: HastNode): void {
    this.#commandBuffer.removeNode(node._nodeId);
  }

  replaceNode(node: HastNode, newNode: HastNode): void {
    // Encode as a REPLACE command with _hast marker for Rust deserialization
    this.#commandBuffer.replaceRawJson(node._nodeId, JSON.stringify(markHast(newNode)));
    this.#pendingNodes.set(node._nodeId, newNode);
  }

  setProperty(node: HastNode, key: string, value: unknown): void {
    // Use pending state if we've already modified this node in this visitor pass
    const current = this.#pendingNodes.get(node._nodeId) ?? node;
    const updated = { ...current };
    if (current.type === "mdxJsxElement" || current.type === "mdxJsxTextElement") {
      // MDX JSX nodes use `attributes`, not `properties`
      const attrs = [...(updated.attributes ?? [])];
      // Remove existing attribute with same name, if any
      const idx = attrs.findIndex(
        (a) => a.type === "mdxJsxAttribute" && a.name === key,
      );
      if (idx !== -1) attrs.splice(idx, 1);
      // Add new attribute
      const attrValue =
        value === true || value === null || value === undefined
          ? null
          : typeof value === "string"
            ? value
            : String(value);
      attrs.push({ type: "mdxJsxAttribute", name: key, value: attrValue });
      updated.attributes = attrs;
    } else {
      // Regular HAST elements use `properties`
      if (!updated.properties) updated.properties = {};
      updated.properties = { ...updated.properties, [key]: value as string | boolean | string[] };
    }
    this.replaceNode(node, updated as HastNode);
  }

  report({
    message,
    node,
    severity = "error",
  }: {
    message: string;
    node?: HastNode;
    severity?: "error" | "warning" | "info";
  }): void {
    this.#diagnostics.push({ message, nodeId: node?._nodeId, severity });
  }

  getCommandBuffer(): CommandBuffer {
    return this.#commandBuffer;
  }

  getDiagnostics(): Diagnostic[] {
    return this.#diagnostics;
  }
}

export interface HastVisitorInstance {
  before?(ctx: HastVisitorContext): void;
  after?(ctx: HastVisitorContext): void;
  transformRoot?(root: HastNode, ctx: HastVisitorContext): HastNode | void;
  element?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  text?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  comment?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  raw?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  doctype?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxJsxElement?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxJsxTextElement?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxExpression?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxjsEsm?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
}

export interface VisitResult {
  commandBuffer: Uint8Array;
  diagnostics: Diagnostic[];
  hasMutations: boolean;
}

// Map from node_type number to visitor method name
const TYPE_TO_METHOD: Record<number, keyof HastVisitorInstance> = {
  [HAST_ROOT]: "transformRoot",
  [HAST_ELEMENT]: "element",
  [HAST_TEXT]: "text",
  [HAST_COMMENT]: "comment",
  [HAST_RAW]: "raw",
  [HAST_MDX_JSX_ELEMENT]: "mdxJsxElement",
  [HAST_MDX_JSX_TEXT_ELEMENT]: "mdxJsxTextElement",
  [HAST_MDX_EXPRESSION]: "mdxExpression",
  [HAST_MDX_ESM]: "mdxjsEsm",
};

/**
 * Walk a HAST binary buffer and dispatch to visitor methods.
 *
 * Mutations are collected into a binary CommandBuffer (same as MDAST plugins).
 */
export function visitHast(
  reader: HastReader,
  plugin: HastVisitorInstance,
  dataMap: DataMap,
): VisitResult {
  const ctx = new HastVisitorContextImpl();
  const returnBuffer = new CommandBuffer();

  plugin.before?.(ctx);

  if (typeof plugin.transformRoot === "function") {
    // Full materialization path via transformRoot
    const root = materializeHastNode(reader, 0, dataMap);
    const result = plugin.transformRoot(root, ctx);
    if (result != null) {
      returnBuffer.replaceRawJson(0, JSON.stringify(markHast(result)));
    }
  } else {
    // Fast path: walk raw bytes, only materialize on subscription match
    const stack: number[] = [0];

    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      const nodeType = reader.getNodeType(nodeId);
      const methodName = TYPE_TO_METHOD[nodeType];

      if (methodName && methodName !== "transformRoot") {
        const fn = plugin[methodName] as
          | ((node: HastNode, ctx: HastVisitorContext) => HastNode | void)
          | undefined;
        if (typeof fn === "function") {
          const node = materializeHastNode(reader, nodeId, dataMap);
          const result = fn.call(plugin, node, ctx);
          if (result != null) {
            returnBuffer.replaceRawJson(nodeId, JSON.stringify(markHast(result)));
          }
        }
      }

      const childIds = reader.getChildIds(nodeId);
      for (let i = childIds.length - 1; i >= 0; i--) {
        stack.push(childIds[i]!);
      }
    }
  }

  plugin.after?.(ctx);

  // Merge: return-value commands first, then context commands
  const ctxBuf = ctx.getCommandBuffer().getBuffer();
  const retBuf = returnBuffer.getBuffer();
  const totalLen = retBuf.length + ctxBuf.length;

  let merged: Uint8Array;
  if (totalLen === 0) {
    merged = new Uint8Array(0);
  } else {
    merged = new Uint8Array(totalLen);
    merged.set(retBuf, 0);
    merged.set(ctxBuf, retBuf.length);
  }

  return {
    commandBuffer: merged,
    diagnostics: ctx.getDiagnostics(),
    hasMutations: totalLen > 0,
  };
}
