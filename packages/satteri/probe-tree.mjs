import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { remark } from "remark";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";

const { remarkMarkAndUnravel } = await import(
  pathToFileURL("./node_modules/@mdx-js/mdx/lib/plugin/remark-mark-and-unravel.js").href
);
const refParser = remark()
  .use(remarkMdx)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMarkAndUnravel);

const file = process.argv[2];
const input = readFileSync(file, "utf8");
const refTree = refParser.runSync(refParser.parse(input));

function summarize(node, depth) {
  const pad = "  ".repeat(depth);
  const pos = node.position
    ? `${node.position.start.line}:${node.position.start.column}-${node.position.end.line}:${node.position.end.column}`
    : "";
  const extra = node.name
    ? `[${node.name}]`
    : node.value
      ? ` ${JSON.stringify(node.value).slice(0, 60)}`
      : "";
  console.log(`${pad}${node.type} ${pos} ${extra}`);
  if (node.children) for (const c of node.children) summarize(c, depth + 1);
  if (node.attributes)
    for (const a of node.attributes) {
      if (a.value && typeof a.value === "object") {
        console.log(`${pad}  attr ${a.name}: ${JSON.stringify(a.value.value).slice(0, 100)}`);
        if (a.value.position) {
          console.log(
            `${pad}    val pos: ${a.value.position.start.line}:${a.value.position.start.column}-${a.value.position.end.line}:${a.value.position.end.column}`,
          );
        }
      }
    }
}
summarize(refTree, 0);
