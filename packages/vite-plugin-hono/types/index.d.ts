import type { Plugin } from 'vite';
import type { RuntimeImportMode } from '@tsrx/hono';

export type TsrxHonoMode = 'server' | 'dom';

export interface TsrxHonoPluginOptions {
	/** Selects `hono/jsx` or `hono/jsx/dom`; defaults to `server`. */
	mode?: TsrxHonoMode;
	/**
	 * Direct mode uses `@tsrx/core/runtime/*` for shared helpers. Hono-specific
	 * adapters remain under `@tsrx/hono/*` because Hono has no standalone runtime.
	 */
	runtimeImports?: RuntimeImportMode;
}

export interface TsrxHonoTransformResult {
	code: string;
	map: unknown;
}

export function tsrxHono(options?: TsrxHonoPluginOptions): Plugin;
export default tsrxHono;
