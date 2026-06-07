---
cargo/satteri-ast: patch
cargo/satteri-plugin-api: patch
npm/satteri: patch
---

Fixes `ctx.setProperty(node, "children", [...])`, which used to throw an error. You can now set a node's children directly, and any other properties you set on the same node still take effect.
