# Sätteri

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://codspeed.io/bruits/satteri?utm_source=badge)

High-performance Markdown and MDX processing. Powered by a Rust arena backend with zero-copy binary transfer to JavaScript, and a plugin system for custom transformations.

Don't know where to start? Check out our npm package's [ documentation](./packages/satteri/README.md).

## Packages

Sätteri is a Rust + TypeScript monorepo, that contains the following crates (Rust packages):

| Name                     | Description                                                                    | README                                              |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `satteri`                | High-level Rust API for the Sätteri markdown/MDX pipeline                      | _—_                                                 |
| `satteri-arena`          | Arena allocator and binary buffer primitives                                   | _—_                                                 |
| `satteri-mdast`          | Arena-allocated MDAST nodes with zero-copy references and binary buffer format | [README](./crates/satteri-mdast/README.md)          |
| `satteri-hast`           | MDAST → HAST conversion and HTML serialization                                 | [README](./crates/satteri-hast/README.md)           |
| `satteri-plugin-api`     | Rust `Plugin` trait, typed visitors, and runner                                | [README](./crates/satteri-plugin-api/README.md)     |
| `satteri-napi`           | NAPI bindings exposing the Rust pipeline to Node.js                            | [README](./crates/satteri-napi-binding/README.md)   |
| `satteri-mdxjs`          | MDX → JavaScript compiler — fork of [mdxjs-rs] adapted for pulldown-cmark      | _—_                                                 |
| `satteri-pulldown-cmark` | Vendored CommonMark parser with MDX extension support                          | [README](./crates/satteri-pulldown-cmark/README.md) |
| `satteri-bench`          | Benchmarks and profiling harnesses for the pipeline                            | [README](./crates/bench/README.md)                  |

Sätteri also includes the following npm package:

| Name             | Description                                                                                           | Registry | README                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------- | -------------------------------------- |
| [`satteri`][npm] | TypeScript layer: binary buffer readers, visitor pattern, plugin API, and top-level compile functions | _WIP_    | [README](./packages/satteri/README.md) |

## Acknowledgements

Sätteri builds on the work of several open-source projects:

- [unifiedjs] — ecosystem of tools for processing content with syntax trees, including [remark](https://github.com/remarkjs/remark) and [rehype](https://github.com/rehypejs/rehype) which this project takes a lot of inspiration from
- [pulldown-cmark] — Rust CommonMark pull parser
- [mdxjs-rs] — original MDX compiler by Titus Wormer, forked to use pulldown-cmark and oxc

Sätteri is an open-source project born from [Bruits](https://bruits.org/), a Rust-focused collective 💛

[unifiedjs]: https://unifiedjs.com/
[pulldown-cmark]: https://github.com/pulldown-cmark/pulldown-cmark
[mdxjs-rs]: https://github.com/wooorm/mdxjs-rs
[npm]: https://www.npmjs.com/package/satteri
