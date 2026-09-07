import type { BunPlugin } from 'bun';
import type { RuntimeImportMode } from '@tsrx/hono';

export type TsrxHonoMode = 'server' | 'dom';

export interface TsrxHonoBunPluginOptions {
	/** Selects `hono/jsx` or `hono/jsx/dom`; defaults to `server`. */
	mode?: TsrxHonoMode;
	runtimeImports?: RuntimeImportMode;
	include?: RegExp;
	exclude?: RegExp | RegExp[];
	emitCss?: boolean;
}

export function tsrxHono(options?: TsrxHonoBunPluginOptions): BunPlugin;
export default tsrxHono;
