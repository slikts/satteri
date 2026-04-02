import { test, expect } from "vitest";
import {
  visitMdastHandle,
  resolveMdastSubscriptions,
  type MdastVisitorContext,
} from "../src/mdast/mdast-visitor.js";
import { createMdastHandle, getHandleSource } from "../index.js";
import type { MdastNode } from "../src/types.js";

function setup() {
  const handle = createMdastHandle("# Hello\n\nWorld");
  const source = getHandleSource(handle);
  return { handle, source };
}

test("visitor with no subscriptions produces no mutations, no diagnostics", () => {
  const { handle, source } = setup();
  const plugin = {};
  const subs = resolveMdastSubscriptions(plugin);
  const result = visitMdastHandle(handle, plugin, subs, source, "<test>");
  expect((result as { commandBuffer: Uint8Array }).commandBuffer.length).toBe(0);
  expect((result as { hasMutations: boolean }).hasMutations).toBe(false);
});

test("visiting heading nodes — callback fires once for the test doc", () => {
  const { handle, source } = setup();
  let callCount = 0;
  const plugin = {
    heading(_node: MdastNode) {
      callCount++;
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  visitMdastHandle(handle, plugin, subs, source, "<test>");
  expect(callCount).toBe(1);
});

test('visitor callback receives correct MDAST node (type="heading", depth=1)', () => {
  const { handle, source } = setup();
  let capturedNode: MdastNode | null = null;
  const plugin = {
    heading(node: MdastNode) {
      capturedNode = node;
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  visitMdastHandle(handle, plugin, subs, source, "<test>");
  expect(capturedNode).not.toBeNull();
  expect(capturedNode!.type).toBe("heading");
  if (capturedNode!.type === "heading") {
    expect((capturedNode! as { depth: number }).depth).toBe(1);
  }
});

test("return value from visitor creates a Replace command in the buffer", () => {
  const { handle, source } = setup();
  const newNode = { type: "paragraph", children: [] } as unknown as MdastNode;
  const plugin = {
    heading(_node: MdastNode) {
      return newNode;
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  const result = visitMdastHandle(handle, plugin, subs, source, "<test>") as {
    commandBuffer: Uint8Array;
    hasMutations: boolean;
  };
  expect(result.commandBuffer.length).toBeGreaterThan(0);
  expect(result.commandBuffer[0]).toBe(0x0b); // CMD_REPLACE
  expect(result.hasMutations).toBe(true);
});

test("context.removeNode creates a Remove command in the buffer", () => {
  const { handle, source } = setup();
  const plugin = {
    heading(node: MdastNode, context: MdastVisitorContext) {
      context.removeNode(node);
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  const result = visitMdastHandle(handle, plugin, subs, source, "<test>") as {
    commandBuffer: Uint8Array;
    hasMutations: boolean;
  };
  expect(result.commandBuffer.length).toBe(5); // 1 byte cmd + 4 bytes nodeId
  expect(result.commandBuffer[0]).toBe(0x01); // CMD_REMOVE
  expect(result.hasMutations).toBe(true);
});

test("context.report creates a diagnostic entry", () => {
  const { handle, source } = setup();
  const plugin = {
    heading(node: MdastNode, context: MdastVisitorContext) {
      context.report({ message: "test diagnostic", node, severity: "warning" });
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  const result = visitMdastHandle(handle, plugin, subs, source, "<test>") as {
    diagnostics: { message: string; severity: string; nodeId?: number }[];
  };
  expect(result.diagnostics.length).toBe(1);
  expect(result.diagnostics[0]!.message).toBe("test diagnostic");
  expect(result.diagnostics[0]!.severity).toBe("warning");
});

test("multiple subscribed types — all fire", () => {
  const { handle, source } = setup();
  const fired: string[] = [];
  const plugin = {
    heading(_node: MdastNode) {
      fired.push("heading");
    },
    text(_node: MdastNode) {
      fired.push("text");
    },
    paragraph(_node: MdastNode) {
      fired.push("paragraph");
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  visitMdastHandle(handle, plugin, subs, source, "<test>");
  expect(fired).toContain("heading");
  expect(fired).toContain("paragraph");
  expect(fired.filter((x) => x === "text").length).toBe(2);
});

test("context.source returns the source text", () => {
  const { handle, source } = setup();
  let capturedSource: string | null = null;
  const plugin = {
    heading(_node: MdastNode, ctx: MdastVisitorContext) {
      capturedSource = ctx.source;
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  visitMdastHandle(handle, plugin, subs, source, "<test>");
  expect(capturedSource).toBe("# Hello\n\nWorld");
});

test("context.filename returns the filename", () => {
  const { handle, source } = setup();
  let capturedFilename: string | null = null;
  const plugin = {
    heading(_node: MdastNode, ctx: MdastVisitorContext) {
      capturedFilename = ctx.filename;
    },
  };
  const subs = resolveMdastSubscriptions(plugin);
  visitMdastHandle(handle, plugin, subs, source, "test.md");
  expect(capturedFilename).toBe("test.md");
});

test("hasMutations is false when no mutations, true when there are mutations", () => {
  const { handle, source } = setup();
  const noMutPlugin = { heading(_node: MdastNode) {} };
  const noMutSubs = resolveMdastSubscriptions(noMutPlugin);
  const noMutResult = visitMdastHandle(handle, noMutPlugin, noMutSubs, source, "<test>") as {
    hasMutations: boolean;
  };
  expect(noMutResult.hasMutations).toBe(false);

  const handle2 = createMdastHandle("# Hello\n\nWorld");
  const mutPlugin = {
    heading(node: MdastNode, context: MdastVisitorContext) {
      context.removeNode(node);
    },
  };
  const mutSubs = resolveMdastSubscriptions(mutPlugin);
  const mutResult = visitMdastHandle(handle2, mutPlugin, mutSubs, source, "<test>") as {
    hasMutations: boolean;
  };
  expect(mutResult.hasMutations).toBe(true);
});
