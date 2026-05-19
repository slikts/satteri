---
cargo/satteri-mdxjs: patch
npm/satteri: patch
---

Fix a crash when an MDX file defines a component with `export const`, `export function`, or `export class` and then uses it as a JSX tag. Previously the component would be treated as if it had to come from `props.components`, and rendering threw "Expected component X to be defined" unless you also passed it in. It now resolves to the locally-defined component as expected.
