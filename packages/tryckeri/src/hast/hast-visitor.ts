import { materializeHastNode, type HastNode } from "./hast-materializer.js";
import type { HastNodeInternal, HastRaw, MdxJsxAttributeUnion } from "../types.js";
import type { Element, Text, Comment, Doctype } from "hast";
import type { MdxJsxFlowElementHast, MdxJsxTextElementHast } from "mdast-util-mdx-jsx";
import type { MdxFlowExpressionHast, MdxTextExpressionHast } from "mdast-util-mdx-expression";
import type { MdxjsEsmHast } from "mdast-util-mdxjs-esm";
import {
  HastReader,
  HAST_ELEMENT,
  HAST_TEXT,
  HAST_COMMENT,
  HAST_RAW,
  HAST_MDX_JSX_ELEMENT,
  HAST_MDX_JSX_TEXT_ELEMENT,
  HAST_MDX_FLOW_EXPRESSION,
  HAST_MDX_TEXT_EXPRESSION,
  HAST_MDX_ESM,
} from "./hast-reader.js";
import { CommandBuffer } from "../command-buffer.js";
import {
  walkHandle,
  applyCommandsToHandle,
  serializeHandle,
  textContentHandle,
  getNodeData as napiGetNodeData,
  parseExpression as napiParseExpression,
} from "../../index.js";

// Opaque handle type from NAPI — the arena lives in Rust memory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HastHandle = any;

/** ESTree-compatible Program node returned by `parseExpression()`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EstreeProgram = Record<string, any>;

/** Attach `parseExpression()` to an MDX expression node. */
function attachParseExpression(node: HastNode): void {
  Object.defineProperty(node, "parseExpression", {
    value(): EstreeProgram | null {
      const value = (this as { value?: string }).value;
      if (typeof value !== "string") return null;
      const json = napiParseExpression(value);
      if (json == null) return null;
      return JSON.parse(json) as EstreeProgram;
    },
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

export interface HastDiagnostic {
  message: string;
  nodeId?: number | undefined;
  severity: "error" | "warning" | "info";
}

export interface HastVisitorContext {
  readonly source: string;
  readonly filename: string;
  removeNode(node: HastNode): void;
  replaceNode(node: HastNode, newNode: HastNode): void;
  setProperty(node: HastNode, key: string, value: unknown): void;
  /** Collect the concatenated text of all descendant text nodes (like DOM textContent). */
  textContent(node: HastNode): string;
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

function nid(node: HastNode): number {
  return (node as HastNodeInternal)._nodeId;
}

class HastVisitorContextImpl implements HastVisitorContext {
  readonly #commandBuffer: CommandBuffer = new CommandBuffer();
  readonly #diagnostics: HastDiagnostic[] = [];
  /** Track accumulated node state for multiple setProperty calls on the same node. */
  readonly #pendingNodes: Map<number, HastNode> = new Map();
  readonly #handle: HastHandle;
  readonly source: string;
  readonly filename: string;

  constructor(handle: HastHandle, source: string, filename: string) {
    this.#handle = handle;
    this.source = source;
    this.filename = filename;
  }

  removeNode(node: HastNode): void {
    this.#commandBuffer.removeNode(nid(node));
  }

  replaceNode(node: HastNode, newNode: HastNode): void {
    const id = nid(node);
    // Encode as a REPLACE command with _hast marker for Rust deserialization
    this.#commandBuffer.replaceRawJson(id, JSON.stringify(markHast(newNode)));
    this.#pendingNodes.set(id, newNode);
  }

  setProperty(node: HastNode, key: string, value: unknown): void {
    const id = nid(node);
    if (node.type === "element") {
      // Fast binary path — no materialization, no JSON serialization
      this.#commandBuffer.setProperty(id, key, value);
      return;
    }

    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      // MDX JSX nodes use `attributes`, not `properties` — keep replaceNode path
      const current = this.#pendingNodes.get(id) ?? node;
      const updated: Record<string, unknown> = { ...current };
      const attrs = [...((updated.attributes as MdxJsxAttributeUnion[] | undefined) ?? [])];
      const idx = attrs.findIndex((a) => a.type === "mdxJsxAttribute" && a.name === key);
      if (idx !== -1) attrs.splice(idx, 1);
      const attrValue =
        value === true || value === null || value === undefined
          ? null
          : typeof value === "string"
            ? value
            : `${value as string | number | boolean}`;
      attrs.push({ type: "mdxJsxAttribute", name: key, value: attrValue });
      updated.attributes = attrs;
      this.replaceNode(node, updated as unknown as HastNode);
      return;
    }

    // Fallback for other node types
    const current = this.#pendingNodes.get(id) ?? node;
    const updated: Record<string, unknown> = { ...current };
    const props = (updated.properties ?? {}) as Record<string, string | boolean | string[]>;
    updated.properties = { ...props, [key]: value as string | boolean | string[] };
    this.replaceNode(node, updated as unknown as HastNode);
  }

  textContent(node: HastNode): string {
    return textContentHandle(this.#handle, nid(node));
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
    this.#diagnostics.push({ message, nodeId: node ? nid(node) : undefined, severity });
  }

  getCommandBuffer(): CommandBuffer {
    return this.#commandBuffer;
  }

  getDiagnostics(): HastDiagnostic[] {
    return this.#diagnostics;
  }
}

/** A filtered visitor: Rust filters by tag/component name, only matched nodes cross the boundary. */
export interface HastFilteredVisitor<N extends HastNode = HastNode> {
  filter: string[];
  visit(node: N, ctx: HastVisitorContext): HastNode | void | Promise<HastNode | void>;
}

type HastVisitorFn<N extends HastNode = HastNode> = (
  node: N,
  ctx: HastVisitorContext,
) => HastNode | void | Promise<HastNode | void>;

export interface HastVisitorInstance {
  // Element-like nodes: filtered by tag/component name (single or array)
  element?: HastFilteredVisitor<Element> | HastFilteredVisitor<Element>[];
  mdxJsxFlowElement?:
    | HastFilteredVisitor<MdxJsxFlowElementHast>
    | HastFilteredVisitor<MdxJsxFlowElementHast>[];
  mdxJsxTextElement?:
    | HastFilteredVisitor<MdxJsxTextElementHast>
    | HastFilteredVisitor<MdxJsxTextElementHast>[];
  // Leaf/value nodes: bare functions (no tag names to filter on)
  text?: HastVisitorFn<Text>;
  comment?: HastVisitorFn<Comment>;
  raw?: HastVisitorFn<HastRaw>;
  doctype?: HastVisitorFn<Doctype>;
  mdxFlowExpression?: HastVisitorFn<MdxFlowExpressionHast & { parseExpression(): EstreeProgram | null }>;
  mdxTextExpression?: HastVisitorFn<MdxTextExpressionHast & { parseExpression(): EstreeProgram | null }>;
  mdxjsEsm?: HastVisitorFn<MdxjsEsmHast>;
}

// ---------------------------------------------------------------------------
// Selective walk helpers
// ---------------------------------------------------------------------------

interface ResolvedSubscription {
  nodeType: number;
  tagFilter: string[];
  visitFn: (node: HastNode, ctx: HastVisitorContext) => HastNode | void;
}

function isFilteredVisitor(v: unknown): v is HastFilteredVisitor {
  return typeof v === "object" && v !== null && "filter" in v && "visit" in v;
}

/** Node types that use filtered visitors (have tag/component names). */
const FILTERED_METHODS = new Set(["element", "mdxJsxFlowElement", "mdxJsxTextElement"]);

/** Resolve subscriptions from a plugin instance. */
export function resolveSubscriptions(plugin: HastVisitorInstance): ResolvedSubscription[] {
  const subs: ResolvedSubscription[] = [];

  for (const [methodName, nodeType] of Object.entries(METHOD_TO_TYPE)) {
    const value = plugin[methodName as keyof HastVisitorInstance];
    if (value === undefined) continue;

    if (FILTERED_METHODS.has(methodName)) {
      const items = Array.isArray(value) ? value : [value];
      for (const fv of items as HastFilteredVisitor[]) {
        subs.push({
          nodeType,
          tagFilter: fv.filter,
          visitFn: fv.visit as ResolvedSubscription["visitFn"],
        });
      }
    } else {
      // Bare function — empty filter matches all nodes of this type
      subs.push({ nodeType, tagFilter: [], visitFn: value as ResolvedSubscription["visitFn"] });
    }
  }

  return subs;
}

/** Reverse map: method name → node type number */
const METHOD_TO_TYPE: Record<string, number> = {
  element: HAST_ELEMENT,
  text: HAST_TEXT,
  comment: HAST_COMMENT,
  raw: HAST_RAW,
  doctype: 4, // HAST_DOCTYPE
  mdxJsxFlowElement: HAST_MDX_JSX_ELEMENT,
  mdxJsxTextElement: HAST_MDX_JSX_TEXT_ELEMENT,
  mdxFlowExpression: HAST_MDX_FLOW_EXPRESSION,
  mdxTextExpression: HAST_MDX_TEXT_EXPRESSION,
  mdxjsEsm: HAST_MDX_ESM,
};

/**
 * Selective walk path: Rust walks the tree, only sends matched nodes to JS.
 */
const textDecoder = new TextDecoder("utf-8");

/** Decode properties from the walk buffer at the given position. */
function decodeProperties(
  view: DataView,
  buf: Uint8Array,
  pos: number,
): Record<string, string | boolean | string[]> {
  const propCount = view.getUint16(pos, true);
  pos += 2;
  const properties: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < propCount; i++) {
    const nameLen = view.getUint16(pos, true);
    pos += 2;
    const name = textDecoder.decode(buf.subarray(pos, pos + nameLen));
    pos += nameLen;
    const kind = buf[pos]!;
    pos += 1;
    const valLen = view.getUint16(pos, true);
    pos += 2;
    const valStr = textDecoder.decode(buf.subarray(pos, pos + valLen));
    pos += valLen;
    switch (kind) {
      case 0: // PROP_STRING
        properties[name] = valStr;
        break;
      case 1: // PROP_BOOL_TRUE
        properties[name] = true;
        break;
      case 2: // PROP_BOOL_FALSE
        break;
      case 3: // PROP_SPACE_SEP
        properties[name] = valStr.split(" ").filter((s) => s.length > 0);
        break;
    }
  }
  return properties;
}

/** Read a matched element node from the binary data section into a HastNode.
 *  Only tagName is decoded eagerly; properties, children, and data are lazy. */
function readElementFromBinary(
  view: DataView,
  buf: Uint8Array,
  offset: number,
  nodeId: number,
  resolver: LazyChildResolver,
): HastNode {
  let pos = offset;

  // Eager: tagName (almost always accessed by visitors)
  const tagLen = view.getUint16(pos, true);
  pos += 2;
  const tagName = textDecoder.decode(buf.subarray(pos, pos + tagLen));
  pos += tagLen;

  // Pre-scan: find section byte offsets without decoding strings
  const propsPos = pos;
  const propCount = view.getUint16(pos, true);
  pos += 2;
  for (let i = 0; i < propCount; i++) {
    const nLen = view.getUint16(pos, true);
    pos += 2 + nLen + 1; // name + kind byte
    const vLen = view.getUint16(pos, true);
    pos += 2 + vLen; // value
  }

  const childCount = view.getUint16(pos, true);
  pos += 2;
  const childIdsPos = pos;
  pos += childCount * 4;

  const nodeDataLen = view.getUint32(pos, true);
  pos += 4;
  const nodeDataPos = nodeDataLen > 0 ? pos : -1;

  // Build node with lazy getters
  const node = { type: "element" as const, tagName } as unknown as HastNode &
    Record<string, unknown>;

  Object.defineProperty(node, "_nodeId", {
    value: nodeId,
    writable: false,
    configurable: true,
    enumerable: false,
  });

  // Lazy: properties
  Object.defineProperty(node, "properties", {
    get() {
      const val = decodeProperties(view, buf, propsPos);
      Object.defineProperty(this, "properties", { value: val, writable: true, enumerable: true, configurable: true });
      return val;
    },
    configurable: true,
    enumerable: true,
  });

  // Lazy: children
  const ids: number[] = [];
  for (let i = 0; i < childCount; i++) ids.push(view.getUint32(childIdsPos + i * 4, true));
  makeLazyChildren(node, ids, resolver);

  // Lazy: data
  if (nodeDataPos >= 0) {
    Object.defineProperty(node, "data", {
      get() {
        const val = JSON.parse(textDecoder.decode(buf.subarray(nodeDataPos, nodeDataPos + nodeDataLen))) as Record<string, unknown>;
        Object.defineProperty(this, "data", { value: val, writable: true, enumerable: true, configurable: true });
        return val;
      },
      configurable: true,
      enumerable: true,
    });
  }

  return node;
}

/** Read a text/comment/raw/expression node from the binary data section. */
const TEXT_NODE_TYPES: Record<number, string> = {
  2: "text",
  3: "comment",
  5: "raw",
  [HAST_MDX_FLOW_EXPRESSION]: "mdxFlowExpression",
  [HAST_MDX_TEXT_EXPRESSION]: "mdxTextExpression",
};

function readTextFromBinary(
  view: DataView,
  buf: Uint8Array,
  offset: number,
  nodeId: number,
  nodeType: number,
): HastNode {
  const valLen = view.getUint32(offset, true);
  const value = textDecoder.decode(buf.subarray(offset + 4, offset + 4 + valLen));
  const node = { type: TEXT_NODE_TYPES[nodeType]!, value } as unknown as HastNode;
  Object.defineProperty(node, "_nodeId", {
    value: nodeId,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  if (nodeType === HAST_MDX_FLOW_EXPRESSION || nodeType === HAST_MDX_TEXT_EXPRESSION) {
    attachParseExpression(node);
  }
  return node;
}

/** Read an MDX JSX element from the binary data section. */
function readMdxJsxFromBinary(
  view: DataView,
  buf: Uint8Array,
  offset: number,
  nodeId: number,
  nodeType: number,
  resolver: LazyChildResolver,
): HastNode {
  let pos = offset;

  // Name
  const nameLen = view.getUint16(pos, true);
  pos += 2;
  const name = nameLen > 0 ? textDecoder.decode(buf.subarray(pos, pos + nameLen)) : null;
  pos += nameLen;

  // Attributes: [kind: u8][nameLen: u16][name][valLen: u16][val]
  const attrCount = view.getUint16(pos, true);
  pos += 2;
  const attributes: { type: string; name?: string; value: unknown }[] = [];
  for (let i = 0; i < attrCount; i++) {
    const kind = buf[pos]!;
    pos += 1;
    const attrNameLen = view.getUint16(pos, true);
    pos += 2;
    const attrName = textDecoder.decode(buf.subarray(pos, pos + attrNameLen));
    pos += attrNameLen;
    const attrValLen = view.getUint16(pos, true);
    pos += 2;
    const attrVal = textDecoder.decode(buf.subarray(pos, pos + attrValLen));
    pos += attrValLen;

    switch (kind) {
      case 0: // BooleanProp
        attributes.push({ type: "mdxJsxAttribute", name: attrName, value: null });
        break;
      case 1: // LiteralProp
        attributes.push({ type: "mdxJsxAttribute", name: attrName, value: attrVal });
        break;
      case 2: // ExpressionProp
        attributes.push({
          type: "mdxJsxAttribute",
          name: attrName,
          value: { type: "mdxJsxAttributeValueExpression", value: attrVal },
        });
        break;
      case 3: // Spread
        attributes.push({ type: "mdxJsxExpressionAttribute", value: attrVal });
        break;
    }
  }

  // Child IDs
  const childCount = view.getUint16(pos, true);
  pos += 2;
  const childIds: number[] = [];
  for (let i = 0; i < childCount; i++) {
    childIds.push(view.getUint32(pos, true));
    pos += 4;
  }

  const typeName = nodeType === HAST_MDX_JSX_ELEMENT ? "mdxJsxFlowElement" : "mdxJsxTextElement";
  const node = { type: typeName, name, attributes } as unknown as HastNode &
    Record<string, unknown>;
  makeLazyChildren(node, childIds, resolver);
  Object.defineProperty(node, "_nodeId", {
    value: nodeId,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  return node;
}

function readMatchedNode(
  view: DataView,
  buf: Uint8Array,
  offset: number,
  nodeId: number,
  nodeType: number,
  resolver: LazyChildResolver,
): HastNode {
  if (nodeType === HAST_ELEMENT) {
    return readElementFromBinary(view, buf, offset, nodeId, resolver);
  } else if (
    nodeType === HAST_TEXT ||
    nodeType === HAST_COMMENT ||
    nodeType === HAST_RAW ||
    nodeType === HAST_MDX_FLOW_EXPRESSION ||
    nodeType === HAST_MDX_TEXT_EXPRESSION
  ) {
    return readTextFromBinary(view, buf, offset, nodeId, nodeType);
  } else if (nodeType === HAST_MDX_JSX_ELEMENT || nodeType === HAST_MDX_JSX_TEXT_ELEMENT) {
    return readMdxJsxFromBinary(view, buf, offset, nodeId, nodeType, resolver);
  }
  // Fallback: minimal node
  return { type: `unknown(${nodeType})`, _nodeId: nodeId } as unknown as HastNode;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Lazy child materializer — serializes the handle's buffer once when first
 * child is accessed, then materializes children from it via HastReader.
 */
class LazyChildResolver {
  #handle: HastHandle;
  #reader: HastReader | null = null;

  constructor(handle: HastHandle) {
    this.#handle = handle;
  }

  #ensure(): HastReader {
    if (!this.#reader) {
      this.#reader = new HastReader(serializeHandle(this.#handle));
    }
    return this.#reader;
  }

  materializeChildren(childIds: number[]): HastNode[] {
    const reader = this.#ensure();
    const handle = this.#handle;
    return childIds.map((id) => {
      const node = materializeHastNode(reader, id);
      // Override data with a lazy getter backed by the Rust arena's node_data.
      Object.defineProperty(node, "data", {
        get() {
          const json = napiGetNodeData(handle, id);
          const val = json ? (JSON.parse(json) as Record<string, unknown>) : null;
          Object.defineProperty(this, "data", { value: val, writable: true, enumerable: true, configurable: true });
          return val;
        },
        configurable: true,
        enumerable: true,
      });
      return node;
    });
  }
}

/** Create a lazy `children` property backed by the handle. */
function makeLazyChildren(
  node: Record<string, unknown>,
  childIds: number[],
  resolver: LazyChildResolver,
): void {
  Object.defineProperty(node, "children", {
    get() {
      const children = resolver.materializeChildren(childIds);
      Object.defineProperty(this, "children", {
        value: children,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return children;
    },
    configurable: true,
    enumerable: true,
  });
}

/** Handle a visitor result (sync). Returns true if it was a Promise (deferred). */
function handleVisitResult(
  result: HastNode | void | Promise<HastNode | void>,
  nodeId: number,
  returnBuffer: CommandBuffer,
  deferred: { nodeId: number; promise: Promise<HastNode | void> }[] | null,
): { nodeId: number; promise: Promise<HastNode | void> }[] | null {
  if (result == null) return deferred;
  if (result instanceof Promise) {
    const list = deferred ?? [];
    list.push({ nodeId, promise: result });
    return list;
  }
  returnBuffer.replaceRawJson(nodeId, JSON.stringify(markHast(result as HastNode)));
  return deferred;
}

/**
 * Dispatch matched nodes from a binary match buffer to visitor functions.
 * Returns null if all sync, or an array of deferred promises if any visitor was async.
 */
function dispatchMatches(
  matchBuf: Uint8Array,
  subs: ResolvedSubscription[],
  ctx: HastVisitorContextImpl,
  returnBuffer: CommandBuffer,
  resolver: LazyChildResolver,
): { nodeId: number; promise: Promise<HastNode | void> }[] | null {
  const matchView = new DataView(matchBuf.buffer, matchBuf.byteOffset, matchBuf.byteLength);
  const matchCount = matchView.getUint32(0, true);
  let deferred: { nodeId: number; promise: Promise<HastNode | void> }[] | null = null;

  for (let i = 0; i < matchCount; i++) {
    const indexBase = 4 + i * 12;
    const nodeId = matchView.getUint32(indexBase, true);
    const subIndex = matchBuf[indexBase + 4]!;
    const dataOffset = matchView.getUint32(indexBase + 6, true);

    const sub = subs[subIndex]!;
    const node = readMatchedNode(matchView, matchBuf, dataOffset, nodeId, sub.nodeType, resolver);
    const result = sub.visitFn(node, ctx);
    deferred = handleVisitResult(result, nodeId, returnBuffer, deferred);
  }

  return deferred;
}

/** Merge return-value + context command buffers and release internals. */
function mergeAndReset(
  returnBuffer: CommandBuffer,
  ctx: HastVisitorContextImpl,
): { merged: Uint8Array; hasMutations: boolean } {
  const ctxCmdBuf = ctx.getCommandBuffer();
  const ctxBuf = ctxCmdBuf.getBuffer();
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

  returnBuffer.reset();
  ctxCmdBuf.reset();
  return { merged, hasMutations: totalLen > 0 };
}

// ---------------------------------------------------------------------------
// Handle-based visitor
// ---------------------------------------------------------------------------

/**
 * Walk a handle's arena in Rust, dispatch matched nodes to JS visitor functions,
 * and apply mutations back to the handle. No arena buffers cross NAPI.
 *
 * Returns void if all visitors are sync, or a Promise if any visitor is async.
 */
export function visitHastHandle(
  handle: HastHandle,
  plugin: HastVisitorInstance,
  subs: ResolvedSubscription[],
  source: string,
  filename: string,
): void | Promise<void> {
  const ctx = new HastVisitorContextImpl(handle, source, filename);
  const returnBuffer = new CommandBuffer();
  const resolver = new LazyChildResolver(handle);
  const rustSubs = subs.map((s) => ({ nodeType: s.nodeType, tagFilter: s.tagFilter }));
  const deferred = dispatchMatches(walkHandle(handle, rustSubs), subs, ctx, returnBuffer, resolver);

  if (deferred) {
    return Promise.all(deferred.map((d) => d.promise.then((result) => ({ nodeId: d.nodeId, result }))))
      .then((results) => {
        for (const { nodeId, result } of results) {
          if (result != null) {
            returnBuffer.replaceRawJson(nodeId, JSON.stringify(markHast(result)));
          }
        }
        applyMutations(handle, returnBuffer, ctx);
      });
  }

  applyMutations(handle, returnBuffer, ctx);
}

function applyMutations(
  handle: HastHandle,
  returnBuffer: CommandBuffer,
  ctx: HastVisitorContextImpl,
): void {
  const { merged, hasMutations } = mergeAndReset(returnBuffer, ctx);
  if (hasMutations) {
    applyCommandsToHandle(handle, merged);
  }
}
