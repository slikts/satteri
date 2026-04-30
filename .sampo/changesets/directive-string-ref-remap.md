---
cargo/satteri-ast: patch
npm/satteri: patch
---

Fix a crash when an MDAST plugin returns a tree containing a directive
(`containerDirective` / `leafDirective` / `textDirective`) and the surrounding
document contains multi-byte text (e.g. Devanagari, CJK).
