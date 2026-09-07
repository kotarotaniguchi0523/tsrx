import { describe, expect, it } from 'vitest';
import { validate_hono_dom_components } from '../src/platform.js';

describe('@tsrx/hono performance guards', () => {
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
