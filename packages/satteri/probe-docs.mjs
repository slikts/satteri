import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { remark } from "remark";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { mdxToMdast } from "./dist/index.js";

const { remarkMarkAndUnravel } = await import(
  pathToFileURL("./node_modules/@mdx-js/mdx/lib/plugin/remark-mark-and-unravel.js").href
);
const refParser = remark()
  .use(remarkMdx)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMarkAndUnravel);

function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "position" || k === "data") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}
function canonical(o) {
  if (Array.isArray(o)) return o.map(canonical);
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = canonical(o[k]);
    return out;
  }
  return o;
}

const file = process.argv[2];
const input = readFileSync(file, "utf8");
const refTree = refParser.runSync(refParser.parse(input));
const satTree = mdxToMdast(input, { features: { gfm: true, frontmatter: true, directive: true } });
const ref = JSON.stringify(canonical(strip(refTree)), null, 2);
const sat = JSON.stringify(canonical(strip(satTree)), null, 2);
const refL = ref.split("\n");
const satL = sat.split("\n");
let diffs = 0;
for (let i = 0; i < Math.min(refL.length, satL.length); i++) {
  if (refL[i] !== satL[i]) {
    diffs++;
    if (diffs <= 3) {
      console.log(`Line ${i}:\n  REF: ${refL[i]}\n  SAT: ${satL[i]}`);
      console.log(`  Context (prev 3): ${refL.slice(Math.max(0, i - 3), i).join(" | ")}`);
    }
  }
}
console.log(`Total differing lines: ${diffs}`);
