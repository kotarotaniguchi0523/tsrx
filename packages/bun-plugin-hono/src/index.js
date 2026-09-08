/** @import { BunPlugin, Target, Transpiler } from 'bun' */
/** @import { RuntimeImportMode } from '@tsrx/hono' */

import { readFile } from 'node:fs/promises';
import { compile as compileServer } from '@tsrx/hono';
import { compile as compileDom } from '@tsrx/hono/dom';

const DEFAULT_INCLUDE = /\.tsrx$/;
const CSS_QUERY = '?tsrx-css&lang.css';
const CSS_QUERY_PATTERN = /\?tsrx-css&lang\.css$/;

/**
 * @typedef {'server' | 'dom'} TsrxHonoMode
 * Hono-specific adapters remain under `@tsrx/hono/*` in direct mode.
 *
 * @typedef {{
 *   mode?: TsrxHonoMode,
 *   include?: RegExp,
 *   exclude?: RegExp | RegExp[],
 *   emitCss?: boolean,
 *   runtimeImports?: RuntimeImportMode,
 * }} TsrxHonoBunPluginOptions
 */

/** @param {RegExp} pattern @param {string} value */
function test_pattern(pattern, value) {
	pattern.lastIndex = 0;
	return pattern.test(value);
}

/** @param {RegExp | RegExp[] | undefined} pattern @param {string} value */
function matches_pattern(pattern, value) {
	if (!pattern) return false;
	if (Array.isArray(pattern)) return pattern.some((entry) => test_pattern(entry, value));
	return test_pattern(pattern, value);
}

/** @param {TsrxHonoBunPluginOptions} options @param {string} value */
function should_compile(options, value) {
	const include = options.include ?? DEFAULT_INCLUDE;
	return test_pattern(include, value) && !matches_pattern(options.exclude, value);
}

/** @param {string} jsx_import_source @param {Target | undefined} target */
function create_transpiler(jsx_import_source, target) {
	const Transpiler = globalThis.Bun?.Transpiler;
	if (typeof Transpiler !== 'function') {
		throw new Error(
			'@tsrx/bun-plugin-hono requires Bun.Transpiler to select the configured Hono JSX runtime.',
		);
	}

	return new Transpiler({
		loader: 'tsx',
		target,
		autoImportJSX: true,
		tsconfig: {
			compilerOptions: {
				jsx: 'react-jsx',
				jsxImportSource: jsx_import_source,
			},
		},
	});
}

/**
 * Compile `.tsrx` files and pass the resulting TSX through Bun's automatic
 * JSX transform. Hono's server and DOM runtimes are explicit modes because
 * changing only the JSX import source would leave compiler-injected helpers
 * pointed at the wrong runtime.
 *
 * @param {TsrxHonoBunPluginOptions} [options]
 * @returns {BunPlugin}
 */
export function tsrxHono(options = {}) {
	const mode = options.mode ?? 'server';
	const jsx_import_source = mode === 'dom' ? 'hono/jsx/dom' : 'hono/jsx';
	const compile = mode === 'dom' ? compileDom : compileServer;
	const emit_css = options.emitCss ?? true;
	const compile_options = { runtimeImports: options.runtimeImports };

	/** @type {Map<string, string>} */
	const css_cache = new Map();

	/** @param {string} code @param {string} id @param {string | undefined} css @param {boolean} emit_css */
	function append_css_import(code, id, css, emit_css) {
		if (!emit_css || !css) {
			css_cache.delete(id);
			return code;
		}
		css_cache.set(id, css);
		return `${code}\nimport ${JSON.stringify(id)};\n`;
	}

	return {
		name: '@tsrx/bun-plugin-hono',

		setup(build) {
			const build_config = build.config ?? {};
			const transpiler = create_transpiler(jsx_import_source, build_config.target);

			build.onResolve({ filter: CSS_QUERY_PATTERN }, (args) => ({ path: args.path }));

			build.onLoad({ filter: CSS_QUERY_PATTERN }, (args) => ({
				contents: css_cache.get(args.path) ?? '',
				loader: 'css',
			}));

			build.onLoad(
				{ filter: options.include ?? DEFAULT_INCLUDE, namespace: 'file' },
				async (args) => {
					if (!should_compile(options, args.path)) return undefined;

					const source = await readFile(args.path, 'utf-8');
					const { code, css } = compile(source, args.path, compile_options);
					const css_id = args.path + CSS_QUERY;
					const output = append_css_import(code, css_id, css, emit_css);

					return { contents: transpiler.transformSync(output), loader: 'js' };
				},
			);
		},
	};
}

export default tsrxHono;
