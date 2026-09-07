/** @import * as AST from 'estree' */
/** @import { BaseCompileOptions, CompileError, CompileResult, JsxTransformOptions, JsxTransformResult, ParseOptions, VolarMappingsResult } from '@tsrx/core/types' */
/** @import { NonEmptyString } from '@tsrx/core/types/helpers' */

import { analyzeTsrx, createVolarMappingsResult, dedupeMappings, parseModule } from '@tsrx/core';

/**
 * Create the public compiler facade shared by the Hono server and DOM targets.
 *
 * @param {(ast: AST.Program, source: string, filename?: string, options?: JsxTransformOptions) => JsxTransformResult} transform
 * @param {{ typeOnlyModuleScopedHookComponents?: boolean }} [settings]
 */
export function createCompiler(transform, settings = {}) {
	/**
	 * @param {string} source
	 * @param {NonEmptyString<string>} filename
	 * @param {ParseOptions} [options]
	 * @returns {AST.Program}
	 */
	function parse(source, filename, options) {
		return parseModule(source, filename, options);
	}

	/**
	 * @param {string} source
	 * @param {NonEmptyString<string>} filename
	 * @param {BaseCompileOptions} [options]
	 * @returns {CompileResult}
	 */
	function compile(source, filename, options) {
		const errors = /** @type {CompileError[]} */ ([]);
		const comments = /** @type {AST.CommentWithLocation[]} */ ([]);
		const collect = !!(options?.collect || options?.loose);
		const ast = parseModule(
			source,
			filename,
			collect ? { collect: true, loose: !!options?.loose, errors, comments } : undefined,
		);
		analyzeTsrx(
			ast,
			filename,
			collect ? { collect: true, loose: !!options?.loose, errors, comments } : undefined,
		);
		const { ast: _ast, ...result } = transform(
			ast,
			source,
			filename,
			collect ? { ...options, collect: true, loose: !!options?.loose, errors, comments } : options,
		);
		return { ...result, errors };
	}

	/**
	 * @param {string} source
	 * @param {NonEmptyString<string>} filename
	 * @param {ParseOptions & BaseCompileOptions} [options]
	 * @returns {VolarMappingsResult}
	 */
	function compile_to_volar_mappings(source, filename, options) {
		const errors = /** @type {CompileError[]} */ ([]);
		const comments = /** @type {AST.CommentWithLocation[]} */ ([]);
		const ast = parseModule(source, filename, {
			...options,
			collect: true,
			loose: !!options?.loose,
			preserveParens: true,
			keywordTokens: true,
			errors,
			comments,
		});
		analyzeTsrx(ast, filename, {
			collect: true,
			loose: !!options?.loose,
			typeOnly: true,
			errors,
			comments,
		});
		const transformed = transform(ast, source, filename, {
			...options,
			collect: true,
			loose: !!options?.loose,
			typeOnly: true,
			moduleScopedHookComponents: settings.typeOnlyModuleScopedHookComponents ?? false,
			errors,
			comments,
		});
		const result = createVolarMappingsResult({
			ast: transformed.ast,
			ast_from_source: ast,
			source,
			generated_code: transformed.code,
			source_map: transformed.map,
			errors,
		});

		return {
			...result,
			mappings: dedupeMappings(result.mappings),
		};
	}

	return { parse, compile, compile_to_volar_mappings };
}
