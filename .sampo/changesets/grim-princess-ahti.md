---
cargo/satteri-plugin-api: patch
npm/satteri: patch
---

Fixed numeric property values (e.g. `width: 16`, `start: 5`) being silently dropped when set on elements from JS plugins.
