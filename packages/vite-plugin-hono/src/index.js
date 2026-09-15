/** @import { Plugin } from 'vite' */
/** @import { DepScanTransformPlugin } from '@tsrx/core/types/vite/dep-scan' */
/** @import { RuntimeImportMode } from '@tsrx/hono' */

import { transformWithOxc } from 'vite';
import { compile as compileServer } from '@tsrx/hono';
import { compile as compileDom } from '@tsrx/hono/dom';
import { createDepScanTransformPlugin } from '@tsrx/core/vite/dep-scan';

const TSRX_EXTENSION_PATTERN = /\.tsrx$/;
const CSS_QUERY = '?tsrx-css&lang.css';

/**
 * @typedef {'server' | 'dom'} TsrxHonoMode
 * @typedef {{ code: string, map: unknown }} TsrxHonoTransformResult
 * Hono-specific adapters remain under `@tsrx/hono/*` in direct mode.
 *
 * @typedef {{
 *   mode?: TsrxHonoMode,
 *   runtimeImports?: RuntimeImportMode,
 * }} TsrxHonoPluginOptions
 */

/**
 * Compile `.tsrx` to Hono-flavoured TSX and finish the automatic JSX runtime
 * transform in Vite. The explicit mode keeps compiler-injected Hono helpers
 * aligned with the chosen `hono/jsx` or `hono/jsx/dom` runtime.
 *
 * @param {TsrxHonoPluginOptions} [options]
 * @returns {Plugin}
 */
export function tsrxHono(options = {}) {
	const mode = options.mode ?? 'server';
	const jsx_import_source = mode === 'dom' ? 'hono/jsx/dom' : 'hono/jsx';
	const compile = mode === 'dom' ? compileDom : compileServer;
	const compile_options = { runtimeImports: options.runtimeImports };

	/** @type {Map<string, string>} */
	const css_cache = new Map();

	/** @param {string} id @param {string | undefined} css */
	function cache_css(id, css) {
		// Retain ownership after CSS removal so HMR can serve an empty module.
		if (css || css_cache.has(id)) css_cache.set(id, css ?? '');
	}

	/** @param {string} id */
	function css_owner(id) {
		if (!id.endsWith(CSS_QUERY)) return null;
		const owner = id.slice(id.startsWith('\0') ? 1 : 0, -CSS_QUERY.length);
		return css_cache.has(owner) ? owner : null;
	}

	function update_css_cache(/** @type {string} */ source, /** @type {string} */ id) {
		const { css } = compile(source, id, compile_options);
		cache_css(id, css);
	}

	/** @param {string} code @param {string} id @param {string | undefined} css */
	function append_css_import(code, id, css) {
		cache_css(id, css);
		return css ? `${code}\nimport ${JSON.stringify(id + CSS_QUERY)};\n` : code;
	}

	return /** @type {Plugin} */ ({
		name: '@tsrx/vite-plugin-hono',
		enforce: 'pre',

		config() {
			return {
				optimizeDeps: {
					extensions: ['.tsrx'],
					rolldownOptions: {
						transform: { jsx: { importSource: jsx_import_source } },
						plugins: [create_dep_scan_plugin(jsx_import_source, compile_options, compile)],
					},
				},
			};
		},

		resolveId(source) {
			if (css_owner(source) === null) return null;
			if (source.startsWith('\0')) return source;
			return '\0' + source;
		},

		load(id) {
			if (!id.startsWith('\0')) return null;
			const owner = css_owner(id);
			return owner === null ? null : css_cache.get(owner);
		},

		buildStart() {
			css_cache.clear();
		},

		watchChange(id, { event }) {
			if (event === 'delete') css_cache.delete(id);
		},

		async transform(code, id) {
			if (!TSRX_EXTENSION_PATTERN.test(id)) return null;

			const result = compile(code, id, compile_options);
			const source = append_css_import(result.code, id, result.css);

			const transformed = await transformWithOxc(
				source,
				id,
				{
					lang: 'tsx',
					sourcemap: true,
					jsx: {
						runtime: 'automatic',
						importSource: jsx_import_source,
					},
					target: 'esnext',
				},
				result.map,
			);

			return { code: transformed.code, map: transformed.map };
		},

		async handleHotUpdate(ctx) {
			if (!TSRX_EXTENSION_PATTERN.test(ctx.file)) return;
			const css_module = ctx.server.moduleGraph.getModuleById('\0' + ctx.file + CSS_QUERY);
			if (!css_module) return ctx.modules;

			update_css_cache(await ctx.read(), ctx.file);

			ctx.server.moduleGraph.invalidateModule(css_module);
			return [...ctx.modules, css_module];
		},
	});
}

/**
 * @param {string} jsx_import_source
 * @param {{ runtimeImports?: RuntimeImportMode }} compile_options
 * @param {(code: string, id: string, options?: object) => { code: string }} compile
 * @returns {DepScanTransformPlugin}
 */
function create_dep_scan_plugin(jsx_import_source, compile_options, compile) {
	return createDepScanTransformPlugin({
		name: '@tsrx/vite-plugin-hono:dep-scan',
		filter: TSRX_EXTENSION_PATTERN,
		compile: (code, id) => compile(code, id, compile_options),
		imports: [jsx_import_source + '/jsx-runtime'],
	});
}

export default tsrxHono;
