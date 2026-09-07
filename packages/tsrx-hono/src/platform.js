/** @import * as AST from 'estree' */
/** @import * as ESTreeJSX from 'estree-jsx' */
/** @import { JsxPlatform, JsxTransformContext } from '@tsrx/core/types' */

import { builders as b, createJsxTransform, error } from '@tsrx/core';

const HonoServerSource = 'hono/jsx';
const HonoDomSource = 'hono/jsx/dom';

/**
 * The Hono JSX runtimes accept authored `class` attributes and expose their
 * own Fragment/Suspense/ErrorBoundary components. The compiler-only Dynamic
 * import is needed for type-only output; production output aliases a dynamic
 * tag to a local component binding and therefore needs no runtime Dynamic
 * component.
 *
 * @param {'server' | 'dom'} mode
 * @returns {JsxPlatform}
 */
function create_hono_platform(mode) {
	const dom = mode === 'dom';
	const jsx_source = dom ? HonoDomSource : HonoServerSource;

	return {
		name: dom ? 'Hono JSX DOM' : 'Hono JSX',
		imports: {
			fragment: jsx_source,
			suspense: jsx_source,
			dynamic: '@tsrx/hono/dynamic',
			dynamicFactory: {},
			errorBoundary: dom ? '@tsrx/hono/dom/error-boundary' : '@tsrx/hono/error-boundary',
			mergeRefs: '@tsrx/hono/ref',
			refProp: '@tsrx/hono/ref',
			forOfIterableHelper: '@tsrx/hono/runtime/iterable',
		},
		directRuntimeImports: {
			mergeRefs: '@tsrx/core/runtime/ref',
			refProp: '@tsrx/core/runtime/ref',
			forOfIterableHelper: '@tsrx/core/runtime/iterable',
		},
		jsx: {
			rewriteClassAttr: false,
			classAttrName: 'class',
			multiRefStrategy: 'merge-refs',
		},
		validation: {
			// Server JSX supports async function components. The DOM renderer is
			// synchronous; use Hono's `use(promise)` + Suspense there instead.
			requireUseServerForAwait: dom,
		},
		...(dom
			? {
					hooks: {
						// Hono DOM keys hook state by the runtime component function. A
						// helper recreated inside its parent would lose state on updates.
						moduleScopedHookComponents: true,
						// Hono DOM JSX nodes carry mutable reconciliation state (`e`,
						// `vC`, and hook stash) on the node object itself. Reusing any
						// module-scoped node across mounts is therefore unsafe, not only
						// reusing composite nodes.
						canHoistStaticNode() {
							return false;
						},
						validateComponentAwait(await_node, _component, ctx) {
							error(
								'Hono JSX DOM does not support top-level `await` in components. Use `use(promise)` with `<Suspense>` instead.',
								ctx.filename,
								await_node,
								ctx.errors,
								ctx.comments,
							);
						},
						createErrorBoundary(try_content, _raw_try_content, fallback_fn, ctx, node) {
							return create_hono_error_boundary(try_content, fallback_fn, ctx, node);
						},
					},
				}
			: {
					hooks: {
						createErrorBoundary(try_content, _raw_try_content, fallback_fn, ctx, node) {
							return create_hono_error_boundary(try_content, fallback_fn, ctx, node);
						},
					},
				}),
	};
}

/**
 * Hono names the callback prop `fallbackRender` and invokes it with only the
 * error. TSRX's default React-shaped output uses `fallback={(error, reset) =>
 * ...}`, which would be rendered as a function value by Hono. Adapt the
 * boundary explicitly and reject the unsupported reset contract.
 *
 * @param {ESTreeJSX.JSXRenderNode} try_content
 * @param {AST.ArrowFunctionExpression} fallback_fn
 * @param {JsxTransformContext} ctx
 * @param {AST.TryStatement} node
 * @returns {ESTreeJSX.JSXRenderNode}
 */
function create_hono_error_boundary(try_content, fallback_fn, ctx, node) {
	const reset_param = node.handler?.resetParam;
	if (reset_param) {
		error(
			'Hono JSX ErrorBoundary does not provide a reset callback. Use `@catch (error)` without a reset parameter.',
			ctx.filename,
			reset_param,
			ctx.errors,
			ctx.comments,
		);
	}

	const name = b.jsx_id('TsrxErrorBoundary');
	const fallback_render = b.jsx_attribute(
		b.jsx_id('fallbackRender'),
		b.jsx_expression_container(fallback_fn),
	);
	return b.jsx_element_fresh(
		b.jsx_opening_element(name, [fallback_render], false),
		b.jsx_closing_element(b.jsx_id('TsrxErrorBoundary')),
		[try_content],
	);
}

export const hono_server_transform = createJsxTransform(create_hono_platform('server'));
export const hono_dom_transform = createJsxTransform(create_hono_platform('dom'));

/**
 * Hono DOM renders components synchronously. Its renderer does not unwrap a
 * Promise returned by an async component, even when the component itself does
 * not contain an `await`; async work must be represented with `use(promise)`
 * inside `<Suspense>` instead.
 *
 * @param {AST.Program} ast
 * @param {string} filename
 * @param {{ errors?: import('@tsrx/core/types').CompileError[], comments: AST.CommentWithLocation[] }} context
 */
export function validate_hono_dom_components(ast, filename, context) {
	const component = find_async_jsx_function(ast);
	if (!component) return;

	error(
		'Hono JSX DOM does not support async components. Use use(promise) with <Suspense> instead.',
		filename,
		component,
		context.errors,
		context.comments,
	);
}

/**
 * Find the first async function whose own body produces JSX. JSX nested in a
 * call such as `render(<App />)` is a consumer expression, not an async
 * component, and must not be rejected.
 *
 * @param {AST.Node | AST.Node[] | null | undefined} node
 * @returns {AST.Function | null}
 */
function find_async_jsx_function(node) {
	if (!node) return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = find_async_jsx_function(child);
			if (found) return found;
		}
		return null;
	}
	if (typeof node !== 'object') return null;

	if (is_function_node(node)) {
		if (node.async && function_body_contains_rendered_jsx(node.body)) {
			return node;
		}
		return find_async_jsx_function(node.body);
	}

	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
		const found = find_async_jsx_function(/** @type {AST.Node | AST.Node[] | null} */ (value));
		if (found) return found;
	}
	return null;
}

/**
 * @param {AST.Node | AST.Node[] | null | undefined} node
 * @returns {boolean}
 */
function function_body_contains_rendered_jsx(node) {
	if (!node) return false;
	if (Array.isArray(node)) return node.some(function_body_contains_rendered_jsx);
	if (typeof node !== 'object') return false;
	if (is_function_node(node)) return false;
	if (node.type === 'JSXCodeBlock' || node.type?.startsWith('JSX')) return true;
	if (node.type === 'CallExpression' || node.type === 'NewExpression') return false;
	if (node.type === 'ReturnStatement') return expression_contains_jsx(node.argument);

	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
		if (function_body_contains_rendered_jsx(/** @type {AST.Node | AST.Node[] | null} */ (value)))
			return true;
	}
	return false;
}

/**
 * @param {AST.Node | null | undefined} node
 * @returns {boolean}
 */
function expression_contains_jsx(node) {
	if (!node || typeof node !== 'object') return false;
	if (node.type?.startsWith('JSX')) return true;
	if (node.type === 'CallExpression' || node.type === 'NewExpression') return false;

	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
		if (Array.isArray(value)) {
			if (value.some((child) => expression_contains_jsx(child))) return true;
		} else if (expression_contains_jsx(/** @type {AST.Node | null} */ (value))) {
			return true;
		}
	}
	return false;
}

/**
 * @param {AST.Node} node
 * @returns {node is AST.Function}
 */
function is_function_node(node) {
	return (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression'
	);
}
