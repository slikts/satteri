---
cargo/satteri-ast: patch
cargo/satteri-pulldown-cmark: patch
cargo/satteri-plugin-api: patch
cargo/satteri-mdxjs: patch
npm/satteri: patch
---

Fixed plugin-inserted MDX JSX elements compiling as literal HTML tags instead of routing through `_components`, which prevented user overrides via the `components` prop.
