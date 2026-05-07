---
npm/satteri: minor
---

Added factory-shape support to `hastPlugins` and `mdastPlugins`: each entry can now be a function returning a plugin definition, called once per compile. This is useful for stateful plugins.
