import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { remark } from "remark";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { toHast } from "mdast-util-to-hast";
import { mdxToMdast, mdxToHast } from "./dist/index.js";

const argFiles = process.argv.slice(2);
let stdinFiles = [];
if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  stdinFiles = Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter((s) => s.length > 0);
}
const files = stdinFiles.length ? stdinFiles : argFiles;

const { remarkMarkAndUnravel } = await import(
  pathToFileURL("./node_modules/@mdx-js/mdx/lib/plugin/remark-mark-and-unravel.js").href
);
const refParser = remark()
  .use(remarkMdx)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkMarkAndUnravel);

const PASS_THROUGH = [
  "mdxJsxFlowElement",
  "mdxJsxTextElement",
  "mdxFlowExpression",
  "mdxTextExpression",
  "mdxjsEsm",
];
const empty = () => undefined;
const REF_HAST_OPTS = {
  allowDangerousHtml: true,
  passThrough: PASS_THROUGH,
  handlers: { containerDirective: empty, leafDirective: empty, textDirective: empty },
};

function normalizeAlignToStyle(node) {
  if (typeof node !== "object" || node === null) return node;
  const out = { ...node };
  if (out.properties && typeof out.properties === "object") {
    const props = { ...out.properties };
    if (typeof props.align === "string") {
      props.style = `text-align: ${props.align}`;
      delete props.align;
    }
    out.properties = props;
  }
  if (Array.isArray(out.children)) {
    out.children = out.children.map(normalizeAlignToStyle);
  }
  return out;
}

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
function ser(o) {
  return JSON.stringify(canonical(strip(o)));
}

let mdastOK = 0, mdastFail = 0, mdastThrow = 0;
let hastOK = 0, hastFail = 0, hastThrow = 0;
const mdastDiffs = [];
const hastDiffs = [];
const throws = { ref: [], sat: [] };

for (const file of files) {
  let input;
  try { input = readFileSync(file, "utf8"); } catch { continue; }
  let refMdast, satMdast;
  try { refMdast = refParser.runSync(refParser.parse(input)); }
  catch (e) { throws.ref.push({ file, msg: e.message }); mdastThrow++; continue; }
  try { satMdast = mdxToMdast(input, { features: { gfm: true, frontmatter: true, directive: true, math: false } }); }
  catch (e) { throws.sat.push({ file, msg: e.message }); mdastThrow++; continue; }
  if (ser(refMdast) === ser(satMdast)) mdastOK++; else { mdastFail++; mdastDiffs.push(file); }

  let refHast, satHast;
  try { refHast = toHast(refMdast, REF_HAST_OPTS); }
  catch (e) { throws.ref.push({ file, msg: e.message }); hastThrow++; continue; }
  try { satHast = mdxToHast(input, { features: { gfm: true, frontmatter: true, directive: true, math: false } }); }
  catch (e) { throws.sat.push({ file, msg: e.message }); hastThrow++; continue; }
  const refHastNorm = normalizeAlignToStyle(refHast);
  if (ser(refHastNorm) === ser(satHast)) hastOK++;
  else { hastFail++; hastDiffs.push(file); }
}

console.log(JSON.stringify({
  total: files.length,
  mdast: { ok: mdastOK, fail: mdastFail, throws: mdastThrow },
  hast: { ok: hastOK, fail: hastFail, throws: hastThrow },
  mdastFails: mdastDiffs,
  hastFails: hastDiffs,
  throws: { ref: throws.ref.slice(0, 5), sat: throws.sat.slice(0, 5) },
}, null, 2));
