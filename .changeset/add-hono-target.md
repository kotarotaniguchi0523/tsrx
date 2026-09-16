---
'@tsrx/hono': patch
'@tsrx/vite-plugin-hono': patch
'@tsrx/bun-plugin-hono': patch
'@tsrx/typescript-plugin': patch
'@tsrx/mcp': patch
---

Add Hono server and DOM compiler targets with Vite and Bun integrations. The
compilers and build integrations support the shared compile-time platform flags;
DOM editor selection remains explicit, and DOM async-component validation stays
conservative and same-module.

Respect later object-property overrides during DOM async-component validation,
and add server/DOM targets and supported examples to the website playground.
