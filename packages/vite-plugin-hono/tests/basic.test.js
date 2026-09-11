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

	it('works with c.html, c.render, and the JSX renderer context', async () => {
		const plugin = tsrxHono();
		const directory = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-hono-renderer-'),
		);

		try {
			const source_id = path.join(directory, 'Page.tsrx');
			const output_id = path.join(directory, 'Page.js');
			const transformed = await plugin.transform(
				`import { useRequestContext } from 'hono/jsx-renderer';

				export function SimplePage() @{
					<p>{'html page'}</p>
				}

				export function Page() @{
					const context = useRequestContext();
					<p>{context.req.path}</p>
				}`,
				source_id,
			);
			await writeFile(output_id, transformed.code);

			const [{ Page, SimplePage }, { Hono }, { jsx }, { jsxRenderer }] = await Promise.all([
				import(`${pathToFileURL(output_id).href}?test=${Date.now()}`),
				import('hono'),
				import('hono/jsx'),
				import('hono/jsx-renderer'),
			]);

			const app = new Hono();
			app.get('/html', (c) => c.html(jsx(SimplePage, {})));
			app.use(
				'/page/*',
				jsxRenderer(({ children }) =>
					jsx(
						'html',
						null,
						jsx('body', null, ...(Array.isArray(children) ? children : [children])),
					),
				),
			);
			app.get('/page/info', (c) => c.render(jsx(Page, {})));

			expect(await (await app.request('/html')).text()).toContain('<p>html page</p>');
			expect(await (await app.request('/page/info')).text()).toContain('<p>/page/info</p>');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('preserves Hono StreamingContext around generated Suspense output', async () => {
		const plugin = tsrxHono();
		const directory = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-hono-streaming-'),
		);

		try {
			const source_id = path.join(directory, 'StreamingPage.tsrx');
			const output_id = path.join(directory, 'StreamingPage.js');
			const transformed = await plugin.transform(
				`import { StreamingContext, Suspense } from 'hono/jsx/streaming';

				async function AsyncContent() {
					await Promise.resolve();
					return <span>{'ready'}</span>;
				}

				export function StreamingPage() @{
					<StreamingContext value={{ scriptNonce: 'test-nonce' }}>
						<Suspense fallback={<span>{'loading'}</span>}>
							<AsyncContent />
						</Suspense>
					</StreamingContext>
				}`,
				source_id,
			);
			await writeFile(output_id, transformed.code);

			const [{ StreamingPage }, { jsx }, { renderToReadableStream }] = await Promise.all([
				import(`${pathToFileURL(output_id).href}?test=${Date.now()}`),
				import('hono/jsx'),
				import('hono/jsx/streaming'),
			]);
			const stream = renderToReadableStream(jsx(StreamingPage, {}));
			expect(await new Response(stream).text()).toMatch(/<script[^>]*nonce="test-nonce"/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('preserves the StreamingContext nonce in the TSRX ErrorBoundary output', async () => {
		const plugin = tsrxHono();
		const directory = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-hono-error-streaming-'),
		);

		try {
			const source_id = path.join(directory, 'ErrorStreamingPage.tsrx');
			const output_id = path.join(directory, 'ErrorStreamingPage.js');
			const transformed = await plugin.transform(
				`import { StreamingContext } from 'hono/jsx/streaming';

				async function DelayedContent() {
					await Promise.resolve();
					return <span>{'ready'}</span>;
				}

				export function ErrorStreamingPage() @{
					<StreamingContext value={{ scriptNonce: 'test-nonce' }}>
						@try {
							<DelayedContent />
						} @catch (error) {
							<span>{error.message}</span>
						}
					</StreamingContext>
				}`,
				source_id,
			);
			await writeFile(output_id, transformed.code);

			const [{ ErrorStreamingPage }, { jsx }, { renderToReadableStream }] = await Promise.all([
				import(`${pathToFileURL(output_id).href}?test=${Date.now()}`),
				import('hono/jsx'),
				import('hono/jsx/streaming'),
			]);
			const stream = renderToReadableStream(jsx(ErrorStreamingPage, {}));
			const html = await new Response(stream).text();
			expect(html).toMatch(/<script[^>]*nonce="test-nonce"/);
			expect(html).toContain('<span>ready</span>');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('selects the Hono DOM runtime and forwards direct runtime imports', async () => {
		const plugin = tsrxHono({ mode: 'dom', runtimeImports: 'direct' });
		const transformed = await plugin.transform(
			`export function App(props) @{
				@try {
					<input {...props} />
				} @catch (error) {
					<p>{error.message}</p>
				}
			}`,
			'/virtual/App.tsrx',
		);

		expect(transformed.code).toContain('hono/jsx/dom/jsx-runtime');
		expect(transformed.code).toContain('@tsrx/core/runtime/ref');
		expect(transformed.code).toContain('@tsrx/hono/dom/error-boundary');
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

	it('does not read or compile a file without a loaded virtual CSS module', async () => {
		const plugin = tsrxHono();
		const modules = [{ id: '/virtual/App.tsrx' }];
		const result = await plugin.handleHotUpdate({
			file: '/virtual/App.tsrx',
			modules,
			read: async () => {
				throw new Error('source should not be read');
			},
			server: {
				moduleGraph: {
					getModuleById() {
						return undefined;
					},
				},
			},
		});

		expect(result).toBe(modules);
	});

	it('registers Hono JSX runtime dependencies for optimizeDeps', () => {
		const config = tsrxHono({ mode: 'dom' }).config();
		expect(config.optimizeDeps.extensions).toContain('.tsrx');
		expect(config.optimizeDeps.rolldownOptions.transform.jsx.importSource).toBe('hono/jsx/dom');
		expect(config.optimizeDeps.rolldownOptions.plugins).toHaveLength(1);
	});
});
