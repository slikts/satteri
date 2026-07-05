import { copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename } from "node:path";

const root = new URL("..", import.meta.url);
const source = new URL("../packages/satteri/", import.meta.url);

const fixedArtifacts = [
  "browser.js",
  "index.js",
  "index.d.ts",
  "webcontainer-fallback.cjs",
];

await rm(new URL("dist", root), { force: true, recursive: true });
await cp(new URL("dist", source), new URL("dist", root), { recursive: true });

for (const artifact of fixedArtifacts) {
  await copyFile(new URL(artifact, source), new URL(artifact, root));
}

for (const entry of await readdir(source)) {
  if (
    /^satteri_napi\..*\.node$/.test(entry) ||
    /^satteri_napi\.wasi.*\.(?:cjs|js)$/.test(entry)
  ) {
    await copyFile(new URL(entry, source), new URL(entry, root));
  }
}

await mkdir(new URL("dist", root), { recursive: true });
console.log(`Copied Satteri package artifacts from ${basename(source.pathname)}`);
