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
	const is_dom = mode === 'dom';
	const jsx_source = is_dom ? HonoDomSource : HonoServerSource;
	/** @type {NonNullable<JsxPlatform['hooks']>} */
	const hooks = {
		createErrorBoundary(try_content, _raw_try_content, fallback_fn, ctx, node) {
			return create_hono_error_boundary(try_content, fallback_fn, ctx, node);
		},
		...(is_dom
			? {
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
				}
			: {}),
	};

	return {
		name: is_dom ? 'Hono JSX DOM' : 'Hono JSX',
		imports: {
			fragment: jsx_source,
			suspense: jsx_source,
			dynamic: '@tsrx/hono/dynamic',
			dynamicFactory: {},
			errorBoundary: is_dom ? '@tsrx/hono/dom/error-boundary' : '@tsrx/hono/error-boundary',
			mergeRefs: '@tsrx/hono/ref',
			refProp: '@tsrx/hono/ref',
			forOfIterableHelper: '@tsrx/hono/runtime/iterable',
		},
		directRuntimeImports: {
			// Hono-specific adapters intentionally remain on @tsrx/hono/* because
			// this target does not publish a separate standalone runtime package.
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
			requireUseServerForAwait: is_dom,
		},
		hooks,
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
	const component = find_async_hono_dom_component(ast);
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
 * Find the first async function that can be used as a Hono DOM component.
 * Looking for JSX anywhere below an async function is not sufficient: event
 * handlers and other helpers may legitimately create JSX without returning it
 * to Hono's renderer. Component positions and the conventional uppercase JSX
 * binding names provide the boundary that the source AST can establish.
 *
 * @param {AST.Program} ast
 * @returns {AST.Function | null}
 */
function find_async_hono_dom_component(ast) {
	/** @type {Array<{ node: AST.Function, name: string | null, defaultExport: boolean }>} */
	const functions = [];
	const component_references = new Set();

	collect_hono_dom_components(ast, null, [], functions, component_references);

	const component = functions.find(
		({ node, name, defaultExport }) =>
			node.async &&
			(defaultExport ||
				(name && is_uppercase_name(name)) ||
				(name && component_references.has(name))),
	);
	return component?.node ?? null;
}

const AST_METADATA_KEYS = new Set(['loc', 'start', 'end', 'metadata']);

/**
 * @param {AST.Node | AST.Node[] | null | undefined} node
 * @param {AST.Node | null} parent
 * @param {AST.Node[]} ancestors
 * @param {Array<{ node: AST.Function, name: string | null, defaultExport: boolean }>} functions
 * @param {Set<string>} component_references
 */
function collect_hono_dom_components(node, parent, ancestors, functions, component_references) {
	if (!node) return;
	if (Array.isArray(node)) {
		for (const child of node) {
			collect_hono_dom_components(child, parent, ancestors, functions, component_references);
		}
		return;
	}
	if (typeof node !== 'object') return;

	if (is_function_node(node)) {
		functions.push({
			node,
			name: get_function_binding_name(node, parent),
			defaultExport: parent?.type === 'ExportDefaultDeclaration',
		});
	}

	if (node.type === 'JSXElement') {
		for (const name of get_jsx_component_references(node.openingElement?.name)) {
			component_references.add(name);
		}
	}

	if (node.type === 'CallExpression') {
		const name = get_jsx_factory_component_reference(node);
		if (name) component_references.add(name);
	}

	const next_ancestors = [...ancestors, node];
	for (const [key, value] of Object.entries(node)) {
		if (AST_METADATA_KEYS.has(key)) continue;
		const children = Array.isArray(value) ? value : [value];
		for (const child of children) {
			collect_hono_dom_components(
				/** @type {AST.Node | null} */ (child),
				node,
				next_ancestors,
				functions,
				component_references,
			);
		}
	}
}

/**
 * @param {AST.Function} node
 * @param {AST.Node | null} parent
 * @returns {string | null}
 */
function get_function_binding_name(node, parent) {
	if (node.type !== 'ArrowFunctionExpression' && node.id?.type === 'Identifier') {
		return node.id.name;
	}

	if (parent?.type === 'VariableDeclarator' && parent.init === node) {
		return get_static_name(parent.id);
	}
	if (parent?.type === 'AssignmentExpression' && parent.right === node) {
		return get_static_name(parent.left);
	}
	if (parent?.type === 'Property' && parent.value === node) {
		return get_static_name(parent.key, true);
	}
	if (parent?.type === 'MethodDefinition' && parent.value === node) {
		return get_static_name(parent.key, true);
	}
	return null;
}

/**
 * @param {AST.Node | null | undefined} node
 * @param {boolean} [allow_literal]
 * @returns {string | null}
 */
function get_static_name(node, allow_literal = false) {
	if (node?.type === 'Identifier') return node.name;
	if (allow_literal && node?.type === 'Literal' && typeof node.value === 'string') {
		return node.value;
	}
	return null;
}

/**
 * @param {AST.Node | null | undefined} node
 * @returns {string[]}
 */
function get_jsx_component_references(node) {
	if (!node) return [];
	if (node.type === 'JSXIdentifier') {
		return is_uppercase_name(node.name) ? [node.name] : [];
	}
	if (node.type === 'JSXMemberExpression') {
		return [
			...get_jsx_component_references(node.object),
			...(node.property?.type === 'JSXIdentifier' && is_uppercase_name(node.property.name)
				? [node.property.name]
				: []),
		];
	}
	return [];
}

/**
 * @param {AST.CallExpression} node
 * @returns {string | null}
 */
function get_jsx_factory_component_reference(node) {
	const callee = node.callee;
	const callee_name =
		callee.type === 'Identifier'
			? callee.name
			: callee.type === 'MemberExpression' &&
				  !callee.computed &&
				  callee.property.type === 'Identifier'
				? callee.property.name
				: null;
	if (!callee_name || !['jsx', 'jsxs', 'jsxDEV'].includes(callee_name)) return null;

	const first_argument = node.arguments[0];
	if (first_argument?.type === 'Identifier') return first_argument.name;
	if (
		first_argument?.type === 'MemberExpression' &&
		!first_argument.computed &&
		first_argument.property.type === 'Identifier'
	) {
		return first_argument.property.name;
	}
	return null;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function is_uppercase_name(name) {
	return /^[A-Z]/.test(name);
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
