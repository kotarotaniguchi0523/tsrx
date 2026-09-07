// The Hono package is a runtime peer of @tsrx/hono. This narrow declaration
// keeps the adapter source type-checkable in the TSRX workspace, where Hono's
// published package is intentionally not installed as a compiler dependency.
declare module 'hono/jsx' {
	export const ErrorBoundary: (props: Record<string, unknown>) => unknown;
}

declare module 'hono/jsx/dom' {
	export const ErrorBoundary: (props: Record<string, unknown>) => unknown;
}
