# Hono Playground

This playground exercises the Hono JSX DOM target through Vite. The server target
is the default for `@tsrx/vite-plugin-hono`; the playground selects the DOM target
explicitly because it runs in a browser.

## Run

```bash
pnpm install
pnpm run dev
```

The source uses `@tsrx/hono/dom` in `tsconfig.json` so the TypeScript plugin and
Vite transform select the same target.
