import { materializeHastNode, type HastNode } from "./hast-materializer.js";
import type { MdxJsxAttributeUnion } from "../types.js";
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
  type HastProperty,
} from "./hast-reader.js";
import { CommandBuffer } from "../command-buffer.js";
import type { DataMap } from "../data-map.js";

export interface HastDiagnostic {
  message: string;
  nodeId?: number | undefined;
  severity: "error" | "warning" | "info";
}

export interface HastVisitorContext {
  removeNode(node: HastNode): void;
  replaceNode(node: HastNode, newNode: HastNode): void;
  setProperty(node: HastNode, key: string, value: unknown): void;
  report(opts: { message: string; node?: HastNode; severity?: "error" | "warning" | "info" }): void;
  getDiagnostics(): HastDiagnostic[];
}

/** Inject `_hast: true` marker on a HastNode and all its children for JSON serialization. */
function markHast(node: HastNode): Record<string, unknown> {
  const n = node as unknown as Record<string, unknown>;
  const obj: Record<string, unknown> = { _hast: true, type: node.type };
  if ("tagName" in node) obj.tagName = n.tagName;
  if ("properties" in node) obj.properties = n.properties;
  if ("value" in node) obj.value = n.value;
  if ("name" in node) obj.name = n.name;
  if ("attributes" in node) obj.attributes = n.attributes;
  if ("children" in node) {
    obj.children = (n.children as HastNode[]).map(markHast);
  }
  return obj;
}

class HastVisitorContextImpl implements HastVisitorContext {
  readonly #commandBuffer: CommandBuffer = new CommandBuffer();
  readonly #diagnostics: HastDiagnostic[] = [];
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
    // Force lazy getters to materialize before spreading (class-based nodes
    // have lazy getters on the prototype that spread doesn't trigger)
    if (current.type === "element") {
      void current.tagName;
      void current.properties;
      void current.children;
    }
    const updated: Record<string, unknown> = { ...current };
    if (current.type === "mdxJsxFlowElement" || current.type === "mdxJsxTextElement") {
      // MDX JSX nodes use `attributes`, not `properties`
      const attrs = [...((updated.attributes as MdxJsxAttributeUnion[] | undefined) ?? [])];
      // Remove existing attribute with same name, if any
      const idx = attrs.findIndex((a) => a.type === "mdxJsxAttribute" && a.name === key);
      if (idx !== -1) attrs.splice(idx, 1);
      // Add new attribute
      const attrValue =
        value === true || value === null || value === undefined
          ? null
          : typeof value === "string"
            ? value
            : `${value as string | number | boolean}`;
      attrs.push({ type: "mdxJsxAttribute", name: key, value: attrValue });
      updated.attributes = attrs;
    } else {
      // Regular HAST elements use `properties`
      const props = (updated.properties ?? {}) as Record<string, string | boolean | string[]>;
      updated.properties = { ...props, [key]: value as string | boolean | string[] };
    }
    this.replaceNode(node, updated as unknown as HastNode);
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

  getDiagnostics(): HastDiagnostic[] {
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
  mdxJsxFlowElement?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxJsxTextElement?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxExpression?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
  mdxjsEsm?(node: HastNode, ctx: HastVisitorContext): HastNode | void;
}

export interface HastVisitResult {
  commandBuffer: Uint8Array;
  diagnostics: HastDiagnostic[];
  hasMutations: boolean;
}

// ---------------------------------------------------------------------------
// Lightweight node materializer for the visitor hot path.
//
// Avoids per-node Object.defineProperty calls by using class prototypes
// with lazy getters that cache on first access.
// ---------------------------------------------------------------------------

function propsToRecord(props: HastProperty[]): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  for (const p of props) {
    result[p.name] = p.value;
  }
  return result;
}

class LazyElementNode {
  type = "element" as const;
  _nodeId: number;
  declare _reader: HastReader;
  declare _dataMap: DataMap;
  declare tagName: string;
  declare properties: Record<string, string | boolean | string[]>;
  declare children: HastNode[];
  declare data: Record<string, unknown> | null;

  constructor(nodeId: number, reader: HastReader, dataMap: DataMap) {
    this._nodeId = nodeId;
    // Store reader/dataMap as non-enumerable to avoid serialization
    Object.defineProperty(this, "_reader", { value: reader, enumerable: false });
    Object.defineProperty(this, "_dataMap", { value: dataMap, enumerable: false });
  }
}

// Define lazy getters on prototype — one-time cost at module load
Object.defineProperty(LazyElementNode.prototype, "tagName", {
  get(this: LazyElementNode) {
    const val = this._reader.getElementData(this._nodeId).tagName;
    Object.defineProperty(this, "tagName", {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return val;
  },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(LazyElementNode.prototype, "properties", {
  get(this: LazyElementNode) {
    const val = propsToRecord(this._reader.getElementData(this._nodeId).properties);
    Object.defineProperty(this, "properties", {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return val;
  },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(LazyElementNode.prototype, "children", {
  get(this: LazyElementNode) {
    const ids = this._reader.getChildIds(this._nodeId);
    const val = ids.map((id) => materializeHastNode(this._reader, id, this._dataMap));
    Object.defineProperty(this, "children", {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return val;
  },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(LazyElementNode.prototype, "data", {
  get(this: LazyElementNode) {
    return this._dataMap.get(this._nodeId);
  },
  set(this: LazyElementNode, value: Record<string, unknown>) {
    this._dataMap.set(this._nodeId, value);
  },
  configurable: true,
  enumerable: true,
});

class LazyTextNode {
  _nodeId: number;
  declare _reader: HastReader;
  declare _dataMap: DataMap;
  declare value: string;
  declare data: Record<string, unknown> | null;

  type: string;
  constructor(type: string, nodeId: number, reader: HastReader, dataMap: DataMap) {
    this.type = type;
    this._nodeId = nodeId;
    Object.defineProperty(this, "_reader", { value: reader, enumerable: false });
    Object.defineProperty(this, "_dataMap", { value: dataMap, enumerable: false });
  }
}

Object.defineProperty(LazyTextNode.prototype, "value", {
  get(this: LazyTextNode) {
    const val = this._reader.getTextValue(this._nodeId);
    Object.defineProperty(this, "value", {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return val;
  },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(LazyTextNode.prototype, "data", {
  get(this: LazyTextNode) {
    return this._dataMap.get(this._nodeId);
  },
  set(this: LazyTextNode, value: Record<string, unknown>) {
    this._dataMap.set(this._nodeId, value);
  },
  configurable: true,
  enumerable: true,
});

/** Fast materializer for the visitor — avoids per-node Object.defineProperty overhead. */
function materializeForVisitor(
  nodeType: number,
  nodeId: number,
  reader: HastReader,
  dataMap: DataMap,
): HastNode {
  switch (nodeType) {
    case HAST_ELEMENT:
      return new LazyElementNode(nodeId, reader, dataMap) as unknown as HastNode;
    case HAST_TEXT:
    case HAST_COMMENT:
    case HAST_RAW:
    case HAST_MDX_EXPRESSION:
    case HAST_MDX_ESM: {
      const typeNames: Record<number, string> = {
        [HAST_TEXT]: "text",
        [HAST_COMMENT]: "comment",
        [HAST_RAW]: "raw",
        [HAST_MDX_EXPRESSION]: "mdxExpression",
        [HAST_MDX_ESM]: "mdxjsEsm",
      };
      return new LazyTextNode(typeNames[nodeType]!, nodeId, reader, dataMap) as unknown as HastNode;
    }
    default:
      // For root, mdxJsx*, doctype — fall back to full materializer
      return materializeHastNode(reader, nodeId, dataMap);
  }
}

// ---------------------------------------------------------------------------

// Map from node_type number to visitor method name
const TYPE_TO_METHOD: Record<number, keyof HastVisitorInstance> = {
  [HAST_ROOT]: "transformRoot",
  [HAST_ELEMENT]: "element",
  [HAST_TEXT]: "text",
  [HAST_COMMENT]: "comment",
  [HAST_RAW]: "raw",
  [HAST_MDX_JSX_ELEMENT]: "mdxJsxFlowElement",
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
): HastVisitResult {
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
          const node = materializeForVisitor(nodeType, nodeId, reader, dataMap);
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
