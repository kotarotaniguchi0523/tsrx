---
'@tsrx/hono': patch
'@tsrx/vite-plugin-hono': patch
'@tsrx/bun-plugin-hono': patch
'@tsrx/mcp': patch
---

Require Hono 4.13.7 or newer in the 4.x series for JSX security fixes and Vite 8
for its Oxc API. Use Hono's public boundary types, remove unused compiler
dependencies, and validate named async component expressions correctly.

Select the Hono DOM compiler for MCP client mode. Limit Vite virtual CSS handling
to modules owned by the plugin and clear stale CSS across builds and deletions.

Use core lexical scope analysis when rejecting async Hono DOM components, and
keep Hono's documented server, streaming, context, hook, CSS, and DOM runtime
APIs available without TSRX-specific substitutes.

Preserve Hono's `StreamingContext` nonce through TSRX ErrorBoundary output and
typecheck the Hono TSRX integration tests with `tsrx-tsc`.
