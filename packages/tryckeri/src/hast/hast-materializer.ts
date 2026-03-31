import {
  HastReader,
  HAST_ROOT,
  HAST_ELEMENT,
  HAST_TEXT,
  HAST_COMMENT,
  HAST_DOCTYPE,
  HAST_RAW,
  HAST_MDX_JSX_ELEMENT,
  HAST_MDX_JSX_TEXT_ELEMENT,
  HAST_MDX_FLOW_EXPRESSION,
  HAST_MDX_TEXT_EXPRESSION,
  HAST_MDX_ESM,
  type HastProperty,
} from "./hast-reader.js";
import type { DataMap } from "../data-map.js";
import type { HastNode } from "../types.js";

export type { HastNode };

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

function propsToRecord(props: HastProperty[]): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  for (const p of props) {
    result[p.name] = p.value;
  }
  return result;
}

/**
 * Materialize a single HAST node from a binary buffer as a lazy JS object.
 */
export function materializeHastNode(
  reader: HastReader,
  nodeId: number,
  dataMap: DataMap,
): HastNode {
  const nodeType = reader.getNodeType(nodeId);

  let typeName: string;
  switch (nodeType) {
    case HAST_ROOT:
      typeName = "root";
      break;
    case HAST_ELEMENT:
      typeName = "element";
      break;
    case HAST_TEXT:
      typeName = "text";
      break;
    case HAST_COMMENT:
      typeName = "comment";
      break;
    case HAST_DOCTYPE:
      typeName = "doctype";
      break;
    case HAST_RAW:
      typeName = "raw";
      break;
    case HAST_MDX_JSX_ELEMENT:
      typeName = "mdxJsxFlowElement";
      break;
    case HAST_MDX_JSX_TEXT_ELEMENT:
      typeName = "mdxJsxTextElement";
      break;
    case HAST_MDX_FLOW_EXPRESSION:
      typeName = "mdxFlowExpression";
      break;
    case HAST_MDX_TEXT_EXPRESSION:
      typeName = "mdxTextExpression";
      break;
    case HAST_MDX_ESM:
      typeName = "mdxjsEsm";
      break;
    default:
      typeName = `unknown(${nodeType})`;
      break;
  }

  const node = { type: typeName } as HastNode;

  // _nodeId: non-enumerable internal reference
  Object.defineProperty(node, "_nodeId", {
    value: nodeId,
    writable: false,
    configurable: true,
    enumerable: false,
  });

  // data: backed by DataMap
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

  switch (nodeType) {
    case HAST_ROOT:
      // children: lazy getter
      Object.defineProperty(node, "children", {
        get(this: HastNode) {
          const childIds = reader.getChildIds(nodeId);
          const children = childIds.map((id) => materializeHastNode(reader, id, dataMap));
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
      break;

    case HAST_ELEMENT: {
      // tagName and properties: lazy
      Object.defineProperties(node, {
        tagName: lazyProp("tagName", () => reader.getElementData(nodeId).tagName),
        properties: lazyProp("properties", () => {
          const { properties } = reader.getElementData(nodeId);
          return propsToRecord(properties);
        }),
      });
      // children: lazy
      Object.defineProperty(node, "children", {
        get(this: HastNode) {
          const childIds = reader.getChildIds(nodeId);
          const children = childIds.map((id) => materializeHastNode(reader, id, dataMap));
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
      break;
    }

    case HAST_TEXT:
    case HAST_COMMENT:
    case HAST_RAW:
      Object.defineProperties(node, {
        value: lazyProp("value", () => reader.getTextValue(nodeId)),
      });
      break;

    case HAST_DOCTYPE:
      // No extra properties
      break;

    case HAST_MDX_JSX_ELEMENT:
    case HAST_MDX_JSX_TEXT_ELEMENT:
      Object.defineProperties(node, {
        name: lazyProp("name", () => reader.getMdxJsxElementData(nodeId).name),
        attributes: lazyProp("attributes", () => reader.getMdxJsxElementData(nodeId).attributes),
      });
      Object.defineProperty(node, "children", {
        get(this: HastNode) {
          const childIds = reader.getChildIds(nodeId);
          const children = childIds.map((id) => materializeHastNode(reader, id, dataMap));
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
      break;

    case HAST_MDX_FLOW_EXPRESSION:
    case HAST_MDX_TEXT_EXPRESSION:
    case HAST_MDX_ESM:
      Object.defineProperties(node, {
        value: lazyProp("value", () => reader.getTextValue(nodeId)),
      });
      break;
  }

  return node;
}

/**
 * Materialize the full HAST tree from root (nodeId=0).
 */
export function materializeHastTree(reader: HastReader, dataMap: DataMap): HastNode {
  return materializeHastNode(reader, 0, dataMap);
}
