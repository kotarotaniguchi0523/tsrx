# @tsrx/bun-plugin-hono

Bun plugin for compiling `@tsrx/hono` `.tsrx` files.

## Installation

```bash
pnpm add hono
pnpm add -D @tsrx/bun-plugin-hono
```

## Usage

```ts
import tsrxHono from '@tsrx/bun-plugin-hono';

await Bun.build({
  entrypoints: ['./src/App.tsrx'],
  outdir: './dist',
  plugins: [tsrxHono()],
});
```

The default `server` mode targets `hono/jsx`. Use `tsrxHono({ mode: 'dom' })` for
browser builds targeting `hono/jsx/dom`. The plugin runs Bun's automatic JSX
transform and emits TSRX `<style>` blocks as virtual CSS modules.

For `bun:test`, register the plugin from a preload:

```ts
import tsrxHono from '@tsrx/bun-plugin-hono';

Bun.plugin(tsrxHono());
```

Options are `mode`, `runtimeImports`, `emitCss`, `include`, and `exclude`.

`runtimeImports: 'direct'` is a limited helper-import mode for Hono: shared
helpers use `@tsrx/core/runtime/*`, while Hono-specific adapters still use
`@tsrx/hono/*` because Hono has no separate standalone runtime package. If the
compiled modules are published or built with direct imports, declare both packages
directly:

```bash
pnpm add @tsrx/core @tsrx/hono hono
```
