import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

	it('runs transformed server modules with Hono SSR', async () => {
		const plugin = tsrxHono();
		const directory = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-hono-'),
		);

		try {
			const source_id = path.join(directory, 'App.tsrx');
			const output_id = path.join(directory, 'App.js');
			const transformed = await plugin.transform(
				`export async function App({ items }) @{
					const title = await Promise.resolve('Hono');
					<>
						<h1>{title}</h1>
						<ul>
							@for (const item of items) {
								<li class="item">{item}</li>
							}
						</ul>
					</>
				}`,
				source_id,
			);
			await writeFile(output_id, transformed.code);

			const [{ App }, { jsx }, { renderToReadableStream }] = await Promise.all([
				import(`${pathToFileURL(output_id).href}?test=${Date.now()}`),
				import('hono/jsx'),
				import('hono/jsx/streaming'),
			]);

			const stream = await renderToReadableStream(jsx(App, { items: ['one', 'two'] }));
			let html = '';
			for await (const chunk of stream) html += new TextDecoder().decode(chunk);

			expect(html).toContain('<h1>Hono</h1>');
			expect(html).toContain('<li class="item">one</li><li class="item">two</li>');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
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
