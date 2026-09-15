import { describe, expect, it } from 'vitest';
import { jsx, Suspense } from 'hono/jsx';
import { renderToReadableStream } from 'hono/jsx/streaming';
import { TsrxErrorBoundary } from '@tsrx/hono/error-boundary';
import { tsrxHono } from '../src/index.js';

describe('Hono integration boundaries', () => {
	it('escapes untrusted strings inside Hono Suspense', async () => {
		const stream = renderToReadableStream(
			jsx(Suspense, {
				children: '<img src=x onerror=alert(1)>',
			}),
		);
		const html = await new Response(stream).text();
		expect(html).toContain('&lt;img');
		expect(html).not.toContain('<img');
	});
	it('escapes untrusted strings returned by the server error fallback', async () => {
		const text = '<img src=x onerror=alert(1)>';
		const Broken = () => {
			throw new Error('failed');
		};
		const stream = renderToReadableStream(
			jsx(TsrxErrorBoundary, {
				fallbackRender: () => text,
				children: jsx(Broken, {}),
			}),
		);
		const html = await new Response(stream).text();
		expect(html).toContain('&lt;img');
		expect(html).not.toContain('<img');
	});

	it('leaves other plugins virtual CSS untouched', () => {
		const plugin = tsrxHono();
		for (const id of [
			'/other/App.tsrx?tsrx-css&lang.css',
			'/other/file.js?tsrx-css&lang.css',
			'/other/App.tsrx?tsrx-css&lang.css&raw',
		]) {
			expect(plugin.resolveId(id)).toBeNull();
			expect(plugin.load('\0' + id)).toBeNull();
		}
	});

	it('clears removed CSS without losing the loaded virtual module', async () => {
		const plugin = tsrxHono();
		const id = '/virtual/Styled.tsrx';
		await plugin.transform(
			'export function App() @{ <><style>p { color: red; }</style><p /></> }',
			id,
		);
		const css_id = plugin.resolveId(id + '?tsrx-css&lang.css');
		expect(plugin.load(css_id)).toContain('red');
		await plugin.transform('export function App() @{ <p /> }', id);
		expect(plugin.load(css_id)).toBe('');
		plugin.watchChange(id, { event: 'delete' });
		expect(plugin.load(css_id)).toBeNull();
	});

	it('does not keep CSS from a previous build', async () => {
		const plugin = tsrxHono();
		const id = '/virtual/Styled.tsrx';
		await plugin.transform(
			'export function App() @{ <><style>p { color: red; }</style><p /></> }',
			id,
		);
		const css_id = plugin.resolveId(id + '?tsrx-css&lang.css');
		plugin.buildStart();
		expect(plugin.load(css_id)).toBeNull();
	});
});
