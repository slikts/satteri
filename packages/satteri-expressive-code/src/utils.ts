import type { Element } from "expressive-code/hast";

export function getCodeBlockInfo(pre: Element) {
  if (pre.tagName !== "pre") return;
  const [code, ...rest] = pre.children;
  if (rest.length || !code || code.type !== "element" || code.tagName !== "code") return;
  const [text] = code.children;
  if (!text || text.type !== "text") return;
  const data = code.data as { lang?: string; meta?: string } | null | undefined;
  return {
    pre,
    code,
    lang: data?.lang ?? "",
    text: text.value,
    meta: data?.meta ?? "",
  };
}
