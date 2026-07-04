---
cargo/satteri-pulldown-cmark: patch
cargo/satteri-napi: patch
npm/satteri: patch
---

Parse Logseq-style tags as annotated link nodes when the Logseq feature is enabled. Tags like `#tag` and `#[[page tag]]` now materialize as ordinary mdast links with `data.logseq.kind` set to `"tag"`.
