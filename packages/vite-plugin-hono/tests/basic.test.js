import { describe, expect, it } from 'vitest';
import { tsrxHono } from '../src/index.js';

describe('@tsrx/vite-plugin-hono', () => {
	it('compiles server TSRX through the Hono automatic JSX runtime', async () => {
		const plugin = tsrxHono();
		const id = '/virtual/App.tsrx';
		const transformed = await plugin.transform(
			`export function App() @{ <div class="app">{'Hello'}</div> }`,
			id,
		);

		expect(transformed).not.toBeNull();
		expect(transformed.code).toContain('hono/jsx/jsx-runtime');
		expect(transformed.code).toContain('class');
	});

	it('selects the Hono DOM runtime and forwards direct runtime imports', async () => {
		const plugin = tsrxHono({ mode: 'dom', runtimeImports: 'direct' });
		const transformed = await plugin.transform(
			`export function App(props) @{ <input {...props} /> }`,
			'/virtual/App.tsrx',
		);

		expect(transformed.code).toContain('hono/jsx/dom/jsx-runtime');
		expect(transformed.code).toContain('@tsrx/core/runtime/ref');
	});

	it('emits and refreshes virtual CSS', async () => {
		const plugin = tsrxHono();
		const id = '/virtual/App.tsrx';
		const source = `export function App() @{
			<><div class="app">{'Hello'}</div>
			<style>.app { color: red; }</style></>
		}`;
		const updated_source = `export function App() @{
			<><div class="app">{'Hello'}</div>
			<style>.app { color: blue; }</style></>
		}`;

		const transformed = await plugin.transform(source, id);
		const virtual_id = `${id}?tsrx-css&lang.css`;
		const resolved_id = plugin.resolveId(virtual_id);
		expect(transformed.code).toContain(virtual_id);
		expect(plugin.load(resolved_id)).toContain('color: red;');

		const css_module = { id: `\0${virtual_id}` };
		const invalidated = [];
		const modules = await plugin.handleHotUpdate({
			file: id,
			modules: [{ id }],
			read: async () => updated_source,
			server: {
				moduleGraph: {
					getModuleById(module_id) {
						return module_id === css_module.id ? css_module : undefined;
					},
					invalidateModule(module) {
						invalidated.push(module);
					},
				},
			},
		});

		expect(plugin.load(resolved_id)).toContain('color: blue;');
		expect(invalidated).toEqual([css_module]);
		expect(modules).toContain(css_module);
	});

	it('registers Hono JSX runtime dependencies for optimizeDeps', () => {
		const config = tsrxHono({ mode: 'dom' }).config();
		expect(config.optimizeDeps.extensions).toContain('.tsrx');
		expect(config.optimizeDeps.rolldownOptions.transform.jsx.importSource).toBe('hono/jsx/dom');
		expect(config.optimizeDeps.rolldownOptions.plugins).toHaveLength(1);
	});
});
