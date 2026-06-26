# satteri-expressive-code

Sätteri HAST plugin that renders fenced code blocks with [Expressive Code](https://expressive-code.com): syntax highlighting via Shiki, editor and terminal frames, line markers, and a copy button. The Sätteri equivalent of [`rehype-expressive-code`](https://expressive-code.com).

The plugin model is documented at [satteri.bruits.org](https://satteri.bruits.org/docs/); code-block features, themes, and styling at [Expressive Code](https://expressive-code.com).

## Install

```sh
npm install satteri-expressive-code satteri
yarn add satteri-expressive-code satteri
pnpm add satteri-expressive-code satteri
```

`satteri` is a peer dependency.

## Usage

Pass the plugin to `hastPlugins`. It uses an async visitor, so the compile returns a `Promise`:

```ts
import { markdownToHtml } from "satteri";
import expressiveCode from "satteri-expressive-code";

const { html } = await markdownToHtml(source, {
  hastPlugins: [expressiveCode({ themes: ["github-dark", "github-light"] })],
});
```

The CSS and JS that Expressive Code needs are injected into the rendered HTML once per document, so the output is self-contained.

## Options

`expressiveCode(options?)` extends [`ExpressiveCodeConfig`](https://expressive-code.com) with:

| Option     | Type                                | Default                           | Effect                                                                     |
| ---------- | ----------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `themes`   | `(string \| ExpressiveCodeTheme)[]` | `["github-dark", "github-light"]` | Shiki theme names or theme objects; CSS variables are generated per theme. |
| `tabWidth` | `number`                            | `2`                               | Spaces a tab expands to in code blocks; `0` keeps tabs.                    |

All other `ExpressiveCodeConfig` options apply (style overrides, plugins, dark-mode handling). Advanced hooks — `getBlockLocale`, `customCreateBlock`, and `customCreateRenderer` — customise per-block creation and the renderer.

Everything from `expressive-code` is re-exported; its HAST types live at `satteri-expressive-code/hast`.

## Development

Refer to [CONTRIBUTING.md](https://github.com/bruits/satteri/blob/main/CONTRIBUTING.md) for development setup and workflow details.
