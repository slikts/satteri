import { materializeNode, TYPE_NAMES } from "./mdast-materializer.js";
import { CommandBuffer, classifyReturn } from "../command-buffer.js";
import type { MdastNode, MdastNodeInternal, Toml, MathNode, InlineMath } from "../types.js";
import type {
  Blockquote, Break, Code, Definition, Delete, Emphasis,
  FootnoteDefinition, FootnoteReference, Heading, Html, Image,
  ImageReference, InlineCode, Link, LinkReference, List, ListItem,
  Paragraph, Root, Strong, Table, TableRow, TableCell, Text,
  ThematicBreak, Yaml,
} from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";
import type { MdxFlowExpression, MdxTextExpression } from "mdast-util-mdx-expression";
import type { MdxjsEsm } from "mdast-util-mdxjs-esm";
import type { MdastReader } from "./mdast-reader.js";
import type { DataMap } from "../data-map.js";

export const MutationType = {
  Replace: "replace",
  Remove: "remove",
  InsertBefore: "insertBefore",
  InsertAfter: "insertAfter",
  Wrap: "wrap",
  PrependChild: "prependChild",
  AppendChild: "appendChild",
  SetProperty: "setProperty",
} as const;

type MutationTypeValue = (typeof MutationType)[keyof typeof MutationType];

interface Mutation {
  type: MutationTypeValue;
  nodeId: number;
  newNode?: MdastNode;
  key?: string;
  value?: unknown;
}

export interface MdastDiagnostic {
  message: string;
  nodeId?: number | undefined;
  position?: MdastNode["position"] | undefined;
  severity: "error" | "warning" | "info";
}

const VISITOR_KEYS = new Set([
  "root",
  "paragraph",
  "heading",
  "thematicBreak",
  "blockquote",
  "list",
  "listItem",
  "html",
  "code",
  "definition",
  "text",
  "emphasis",
  "strong",
  "inlineCode",
  "break",
  "link",
  "image",
  "linkReference",
  "imageReference",
  "footnoteDefinition",
  "footnoteReference",
  "table",
  "tableRow",
  "tableCell",
  "delete",
  "yaml",
  "toml",
  "math",
  "inlineMath",
  "mdxJsxFlowElement",
  "mdxJsxTextElement",
  "mdxFlowExpression",
  "mdxTextExpression",
  "mdxjsEsm",
]);

function nid(node: MdastNode): number {
  return (node as MdastNodeInternal)._nodeId;
}

export class MdastVisitorContext {
  readonly #commandBuffer: CommandBuffer = new CommandBuffer();
  readonly #diagnostics: MdastDiagnostic[] = [];
  readonly #reader: MdastReader;
  readonly #dataMap: DataMap;
  readonly #rootId: number = 0;

  constructor(reader: MdastReader, dataMap: DataMap) {
    this.#reader = reader;
    this.#dataMap = dataMap;
  }

  removeNode(node: MdastNode): void {
    this.#commandBuffer.removeNode(nid(node));
  }

  insertBefore(node: MdastNode, newNode: MdastNode): void {
    this.#commandBuffer.insertBefore(nid(node), newNode);
  }

  insertAfter(node: MdastNode, newNode: MdastNode): void {
    this.#commandBuffer.insertAfter(nid(node), newNode);
  }

  wrapNode(node: MdastNode, parentNode: MdastNode): void {
    this.#commandBuffer.wrapNode(nid(node), parentNode);
  }

  prependChild(node: MdastNode, childNode: MdastNode): void {
    this.#commandBuffer.prependChild(nid(node), childNode);
  }

  appendChild(node: MdastNode, childNode: MdastNode): void {
    this.#commandBuffer.appendChild(nid(node), childNode);
  }

  replaceNode(node: MdastNode, newNode: MdastNode): void {
    this.#commandBuffer.replace(nid(node), newNode);
  }

  setProperty(node: MdastNode, key: string, value: unknown): void {
    this.#commandBuffer.setProperty(nid(node), key, value);
  }

  report({
    message,
    node,
    severity = "error",
  }: {
    message: string;
    node?: MdastNode;
    severity?: "error" | "warning" | "info";
  }): void {
    this.#diagnostics.push({
      message,
      nodeId: node ? nid(node) : undefined,
      position: node?.position,
      severity,
    });
  }

  get root(): MdastNode {
    return materializeNode(this.#reader, this.#rootId, this.#dataMap);
  }

  get source(): string {
    return this.#reader.getSource();
  }

  /** Get the binary command buffer for all mutations recorded via context methods. */
  getCommandBuffer(): CommandBuffer {
    return this.#commandBuffer;
  }

  getDiagnostics(): MdastDiagnostic[] {
    return this.#diagnostics;
  }
}

type MdastVisitorFn<N extends MdastNode = MdastNode> =
  (node: N, context: MdastVisitorContext) => MdastNode | { raw: string } | { rawHtml: string } | undefined | null | void;

export interface MdastPluginInstance {
  before?(context: MdastVisitorContext): void;
  after?(context: MdastVisitorContext): void;
  transformRoot?(root: Root, context: MdastVisitorContext): MdastNode | undefined | null;
  root?: MdastVisitorFn<Root>;
  paragraph?: MdastVisitorFn<Paragraph>;
  heading?: MdastVisitorFn<Heading>;
  thematicBreak?: MdastVisitorFn<ThematicBreak>;
  blockquote?: MdastVisitorFn<Blockquote>;
  list?: MdastVisitorFn<List>;
  listItem?: MdastVisitorFn<ListItem>;
  html?: MdastVisitorFn<Html>;
  code?: MdastVisitorFn<Code>;
  definition?: MdastVisitorFn<Definition>;
  text?: MdastVisitorFn<Text>;
  emphasis?: MdastVisitorFn<Emphasis>;
  strong?: MdastVisitorFn<Strong>;
  inlineCode?: MdastVisitorFn<InlineCode>;
  break?: MdastVisitorFn<Break>;
  link?: MdastVisitorFn<Link>;
  image?: MdastVisitorFn<Image>;
  linkReference?: MdastVisitorFn<LinkReference>;
  imageReference?: MdastVisitorFn<ImageReference>;
  footnoteDefinition?: MdastVisitorFn<FootnoteDefinition>;
  footnoteReference?: MdastVisitorFn<FootnoteReference>;
  table?: MdastVisitorFn<Table>;
  tableRow?: MdastVisitorFn<TableRow>;
  tableCell?: MdastVisitorFn<TableCell>;
  delete?: MdastVisitorFn<Delete>;
  yaml?: MdastVisitorFn<Yaml>;
  toml?: MdastVisitorFn<Toml>;
  math?: MdastVisitorFn<MathNode>;
  inlineMath?: MdastVisitorFn<InlineMath>;
  mdxJsxFlowElement?: MdastVisitorFn<MdxJsxFlowElement>;
  mdxJsxTextElement?: MdastVisitorFn<MdxJsxTextElement>;
  mdxFlowExpression?: MdastVisitorFn<MdxFlowExpression>;
  mdxTextExpression?: MdastVisitorFn<MdxTextExpression>;
  mdxjsEsm?: MdastVisitorFn<MdxjsEsm>;
}

interface MdastVisitResult {
  /** Binary command buffer containing all mutations. */
  commandBuffer: Uint8Array;
  diagnostics: MdastDiagnostic[];
  hasMutations: boolean;
}

/**
 * Walk the MDAST and dispatch to plugin visitor functions.
 *
 * Mutations are collected into a binary command buffer. Return values from
 * visitor functions are classified (raw/rawHtml/structured) and encoded
 * as REPLACE commands in the buffer.
 */
export function visitMdast(
  reader: MdastReader,
  plugin: MdastPluginInstance,
  dataMap: DataMap,
): MdastVisitResult {
  const context = new MdastVisitorContext(reader, dataMap);

  plugin.before?.(context);

  // Separate CommandBuffer for return-value mutations (replace commands from
  // visitor return values). These are merged with the context's buffer at the end.
  const returnBuffer = new CommandBuffer();

  if (typeof plugin.transformRoot === "function") {
    // Full materialization path
    const root = materializeNode(reader, 0, dataMap) as Root;
    const result = plugin.transformRoot(root, context);
    if (result !== undefined && result !== null) {
      const cls = classifyReturn(result);
      switch (cls) {
        case "raw_markdown":
          returnBuffer.replace(0, result as unknown as { raw: string });
          break;
        case "raw_html":
          returnBuffer.replace(0, result as unknown as { rawHtml: string });
          break;
        case "structured_node":
          returnBuffer.replace(0, result);
          break;
        // no_change: do nothing
      }
    }
  } else {
    // Fast path: walk raw bytes, only materialize subscribed node types

    // Build reverse map: numeric type → visitor function
    const TYPE_TO_VISITOR = new Map<
      number,
      (node: MdastNode, context: MdastVisitorContext) => unknown
    >();
    for (const [name, fn] of Object.entries(plugin)) {
      if (VISITOR_KEYS.has(name) && typeof fn === "function") {
        for (const [num, typeName] of Object.entries(TYPE_NAMES)) {
          if (typeName === name) {
            TYPE_TO_VISITOR.set(
              Number(num),
              fn as (node: MdastNode, context: MdastVisitorContext) => unknown,
            );
            break;
          }
        }
      }
    }

    // Walk raw buffer — only type-check each node, materialize only on subscription match
    const stack: number[] = [0];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      const nodeType = reader.getNodeType(nodeId);

      const visitor = TYPE_TO_VISITOR.get(nodeType);
      if (visitor) {
        const node = materializeNode(reader, nodeId, dataMap);
        const result = visitor.call(plugin, node, context);
        if (result !== undefined && result !== null) {
          const cls = classifyReturn(result);
          switch (cls) {
            case "raw_markdown":
              returnBuffer.replace(nodeId, result as unknown as { raw: string });
              break;
            case "raw_html":
              returnBuffer.replace(nodeId, result as unknown as { rawHtml: string });
              break;
            case "structured_node":
              returnBuffer.replace(nodeId, result as MdastNode);
              break;
            // no_change: do nothing
          }
        }
      }

      reader.pushChildIds(nodeId, stack);
    }
  }

  plugin.after?.(context);

  // Merge: return-value commands first, then context commands
  const ctxCmdBuf = context.getCommandBuffer();
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

  // Release internal ArrayBuffers now that we've copied into merged
  returnBuffer.reset();
  ctxCmdBuf.reset();

  return {
    commandBuffer: merged,
    diagnostics: context.getDiagnostics(),
    hasMutations: totalLen > 0,
  };
}
