import { test, expect } from "vitest";
import { MdastReader } from "../src/mdast/mdast-reader.js";
import { DataMap } from "../src/data-map.js";
import { visitMdast, type MdastVisitorContext } from "../src/mdast/mdast-visitor.js";
import { buildHelloWorldBuffer } from "./fixtures.js";
import type { MdastNode } from "../src/types.js";

function setup() {
  const buf = buildHelloWorldBuffer();
  const reader = new MdastReader(buf);
  const dataMap = new DataMap();
  return { reader, dataMap };
}

test("visitor with no subscriptions produces no mutations, no diagnostics", () => {
  const { reader, dataMap } = setup();
  const result = visitMdast(reader, {}, dataMap);
  expect(result.commandBuffer.length).toBe(0);
  expect(result.diagnostics.length).toBe(0);
  expect(result.hasMutations).toBe(false);
});

test("visiting heading nodes — callback fires once for the test doc", () => {
  const { reader, dataMap } = setup();
  let callCount = 0;
  visitMdast(
    reader,
    {
      heading(_node: MdastNode) {
        callCount++;
      },
    },
    dataMap,
  );
  expect(callCount).toBe(1);
});

test('visitor callback receives correct MDAST node (type="heading", depth=1)', () => {
  const { reader, dataMap } = setup();
  let capturedNode: MdastNode | null = null;
  visitMdast(
    reader,
    {
      heading(node: MdastNode) {
        capturedNode = node;
      },
    },
    dataMap,
  );
  expect(capturedNode).not.toBeNull();
  const node = capturedNode!;
  expect(node.type).toBe("heading");
  if (node.type === "heading") {
    expect(node.depth).toBe(1);
  }
});

test("return value from visitor creates a Replace command in the buffer", () => {
  const { reader, dataMap } = setup();
  const newNode = { type: "paragraph", children: [] } as unknown as MdastNode;
  const result = visitMdast(
    reader,
    {
      heading(_node: MdastNode) {
        return newNode;
      },
    },
    dataMap,
  );
  // The command buffer should contain a REPLACE command (0x0B)
  expect(result.commandBuffer.length).toBeGreaterThan(0);
  expect(result.commandBuffer[0]).toBe(0x0b); // CMD_REPLACE
  expect(result.hasMutations).toBe(true);
});

test("context.removeNode creates a Remove command in the buffer", () => {
  const { reader, dataMap } = setup();
  const result = visitMdast(
    reader,
    {
      heading(node: MdastNode, context: MdastVisitorContext) {
        context.removeNode(node);
      },
    },
    dataMap,
  );
  // The command buffer should contain a REMOVE command (0x01) with nodeId=1
  expect(result.commandBuffer.length).toBe(5); // 1 byte cmd + 4 bytes nodeId
  expect(result.commandBuffer[0]).toBe(0x01); // CMD_REMOVE
  // Read nodeId as little-endian u32
  const view = new DataView(result.commandBuffer.buffer, result.commandBuffer.byteOffset);
  expect(view.getUint32(1, true)).toBe(1);
  expect(result.hasMutations).toBe(true);
});

test("context.report creates a diagnostic entry", () => {
  const { reader, dataMap } = setup();
  const result = visitMdast(
    reader,
    {
      heading(node: MdastNode, context: MdastVisitorContext) {
        context.report({ message: "test diagnostic", node, severity: "warning" });
      },
    },
    dataMap,
  );
  expect(result.diagnostics.length).toBe(1);
  expect(result.diagnostics[0]!.message).toBe("test diagnostic");
  expect(result.diagnostics[0]!.severity).toBe("warning");
  expect(result.diagnostics[0]!.nodeId).toBe(1);
});

test("plugin.before is called before traversal", () => {
  const { reader, dataMap } = setup();
  const order: string[] = [];
  visitMdast(
    reader,
    {
      before(_context) {
        order.push("before");
      },
      heading(_node: MdastNode) {
        order.push("heading");
      },
    },
    dataMap,
  );
  expect(order[0]!).toBe("before");
  expect(order[1]!).toBe("heading");
});

test("plugin.after is called after traversal", () => {
  const { reader, dataMap } = setup();
  const order: string[] = [];
  visitMdast(
    reader,
    {
      heading(_node: MdastNode) {
        order.push("heading");
      },
      after(_context) {
        order.push("after");
      },
    },
    dataMap,
  );
  expect(order[0]!).toBe("heading");
  expect(order[1]!).toBe("after");
});

test("transformRoot gets the full materialized root", () => {
  const { reader, dataMap } = setup();
  let capturedRoot: MdastNode | null = null;
  visitMdast(
    reader,
    {
      transformRoot(root, _context) {
        capturedRoot = root;
        return undefined;
      },
    },
    dataMap,
  );
  expect(capturedRoot).not.toBeNull();
  expect(capturedRoot!.type).toBe("root");
  expect(capturedRoot!._nodeId).toBe(0);
});

test("multiple subscribed types — all fire", () => {
  const { reader, dataMap } = setup();
  const fired: string[] = [];
  visitMdast(
    reader,
    {
      heading(_node: MdastNode) {
        fired.push("heading");
      },
      text(_node: MdastNode) {
        fired.push("text");
      },
      paragraph(_node: MdastNode) {
        fired.push("paragraph");
      },
    },
    dataMap,
  );
  expect(fired).toContain("heading");
  expect(fired).toContain("paragraph");
  expect(fired.filter((x) => x === "text").length).toBe(2);
});

test("non-subscribed types are not materialized via getNode", () => {
  const { reader, dataMap } = setup();
  let getNodeCalls = 0;
  const proxyReader = new Proxy(reader, {
    get(target, prop) {
      if (prop === "getNode") {
        return function (...args: Parameters<typeof target.getNode>) {
          getNodeCalls++;
          return target.getNode(...args);
        };
      }
      const val = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  visitMdast(proxyReader as MdastReader, { heading(_node: MdastNode) {} }, dataMap);
  expect(getNodeCalls).toBe(1);
});

test("context.source returns the source text", () => {
  const { reader, dataMap } = setup();
  let capturedSource: string | null = null;
  visitMdast(
    reader,
    {
      before(context) {
        capturedSource = context.source;
      },
    },
    dataMap,
  );
  expect(capturedSource).toBe("# Hello\n\nWorld");
});

test("hasMutations is false when no mutations, true when there are mutations", () => {
  const { reader, dataMap } = setup();

  const noMutResult = visitMdast(reader, { heading(_node: MdastNode) {} }, dataMap);
  expect(noMutResult.hasMutations).toBe(false);

  const mutResult = visitMdast(
    reader,
    {
      heading(node: MdastNode, context: MdastVisitorContext) {
        context.removeNode(node);
      },
    },
    dataMap,
  );
  expect(mutResult.hasMutations).toBe(true);
});
