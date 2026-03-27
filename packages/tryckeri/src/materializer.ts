import type { MdastNode } from "./types.js";
import type { MdastReader } from "./mdast-reader.js";
import type { DataMap } from "./data-map.js";

export const TYPE_NAMES: Record<number, string> = {
  0: "root",
  1: "paragraph",
  2: "heading",
  3: "thematicBreak",
  4: "blockquote",
  5: "list",
  6: "listItem",
  7: "html",
  8: "code",
  9: "definition",
  10: "text",
  11: "emphasis",
  12: "strong",
  13: "inlineCode",
  14: "break",
  15: "link",
  16: "image",
  17: "linkReference",
  18: "imageReference",
  19: "footnoteDefinition",
  20: "footnoteReference",
  21: "table",
  22: "tableRow",
  23: "tableCell",
  24: "delete",
  25: "yaml",
  26: "toml",
  27: "math",
  28: "inlineMath",
  100: "mdxJsxFlowElement",
  101: "mdxJsxTextElement",
  102: "mdxFlowExpression",
  103: "mdxTextExpression",
  104: "mdxjsEsm",
};

// Leaf node types that do NOT have children
const LEAF_TYPES = new Set([10, 13, 7, 8, 14, 3, 20, 25, 26, 27, 28, 102, 103, 104]);

/**
 * Build a lazy getter descriptor that caches the value on first access.
 */
function lazyProp<T>(key: string, get: () => T): PropertyDescriptor {
  return {
    get(this: Record<string, unknown>) {
      const value = get();
      Object.defineProperty(this, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return value;
    },
    configurable: true,
    enumerable: true,
  };
}

/**
 * Add type-specific lazy properties to a node object.
 */
function addTypeProperties(
  node: MdastNode,
  reader: MdastReader,
  nodeId: number,
  nodeType: number,
): void {
  switch (nodeType) {
    case 2: // heading
      Object.defineProperties(node, {
        depth: lazyProp("depth", () => reader.getHeadingDepth(nodeId)),
      });
      break;

    case 10: // text
    case 13: // inlineCode
    case 7: // html
    case 25: // yaml
    case 26: // toml
    case 28: // inlineMath
      Object.defineProperties(node, {
        value: lazyProp("value", () => reader.getTextValue(nodeId)),
      });
      break;

    case 8: // code
      Object.defineProperties(node, {
        lang: lazyProp("lang", () => reader.getCodeData(nodeId).lang),
        meta: lazyProp("meta", () => reader.getCodeData(nodeId).meta),
        value: lazyProp("value", () => reader.getCodeData(nodeId).value),
      });
      break;

    case 27: // math
      Object.defineProperties(node, {
        meta: lazyProp("meta", () => reader.getMathData(nodeId).meta),
        value: lazyProp("value", () => reader.getMathData(nodeId).value),
      });
      break;

    case 15: // link
      Object.defineProperties(node, {
        url: lazyProp("url", () => reader.getLinkData(nodeId).url),
        title: lazyProp("title", () => reader.getLinkData(nodeId).title),
      });
      break;

    case 9: // definition
      Object.defineProperties(node, {
        url: lazyProp("url", () => reader.getDefinitionData(nodeId).url),
        title: lazyProp("title", () => reader.getDefinitionData(nodeId).title),
        identifier: lazyProp("identifier", () => reader.getDefinitionData(nodeId).identifier),
        label: lazyProp("label", () => reader.getDefinitionData(nodeId).label),
      });
      break;

    case 16: // image
      Object.defineProperties(node, {
        url: lazyProp("url", () => reader.getImageData(nodeId).url),
        alt: lazyProp("alt", () => reader.getImageData(nodeId).alt),
        title: lazyProp("title", () => reader.getImageData(nodeId).title),
      });
      break;

    case 5: // list
      Object.defineProperties(node, {
        ordered: lazyProp("ordered", () => reader.getListData(nodeId).ordered),
        start: lazyProp("start", () => {
          const d = reader.getListData(nodeId);
          return d.ordered ? d.start : null;
        }),
        spread: lazyProp("spread", () => reader.getListData(nodeId).spread),
      });
      break;

    case 6: // listItem
      Object.defineProperties(node, {
        checked: lazyProp("checked", () => reader.getListItemData(nodeId).checked),
        spread: lazyProp("spread", () => reader.getListItemData(nodeId).spread),
      });
      break;

    case 17: // linkReference
    case 18: // imageReference
    case 20: // footnoteReference
      Object.defineProperties(node, {
        identifier: lazyProp("identifier", () => reader.getReferenceData(nodeId).identifier),
        label: lazyProp("label", () => reader.getReferenceData(nodeId).label),
        referenceType: lazyProp(
          "referenceType",
          () => reader.getReferenceData(nodeId).referenceType,
        ),
      });
      break;

    case 19: // footnoteDefinition
      Object.defineProperties(node, {
        identifier: lazyProp(
          "identifier",
          () => reader.getFootnoteDefinitionData(nodeId).identifier,
        ),
        label: lazyProp("label", () => reader.getFootnoteDefinitionData(nodeId).label),
      });
      break;

    case 21: // table
      Object.defineProperties(node, {
        align: lazyProp("align", () => reader.getTableAlign(nodeId)),
      });
      break;

    case 100: // mdxJsxFlowElement
    case 101: // mdxJsxTextElement
      Object.defineProperties(node, {
        name: lazyProp("name", () => reader.getMdxJsxElementData(nodeId).name),
        attributes: lazyProp("attributes", () => reader.getMdxJsxElementData(nodeId).attributes),
      });
      break;

    case 102: // mdxFlowExpression
    case 103: // mdxTextExpression
    case 104: // mdxjsEsm
      Object.defineProperties(node, {
        value: lazyProp("value", () => reader.getExpressionValue(nodeId)),
      });
      break;

    // Nodes with no type-specific props:
    // root(0), paragraph(1), thematicBreak(3), blockquote(4),
    // emphasis(11), strong(12), break(14), tableRow(22), tableCell(23), delete(24)
    default:
      break;
  }
}

/**
 * Materialize a single MDAST node from a binary buffer as a lazy JS object.
 */
export function materializeNode(reader: MdastReader, nodeId: number, dataMap: DataMap): MdastNode {
  const rawNode = reader.getNode(nodeId);
  const nodeType = rawNode.type;
  const typeName = TYPE_NAMES[nodeType] ?? `unknown(${nodeType})`;

  const node = {
    type: typeName,
    position: rawNode.position,
  } as MdastNode;

  // _nodeId: non-enumerable internal reference
  Object.defineProperty(node, "_nodeId", {
    value: nodeId,
    writable: false,
    configurable: true,
    enumerable: false,
  });

  // data: getter/setter backed by the DataMap
  Object.defineProperty(node, "data", {
    get() {
      return dataMap.get(nodeId);
    },
    set(value: Record<string, unknown>) {
      dataMap.set(nodeId, value);
    },
    configurable: true,
    enumerable: true,
  });

  // Type-specific lazy properties
  addTypeProperties(node, reader, nodeId, nodeType);

  // children: lazy getter (only for non-leaf nodes)
  if (!LEAF_TYPES.has(nodeType)) {
    Object.defineProperty(node, "children", {
      get(this: MdastNode) {
        const childIds = reader.getChildIds(nodeId);
        const children = childIds.map((id) => materializeNode(reader, id, dataMap));
        Object.defineProperty(this, "children", {
          value: children,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        return children;
      },
      configurable: true,
      enumerable: true,
    });
  }

  return node;
}

/** Materialize the full tree from root (nodeId=0). */
export function materializeTree(reader: MdastReader, dataMap: DataMap): MdastNode {
  return materializeNode(reader, 0, dataMap);
}
