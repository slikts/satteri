import { test, expect, describe } from "vitest";
import { MdastReader } from "../src/mdast/mdast-reader.js";
import { materializeMdastTree } from "../src/mdast/mdast-materializer.js";
import type { MdastNode, MdastNodeInternal } from "../src/types.js";
import { buildHelloWorldBuffer } from "./fixtures.js";
import { createMdastHandle, createMdxMdastHandle, serializeHandle } from "../index.js";

function setup() {
  const buf = buildHelloWorldBuffer();
  const reader = new MdastReader(buf);
  return { reader };
}

test('materializeMdastTree returns a root node with type === "root"', () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  expect(root.type).toBe("root");
});

test("root node children is a lazy getter initially", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  const desc = Object.getOwnPropertyDescriptor(root, "children");
  expect(typeof desc?.get === "function").toBe(true);
  expect("value" in (desc ?? {})).toBe(false);
});

test("accessing root.children returns 2 children (heading, paragraph)", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  if (root.type !== "root") throw new Error("expected root");
  const children = root.children;
  expect(children.length).toBe(2);
  expect(children[0]!.type).toBe("heading");
  expect(children[1]!.type).toBe("paragraph");
});

test("heading has depth === 1", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  if (root.type !== "root") throw new Error("expected root");
  const heading = root.children[0]!;
  if (heading.type !== "heading") throw new Error("expected heading");
  expect(heading.depth).toBe(1);
});

test('text child of heading has value === "Hello"', () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  if (root.type !== "root") throw new Error("expected root");
  const heading = root.children[0]!;
  if (heading.type !== "heading") throw new Error("expected heading");
  const textNode = heading.children[0]!;
  expect(textNode.type).toBe("text");
  if (textNode.type === "text") expect(textNode.value).toBe("Hello");
});

test('text child of paragraph has value === "World"', () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  if (root.type !== "root") throw new Error("expected root");
  const para = root.children[1]!;
  if (para.type !== "paragraph") throw new Error("expected paragraph");
  const textNode = para.children[0]!;
  expect(textNode.type).toBe("text");
  if (textNode.type === "text") expect(textNode.value).toBe("World");
});

test("position data is correct: root.position.start.line === 1", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  expect(root.position!.start.line).toBe(1);
});

test("_nodeId is non-enumerable", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  expect(Object.keys(root)).not.toContain("_nodeId");
  expect((root as MdastNodeInternal)._nodeId).toBe(0);
});

test("data is undefined when no data is set", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  expect(root.data).toBeUndefined();
});

test("logseq feature annotates root and list items as blocks", () => {
  const source = "- parent\n  - child\n- sibling\n";
  const buf = serializeHandle(createMdastHandle(source, { logseq: true })) as Uint8Array;
  const root = materializeMdastTree(new MdastReader(buf));

  expect(root.data).toEqual({ logseq: { kind: "block", role: "page" } });
  if (root.type !== "root") throw new Error("expected root");

  const list = root.children[0]!;
  if (list.type !== "list") throw new Error("expected list");
  const parent = list.children[0]!;
  const sibling = list.children[1]!;
  expect(parent.data).toEqual({ logseq: { kind: "block" } });
  expect(sibling.data).toEqual({ logseq: { kind: "block" } });

  const nested = parent.children.find((child) => child.type === "list");
  if (!nested || nested.type !== "list") throw new Error("expected nested list");
  expect(nested.children[0]!.data).toEqual({ logseq: { kind: "block" } });
});

test("logseq tags materialize as annotated links", () => {
  const source = "#tag #[[page tag]] text\n";
  const buf = serializeHandle(createMdastHandle(source, { logseq: true })) as Uint8Array;
  const root = materializeMdastTree(new MdastReader(buf));
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[0]!;
  if (paragraph.type !== "paragraph") throw new Error("expected paragraph");

  const tag = paragraph.children[0]!;
  const pageTag = paragraph.children[2]!;
  expect(tag).toMatchObject({
    type: "link",
    url: "tag",
    title: null,
    data: { logseq: { kind: "tag" } },
  });
  expect(pageTag).toMatchObject({
    type: "link",
    url: "page tag",
    title: null,
    data: { logseq: { kind: "tag" } },
  });
  if (tag.type !== "link" || pageTag.type !== "link") throw new Error("expected links");
  expect(tag.children[0]).toMatchObject({ type: "text", value: "#tag" });
  expect(pageTag.children[0]).toMatchObject({ type: "text", value: "#[[page tag]]" });
});

test("logseq tags are gated by the logseq feature", () => {
  const buf = serializeHandle(createMdastHandle("#tag #5 bolt")) as Uint8Array;
  const root = materializeMdastTree(new MdastReader(buf));
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[0]!;
  if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
  expect(paragraph.children).toHaveLength(1);
  expect(paragraph.children[0]).toMatchObject({ type: "text", value: "#tag #5 bolt" });
});

test("wikilinks are gated by the wikilinks feature", () => {
  const plain = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("[[bracketed prose]]"))),
  );
  if (plain.type !== "root") throw new Error("expected root");
  const plainParagraph = plain.children[0]!;
  if (plainParagraph.type !== "paragraph") throw new Error("expected paragraph");
  expect(plainParagraph.children[0]).toMatchObject({
    type: "text",
    value: "[[bracketed prose]]",
  });

  const linked = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("[[page]]", { wikilinks: true }))),
  );
  if (linked.type !== "root") throw new Error("expected root");
  const linkedParagraph = linked.children[0]!;
  if (linkedParagraph.type !== "paragraph") throw new Error("expected paragraph");
  expect(linkedParagraph.children[0]).toMatchObject({ type: "link", url: "page" });
});

test("logseq page properties annotate the property group and root summary", () => {
  const source = "description:: hello\n";
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle(source, { logseq: true }))),
  );
  const properties = [
    {
      role: "property",
      key: "description",
      value: "hello",
      start: 0,
      end: 19,
      keyStart: 0,
      keyEnd: 11,
      valueStart: 14,
      valueEnd: 19,
    },
  ];

  expect(root.data).toEqual({
    logseq: { kind: "block", role: "page", propertiesDerived: true, properties },
  });
  if (root.type !== "root") throw new Error("expected root");
  expect(root.children[0]!.data).toEqual({
    logseq: { kind: "propertyGroup", authority: "source", properties },
  });
});

test("logseq property annotations are gated by the logseq feature", () => {
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("description:: hello\n"))),
  );
  expect(root.data).toBeUndefined();
  if (root.type !== "root") throw new Error("expected root");
  expect(root.children[0]!.data).toBeUndefined();
});

test("logseq property values stay syntactic while inline refs still parse", () => {
  const source = "is-a:: [[layer]]\n";
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle(source, { logseq: true, wikilinks: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[0]!;
  if (paragraph.type !== "paragraph") throw new Error("expected paragraph");

  expect(paragraph.data).toEqual({
    logseq: {
      kind: "propertyGroup",
      authority: "source",
      properties: [
        {
          role: "property",
          key: "is-a",
          value: "[[layer]]",
          start: 0,
          end: 16,
          keyStart: 0,
          keyEnd: 4,
          valueStart: 7,
          valueEnd: 16,
        },
      ],
    },
  });
  expect(paragraph.children[1]).toMatchObject({ type: "link", url: "layer" });
});

test("logseq duplicate property keys are preserved in source order", () => {
  const source = "foo:: one\nfoo:: two\n";
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle(source, { logseq: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[0]!;
  expect(paragraph.data?.logseq.properties).toMatchObject([
    { key: "foo", value: "one", start: 0, end: 9 },
    { key: "foo", value: "two", start: 10, end: 19 },
  ]);
  expect(root.data?.logseq.properties).toMatchObject([
    { key: "foo", value: "one" },
    { key: "foo", value: "two" },
  ]);
});

test("logseq empty property values are recorded", () => {
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("key::\n", { logseq: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[0]!;
  expect(paragraph.data?.logseq.properties[0]).toMatchObject({
    key: "key",
    value: "",
    start: 0,
    end: 5,
    keyStart: 0,
    keyEnd: 3,
    valueStart: 5,
    valueEnd: 5,
  });
});

test("logseq list item properties attach to the owning list item", () => {
  const source = "- child:: value\n- other\n";
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle(source, { logseq: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  const list = root.children[0]!;
  if (list.type !== "list") throw new Error("expected list");
  const child = list.children[0]!;
  const other = list.children[1]!;

  expect(child.data?.logseq).toMatchObject({
    kind: "block",
    propertiesDerived: true,
    properties: [{ key: "child", value: "value", start: 2, end: 15 }],
  });
  expect(other.data).toEqual({ logseq: { kind: "block" } });
  expect(root.data).toEqual({ logseq: { kind: "block", role: "page" } });
});

test("logseq orphan property paragraphs keep local metadata only", () => {
  const source = "- block\n\norphan:: value\n";
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle(source, { logseq: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  const paragraph = root.children[1]!;

  expect(root.data).toEqual({ logseq: { kind: "block", role: "page" } });
  expect(paragraph.data?.logseq).toMatchObject({
    kind: "propertyGroup",
    authority: "source",
    properties: [{ key: "orphan", value: "value" }],
  });
});

test("logseq property detection ignores inline code", () => {
  const root = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("`key:: value`\n", { logseq: true }))),
  );
  if (root.type !== "root") throw new Error("expected root");
  expect(root.children[0]!.data).toBeUndefined();
});

test("logseq property detection ignores fenced code", () => {
  const root = materializeMdastTree(
    new MdastReader(
      serializeHandle(createMdastHandle("```\nkey:: value\n```\n", { logseq: true })),
    ),
  );
  if (root.type !== "root") throw new Error("expected root");
  expect(root.children[0]!.type).toBe("code");
  expect(root.children[0]!.data).toBeUndefined();
});

test("logseq property detection rejects non-property keys", () => {
  const prose = materializeMdastTree(
    new MdastReader(
      serializeHandle(createMdastHandle("not a property :: value\n", { logseq: true })),
    ),
  );
  const tagKey = materializeMdastTree(
    new MdastReader(serializeHandle(createMdastHandle("#tag:: value\n", { logseq: true }))),
  );
  if (prose.type !== "root" || tagKey.type !== "root") throw new Error("expected roots");
  expect(prose.children[0]!.data).toBeUndefined();
  expect(tagKey.children[0]!.data).toBeUndefined();
});

test("children are lazily evaluated (getter replaced by plain array after access)", () => {
  const { reader } = setup();
  const root = materializeMdastTree(reader);
  if (root.type !== "root") throw new Error("expected root");

  const beforeDesc = Object.getOwnPropertyDescriptor(root, "children");
  expect(typeof beforeDesc?.get === "function").toBe(true);

  const children = root.children;
  expect(Array.isArray(children)).toBe(true);

  const afterDesc = Object.getOwnPropertyDescriptor(root, "children");
  expect("get" in (afterDesc ?? {})).toBe(false);
  expect("value" in (afterDesc ?? {})).toBe(true);
});

// MDX JSX attribute tests

function mdxSetup(source: string) {
  const buf = serializeHandle(createMdxMdastHandle(source)) as Uint8Array;
  const reader = new MdastReader(buf);
  return { reader, tree: materializeMdastTree(reader) };
}

function findNode(node: MdastNode, type: string): any {
  if (node.type === type) return node;
  if ("children" in node && node.children) {
    for (const child of node.children) {
      const found = findNode(child, type);
      if (found) return found;
    }
  }
  return null;
}

describe("MDX JSX attributes on MDAST nodes", () => {
  test("self-closing element with no attributes", () => {
    const { tree } = mdxSetup("<Component />\n");
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx).not.toBeNull();
    expect(jsx.name).toBe("Component");
    expect(jsx.attributes).toEqual([]);
  });

  test("element with string literal attribute", () => {
    const { tree } = mdxSetup('<Component foo="bar" />\n');
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx.name).toBe("Component");
    expect(jsx.attributes).toEqual([{ type: "mdxJsxAttribute", name: "foo", value: "bar" }]);
  });

  test("element with boolean attribute", () => {
    const { tree } = mdxSetup("<Component disabled />\n");
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx.attributes).toEqual([{ type: "mdxJsxAttribute", name: "disabled", value: null }]);
  });

  test("element with expression attribute", () => {
    const { tree } = mdxSetup("<Component count={42} />\n");
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx.attributes).toEqual([
      {
        type: "mdxJsxAttribute",
        name: "count",
        value: { type: "mdxJsxAttributeValueExpression", value: "42" },
      },
    ]);
  });

  test("element with spread attribute", () => {
    const { tree } = mdxSetup("<Component {...props} />\n");
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx.attributes).toEqual([{ type: "mdxJsxExpressionAttribute", value: "...props" }]);
  });

  test("element with multiple mixed attributes", () => {
    const { tree } = mdxSetup('<Component a="1" b={2} c {...d} />\n');
    const jsx = findNode(tree, "mdxJsxFlowElement");
    expect(jsx.attributes).toHaveLength(4);
    expect(jsx.attributes[0]).toEqual({
      type: "mdxJsxAttribute",
      name: "a",
      value: "1",
    });
    expect(jsx.attributes[1]).toEqual({
      type: "mdxJsxAttribute",
      name: "b",
      value: { type: "mdxJsxAttributeValueExpression", value: "2" },
    });
    expect(jsx.attributes[2]).toEqual({
      type: "mdxJsxAttribute",
      name: "c",
      value: null,
    });
    expect(jsx.attributes[3]).toEqual({
      type: "mdxJsxExpressionAttribute",
      value: "...d",
    });
  });

  test("inline JSX text element with attributes", () => {
    const { tree } = mdxSetup('a <Comp x="y" /> b\n');
    const jsx = findNode(tree, "mdxJsxTextElement");
    expect(jsx).not.toBeNull();
    expect(jsx.name).toBe("Comp");
    expect(jsx.attributes).toEqual([{ type: "mdxJsxAttribute", name: "x", value: "y" }]);
  });

  test("fragment has null name and no attributes", () => {
    const { tree } = mdxSetup("a <>hello</> b\n");
    const jsx = findNode(tree, "mdxJsxTextElement");
    expect(jsx).not.toBeNull();
    expect(jsx.name).toBeNull();
    expect(jsx.attributes).toEqual([]);
  });
});
