/**
 * End-to-end pipeline benchmarks using the public API.
 *
 * Requires the native Rust module to be built:
 *   pnpm build:native
 *
 * Run with: pnpm bench
 */

import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import {
  markdownToHtml,
  mdxToJs,
  markdownToMdast,
  mdxToMdast,
  markdownToHast,
  mdxToHast,
  defineHastPlugin,
  defineMdastPlugin,
} from "../src/index.js";
import type { HastNode } from "../src/hast/hast-materializer.js";
import type { HastVisitorContext } from "../src/hast/hast-visitor.js";

const MARKDOWN = readFileSync(new URL("./fixtures/markdown.md", import.meta.url), "utf8");
const MDX = readFileSync(new URL("./fixtures/document.mdx", import.meta.url), "utf8");

const noopHastPlugin = defineHastPlugin({
  name: "noop",
  createOnce: () => ({
    element: { filter: [], visit() {} },
  }),
});

const filteredHastPlugin = defineHastPlugin({
  name: "filtered",
  createOnce: () => ({
    element: {
      filter: ["a"],
      visit(_node: HastNode, _ctx: HastVisitorContext) {},
    },
  }),
});

const mutatingHastPlugin = defineHastPlugin({
  name: "mutating",
  createOnce: () => ({
    element: {
      filter: ["h1", "h2", "h3"],
      visit(node: HastNode, ctx: HastVisitorContext) {
        ctx.setProperty(node, "id", "heading");
      },
    },
  }),
});

const noopMdastPlugin = defineMdastPlugin({
  name: "noop-mdast",
  createOnce: () => ({ heading() {} }),
});

describe("markdownToHtml", () => {
  bench("no plugins", () => {
    markdownToHtml(MARKDOWN);
  });

  bench("noop HAST plugin (all elements)", () => {
    markdownToHtml(MARKDOWN, { hastPlugins: [noopHastPlugin] });
  });

  bench("filtered HAST plugin ([a] only)", () => {
    markdownToHtml(MARKDOWN, { hastPlugins: [filteredHastPlugin] });
  });

  bench("mutating HAST plugin (set id on headings)", () => {
    markdownToHtml(MARKDOWN, { hastPlugins: [mutatingHastPlugin] });
  });

  bench("noop MDAST plugin", () => {
    markdownToHtml(MARKDOWN, { mdastPlugins: [noopMdastPlugin] });
  });

  bench("MDAST + HAST plugins", () => {
    markdownToHtml(MARKDOWN, {
      mdastPlugins: [noopMdastPlugin],
      hastPlugins: [mutatingHastPlugin],
    });
  });
});

describe("mdxToJs", () => {
  bench("no plugins", () => {
    mdxToJs(MDX);
  });

  bench("noop HAST plugin", () => {
    mdxToJs(MDX, { hastPlugins: [noopHastPlugin] });
  });

  bench("MDAST + HAST plugins", () => {
    mdxToJs(MDX, {
      mdastPlugins: [noopMdastPlugin],
      hastPlugins: [mutatingHastPlugin],
    });
  });
});

describe("markdownToMdast", () => {
  bench("markdown", () => {
    markdownToMdast(MARKDOWN);
  });
});

describe("mdxToMdast", () => {
  bench("mdx", () => {
    mdxToMdast(MDX);
  });
});

describe("markdownToHast", () => {
  bench("markdown", () => {
    markdownToHast(MARKDOWN);
  });
});

describe("mdxToHast", () => {
  bench("mdx", () => {
    mdxToHast(MDX);
  });
});
