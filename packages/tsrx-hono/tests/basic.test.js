import { describe, expect, it } from 'vitest';
import {
	runSharedClassFunctionComponentTests,
	runSharedCodeBlockChildrenTests,
	runSharedCompileDiagnosticsTests,
	runSharedCompileTests,
	runSharedComponentParamsTests,
	runSharedSwitchHelperHoistingTests,
	runSharedTsxExpressionTsrxTests,
} from '@tsrx/core/test-harness/compile';
import { runSharedSourceMappingTests } from '@tsrx/core/test-harness/source-mappings';
import { compile as compileServer } from '../src/index.js';
import { compile_to_volar_mappings as compileServerToVolarMappings } from '../src/index.js';
import { compile as compileDom } from '../src/dom.js';
import { compile_to_volar_mappings as compileDomToVolarMappings } from '../src/dom.js';

runSharedSourceMappingTests({
	compile: compileServer,
	compile_to_volar_mappings: compileServerToVolarMappings,
	name: 'hono',
	rejectsComponentAwait: false,
});
runSharedTsxExpressionTsrxTests({ compile: compileServer, name: 'hono', classAttrName: 'class' });
runSharedCompileTests({ compile: compileServer, name: 'hono', classAttrName: 'class' });
runSharedCompileDiagnosticsTests({
	compile_to_volar_mappings: compileServerToVolarMappings,
	name: 'hono',
});
runSharedCodeBlockChildrenTests({ compile: compileServer, name: 'hono' });

runSharedSourceMappingTests({
	compile: compileDom,
	compile_to_volar_mappings: compileDomToVolarMappings,
	name: 'hono-dom',
	rejectsComponentAwait: true,
});
runSharedTsxExpressionTsrxTests({ compile: compileDom, name: 'hono-dom', classAttrName: 'class' });
runSharedCompileDiagnosticsTests({
	compile_to_volar_mappings: compileDomToVolarMappings,
	name: 'hono-dom',
});
runSharedCodeBlockChildrenTests({ compile: compileDom, name: 'hono-dom' });
runSharedClassFunctionComponentTests({
	compile: compileDom,
	compile_to_volar_mappings: compileDomToVolarMappings,
	name: 'hono-dom',
});
runSharedComponentParamsTests({
	compile: compileDom,
	compile_to_volar_mappings: compileDomToVolarMappings,
	name: 'hono-dom',
});
runSharedSwitchHelperHoistingTests({
	compile: compileDom,
	compile_to_volar_mappings: compileDomToVolarMappings,
	name: 'hono-dom',
	clientHelperShape: 'module-function',
});

describe('@tsrx/hono server compiler', () => {
	it('emits Hono server JSX helpers and preserves async components', () => {
		const { code } = compileServer(
			`export async function App({ items }) @{
				@try {
					@for (const item of items) {
						<div class="item">{item}</div>
					}
				} @pending {
					<p>Loading</p>
				} @catch (error) {
					<p>{error.message}</p>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain("from 'hono/jsx'");
		expect(code).toContain("from '@tsrx/hono/error-boundary'");
		expect(code).toContain("from '@tsrx/hono/runtime/iterable'");
		expect(code).toContain('export async function App');
		expect(code).toContain('<Suspense');
		expect(code).toContain('<TsrxErrorBoundary');
		expect(code).toContain('<TsrxErrorBoundary fallbackRender={');
		expect(code).toContain('class="item"');
	});

	it('does not rewrite class and lowers dynamic tags without a runtime Dynamic import', () => {
		const { code } = compileServer(
			`export function App({ Tag }) @{
				<{Tag} class="dynamic">{'content'}</{Tag}>
			}`,
			'App.tsrx',
		);

		expect(code).toContain('const TsrxDynamic_1 = Tag;');
		expect(code).toContain('class="dynamic"');
		expect(code).not.toContain("from '@tsrx/hono/dynamic'");
	});

	it('allows top-level await for server components', () => {
		expect(() =>
			compileServer(
				`export async function App() @{
					const value = await load();
					<div>{value}</div>
				}`,
				'App.tsrx',
			),
		).not.toThrow();
	});

	it('rejects the unsupported Hono reset callback shape', () => {
		expect(() =>
			compileServer(
				`export function App() @{
					@try {
						<div />
					} @catch (error, reset) {
						<p>{error.message}</p>
					}
				}`,
				'App.tsrx',
			),
		).toThrow(/does not provide a reset callback/);
	});

	it('keeps Hono-specific adapters available in direct runtime mode', () => {
		const { code } = compileServer(
			`export function App() @{
				@try {
					<div />
				} @catch (error) {
					<p>{error.message}</p>
				}
			}`,
			'App.tsrx',
			{ runtimeImports: 'direct' },
		);

		expect(code).toContain("from '@tsrx/hono/error-boundary'");
	});
});

describe('@tsrx/hono DOM compiler', () => {
	it('validates the component binding of a named async function expression', () => {
		expect(() =>
			compileDom(
				'const App = async function loadView() { return <div />; }; export { App };',
				'App.tsrx',
			),
		).toThrow(/does not support async components/);
	});
	it('does not hoist mutable Hono DOM nodes to module scope', () => {
		const { code } = compileDom(
			`export function App() @{
				<div>{'static'}</div>
			}`,
			'App.tsrx',
		);

		expect(code).not.toContain('const App__static1 =');
		expect(code).toContain("return <div>{'static'}</div>;");
	});

	it('uses the DOM JSX runtime and stable helper components for hook branches', () => {
		const { code } = compileDom(
			`import { useState } from 'hono/jsx/dom';

			export function App({ visible }) @{
				@if (visible) {
					const [count] = useState(0);
					<button class="button">{count}</button>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain("from 'hono/jsx/dom'");
		expect(code).toContain('class="button"');
		expect(code).toMatch(/function App__StatementBodyHook\d+\(/);
	});

	it('uses the Hono DOM ref runtime for multiple refs', () => {
		const { code } = compileDom(
			`export function App(props) @{
				let first;
				<input {...props} ref={first} />
			}`,
			'App.tsrx',
			{ collect: true },
		);

		expect(code).toContain("from '@tsrx/hono/ref'");
		expect(code).toContain('__mergeRefs');
	});

	it('rejects async DOM components and points users to use plus Suspense', () => {
		expect(() =>
			compileDom(
				`export async function App() @{
					const value = await load();
					<div>{value}</div>
				}`,
				'App.tsrx',
			),
		).toThrow(/Hono JSX DOM does not support async components/);
	});

	it('rejects async DOM components even without an await expression', () => {
		expect(() =>
			compileDom(
				`export async function App() {
					return <div />;
				}`,
				'App.tsrx',
			),
		).toThrow(/Hono JSX DOM does not support async components/);
	});

	it('rejects async default-exported DOM components', () => {
		expect(() =>
			compileDom(
				`export default async function App() @{
					<div />
				}`,
				'App.tsrx',
			),
		).toThrow(/Hono JSX DOM does not support async components/);
	});

	it('does not reject async helpers that are not rendered as components', () => {
		expect(() =>
			compileDom(
				`async function makePreview() {
					return <dialog />;
				}

				export function App() @{
					<button onClick={() => { void makePreview(); }}>{'Open'}</button>
				}`,
				'App.tsrx',
			),
		).not.toThrow();
	});

	it('resolves DOM component references through lexical scopes', () => {
		expect(() =>
			compileDom(
				`async function Card() {
					return fetch('/data');
				}

				export function App() @{
					const Card = () => <div>{'sync card'}</div>;
					<Card />
				}`,
				'App.tsrx',
			),
		).not.toThrow();
	});

	it('does not use an unexported uppercase helper name as proof of a component', () => {
		expect(() =>
			compileDom(
				`async function PreviewData() {
					return <dialog />;
				}

				export function App() @{
					<button onClick={() => { void PreviewData(); }}>{'Open'}</button>
				}`,
				'App.tsrx',
			),
		).not.toThrow();
	});

	it('does not reject async loaders nested in a default-exported component', () => {
		expect(() =>
			compileDom(
				`export default function App() @{
					async function loadPreview() {
						return 'preview';
					}

					const preview = use(loadPreview());
					<Suspense fallback={<div>{'Loading'}</div>}>
						<div>{preview}</div>
					</Suspense>
				}`,
				'App.tsrx',
			),
		).not.toThrow();
	});

	it('rejects async DOM components that return JSX through a promise', () => {
		expect(() =>
			compileDom(
				`export async function App() {
					return Promise.resolve(<div />);
				}`,
				'App.tsrx',
			),
		).toThrow(/Hono JSX DOM does not support async components/);
	});

	it('rejects async local components rendered through JSX', () => {
		expect(() =>
			compileDom(
				`async function Card() {
					return <div />;
				}

				export function App() @{ <Card /> }`,
				'App.tsrx',
			),
		).toThrow(/Hono JSX DOM does not support async components/);
	});

	it('uses the DOM ErrorBoundary adapter', () => {
		const { code } = compileDom(
			`export function App() @{
				@try {
					<div />
				} @catch (error) {
					<p>{error.message}</p>
				}
			}`,
			'App.tsrx',
		);

		expect(code).toContain("from '@tsrx/hono/dom/error-boundary'");
		expect(code).toContain('fallbackRender={');
	});
});
