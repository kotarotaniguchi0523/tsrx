/** @import * as AST from 'estree' */
/** @import * as ESTreeJSX from 'estree-jsx' */
/** @import { JsxPlatform, JsxTransformContext, TSRXAnalysisResult } from '@tsrx/core/types' */

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

	// The core transform keeps a second reset parameter for React-shaped
	// boundaries. Hono invokes `fallbackRender` with the error only, so remove
	// the unused parameter from generated output and preserve Hono's public type.
	const hono_fallback_fn = /** @type {AST.ArrowFunctionExpression} */ ({
		...fallback_fn,
		params: fallback_fn.params.slice(0, 1),
	});
	const name = b.jsx_id('TsrxErrorBoundary');
	const fallback_render = b.jsx_attribute(
		b.jsx_id('fallbackRender'),
		b.jsx_expression_container(hono_fallback_fn),
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
 * @param {{ source?: string, errors?: import('@tsrx/core/types').CompileError[], comments: AST.CommentWithLocation[], analysis: TSRXAnalysisResult }} context
 */
export function validate_hono_dom_components(ast, filename, context) {
	// Async components are the only unsupported shape. Avoid a second full AST
	// walk for the common case where the source cannot contain an async function.
	if (context.source && !context.source.includes('async')) return;

	const component = find_async_hono_dom_component(ast, context.analysis);
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
 * to Hono's renderer. Component positions and exported conventional uppercase
 * bindings provide the boundary that the source AST can establish.
 *
 * @param {AST.Program} ast
 * @param {TSRXAnalysisResult} analysis
 * @returns {AST.Function | null}
 */
function find_async_hono_dom_component(ast, analysis) {
	/** @type {Array<{ node: AST.Function, binding: import('@tsrx/core/types').Binding | null, name: string | null, defaultExport: boolean, exported: boolean }>} */
	const functions = [];
	const exported_names = get_exported_hono_dom_component_names(ast);
	const default_export_names = get_default_hono_dom_component_names(ast);
	/** @type {Map<import('@tsrx/core/types').Binding, AST.Function>} */
	const candidate_bindings = new Map();
	/** @type {Map<AST.Function, AST.Function>} */
	const candidate_nodes = new Map();

	collect_async_hono_dom_components(
		ast,
		null,
		analysis.scopes.get(ast),
		analysis.scopes,
		functions,
		candidate_bindings,
		candidate_nodes,
		exported_names,
		default_export_names,
	);

	const component = functions.find(
		({ node, name, defaultExport, exported }) =>
			defaultExport ||
			(name && default_export_names.has(name)) ||
			(exported && name && is_uppercase_name(name)) ||
			candidate_nodes.has(node),
	);
	if (component && (component.defaultExport || component.exported || component.name)) {
		if (
			component.defaultExport ||
			(component.name &&
				(default_export_names.has(component.name) ||
					(component.exported && is_uppercase_name(component.name))))
		) {
			return component.node;
		}
	}

	return find_referenced_async_hono_dom_component(
		ast,
		analysis.scopes.get(ast),
		analysis.scopes,
		candidate_bindings,
	);
}

/**
 * @param {AST.Program} ast
 * @returns {Set<string>}
 */
function get_exported_hono_dom_component_names(ast) {
	const names = new Set();

	for (const statement of ast.body) {
		if (statement.type === 'ExportDefaultDeclaration') {
			const declaration = statement.declaration;
			if (declaration?.type === 'Identifier') names.add(declaration.name);
			continue;
		}
		if (statement.type !== 'ExportNamedDeclaration') continue;

		const declaration = statement.declaration;
		if (declaration?.type === 'FunctionDeclaration' && declaration.id?.type === 'Identifier') {
			names.add(declaration.id.name);
		} else if (declaration?.type === 'VariableDeclaration') {
			for (const declarator of declaration.declarations) {
				const name = get_static_name(declarator.id);
				if (name) names.add(name);
			}
		}

		for (const specifier of statement.specifiers ?? []) {
			const name = get_static_name(specifier.local);
			if (name) names.add(name);
		}
	}

	return names;
}

/**
 * @param {AST.Program} ast
 * @returns {Set<string>}
 */
function get_default_hono_dom_component_names(ast) {
	const names = new Set();

	for (const statement of ast.body) {
		if (statement.type !== 'ExportDefaultDeclaration') continue;
		const declaration = statement.declaration;
		if (declaration?.type === 'Identifier') names.add(declaration.name);
		if (
			(declaration?.type === 'FunctionDeclaration' || declaration?.type === 'FunctionExpression') &&
			declaration.id?.type === 'Identifier'
		) {
			names.add(declaration.id.name);
		}
	}

	return names;
}

const AST_METADATA_KEYS = new Set(['loc', 'start', 'end', 'metadata']);

/**
 * @param {AST.Node | AST.Node[] | null | undefined} node
 * @param {AST.Node | null} parent
 * @param {import('@tsrx/core/types').ScopeInterface | null | undefined} scope
 * @param {Map<AST.Node, import('@tsrx/core/types').ScopeInterface>} scopes
 * @param {Array<{ node: AST.Function, binding: import('@tsrx/core/types').Binding | null, name: string | null, defaultExport: boolean, exported: boolean }>} functions
 * @param {Map<import('@tsrx/core/types').Binding, AST.Function>} candidate_bindings
 * @param {Map<AST.Function, AST.Function>} candidate_nodes
 * @param {Set<string>} exported_names
 * @param {Set<string>} default_export_names
 */
function collect_async_hono_dom_components(
	node,
	parent,
	scope,
	scopes,
	functions,
	candidate_bindings,
	candidate_nodes,
	exported_names,
	default_export_names,
) {
	if (!node) return;
	if (Array.isArray(node)) {
		for (const child of node) {
			collect_async_hono_dom_components(
				child,
				parent,
				scope,
				scopes,
				functions,
				candidate_bindings,
				candidate_nodes,
				exported_names,
				default_export_names,
			);
		}
		return;
	}
	if (typeof node !== 'object') return;

	if (is_function_node(node)) {
		if (node.async) {
			const binding = find_function_binding(node, scope);
			const name = binding?.node?.name ?? null;
			const default_export = parent?.type === 'ExportDefaultDeclaration';
			const candidate = {
				node,
				binding,
				name,
				defaultExport: default_export,
				exported: Boolean(name && exported_names.has(name)),
			};
			functions.push({
				...candidate,
			});
			if (binding) candidate_bindings.set(binding, node);
			if (
				default_export ||
				(name &&
					(default_export_names.has(name) || (candidate.exported && is_uppercase_name(name))))
			) {
				candidate_nodes.set(node, node);
			}
		}
	}

	for (const key of Object.keys(node)) {
		if (AST_METADATA_KEYS.has(key)) continue;
		const value = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (node)[key]);
		if (Array.isArray(value)) {
			for (const child of value) {
				collect_async_hono_dom_components(
					/** @type {AST.Node | null} */ (child),
					node,
					scopes.get(node) ?? scope,
					scopes,
					functions,
					candidate_bindings,
					candidate_nodes,
					exported_names,
					default_export_names,
				);
			}
		} else {
			collect_async_hono_dom_components(
				/** @type {AST.Node | null} */ (value),
				node,
				scopes.get(node) ?? scope,
				scopes,
				functions,
				candidate_bindings,
				candidate_nodes,
				exported_names,
				default_export_names,
			);
		}
	}
}

/**
 * @param {AST.Function} node
 * @param {import('@tsrx/core/types').ScopeInterface | null | undefined} scope
 * @returns {import('@tsrx/core/types').Binding | null}
 */

function find_function_binding(node, scope) {
	for (let current = scope; current; current = current.parent) {
		for (const binding of current.declarations.values()) {
			if (binding.initial === node) return binding;
		}
	}
	return null;
}

/**
 * @param {AST.Node | null | undefined} node
 * @returns {string | null}
 */
function get_static_name(node) {
	if (node?.type === 'Identifier') return node.name;
	return null;
}

/**
 * @param {AST.Node | AST.Node[] | null | undefined} node
 * @param {import('@tsrx/core/types').ScopeInterface | null | undefined} scope
 * @param {Map<AST.Node, import('@tsrx/core/types').ScopeInterface>} scopes
 * @param {Map<import('@tsrx/core/types').Binding, AST.Function>} candidate_bindings
 * @returns {AST.Function | null}
 */

function find_referenced_async_hono_dom_component(node, scope, scopes, candidate_bindings) {
	if (!node) return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const component = find_referenced_async_hono_dom_component(
				child,
				scope,
				scopes,
				candidate_bindings,
			);
			if (component) return component;
		}
		return null;
	}
	if (typeof node !== 'object') return null;

	const node_scope = scopes.get(node) ?? scope;
	let name = null;
	if (node.type === 'JSXElement') {
		name = get_jsx_component_reference_name(node.openingElement?.name);
	} else if (node.type === 'CallExpression') {
		name = get_jsx_factory_component_reference(node);
	}
	if (name && is_uppercase_name(name)) {
		const binding = node_scope?.get(name);
		const component = binding && candidate_bindings.get(binding);
		if (component) return component;
	}

	for (const key of Object.keys(node)) {
		if (AST_METADATA_KEYS.has(key)) continue;
		const value = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (node)[key]);
		const component = find_referenced_async_hono_dom_component(
			/** @type {AST.Node | AST.Node[] | null} */ (value),
			node_scope,
			scopes,
			candidate_bindings,
		);
		if (component) return component;
	}
	return null;
}

/**
 * @param {AST.Node | null | undefined} node
 * @returns {string | null}
 */
function get_jsx_component_reference_name(node) {
	if (!node) return null;
	if (node.type === 'JSXIdentifier') return node.name;
	if (node.type === 'JSXMemberExpression') {
		return get_jsx_component_reference_name(node.object);
	}
	return null;
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
	if (callee_name !== 'jsx' && callee_name !== 'jsxs' && callee_name !== 'jsxDEV') return null;

	const first_argument = node.arguments[0];
	if (first_argument?.type === 'Identifier') return first_argument.name;
	if (
		first_argument?.type === 'MemberExpression' &&
		!first_argument.computed &&
		first_argument.property.type === 'Identifier'
	) {
		return first_argument.object.type === 'Identifier' ? first_argument.object.name : null;
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
