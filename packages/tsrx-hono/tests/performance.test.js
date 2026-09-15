import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate_hono_dom_components } from '../src/platform.js';

describe('@tsrx/hono performance guards', () => {
	it.each(['--samples=0', '--warmup=-1', '--samples=NaN'])(
		'rejects invalid benchmark sample counts: %s',
		(argument) => {
			expect(() =>
				execFileSync(
					process.execPath,
					[fileURLToPath(new URL('../bench/dom-validation.js', import.meta.url)), argument],
					{ stdio: 'pipe' },
				),
			).toThrow(/must be a positive integer/);
		},
	);
	it('skips DOM validation when the source cannot contain an async component', () => {
		const ast = new Proxy(
			{},
			{
				get() {
					throw new Error('the AST should not be traversed');
				},
			},
		);

		expect(() =>
			validate_hono_dom_components(ast, 'App.tsrx', {
				source: 'export function App() @{ <div /> }',
				comments: [],
			}),
		).not.toThrow();
	});
});
