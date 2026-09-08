import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tsrxHono } from '../src/index.js';

const original_bun = Reflect.get(globalThis, 'Bun');

afterEach(() => {
	if (original_bun === undefined) {
		Reflect.deleteProperty(globalThis, 'Bun');
	} else {
		Object.defineProperty(globalThis, 'Bun', {
			value: original_bun,
			writable: true,
			configurable: true,
		});
	}
});

function install_transpiler_stub() {
	const options = [];
	class TranspilerStub {
		constructor(transpiler_options) {
			options.push(transpiler_options);
		}
		transformSync(source) {
			return `// transformed\n${source}`;
		}
	}
	Object.defineProperty(globalThis, 'Bun', {
		value: { Transpiler: TranspilerStub },
		writable: true,
		configurable: true,
	});
	return { options };
}

function setup_plugin(options, config = {}) {
	const hooks = { onResolve: [], onLoad: [] };
	const plugin = tsrxHono(options);
	const build = {
		config: { entrypoints: [], plugins: [], ...config },
		onResolve(hook_options, callback) {
			hooks.onResolve.push({ options: hook_options, callback });
			return build;
		},
		onLoad(hook_options, callback) {
			hooks.onLoad.push({ options: hook_options, callback });
			return build;
		},
	};
	plugin.setup(build);
	return hooks;
}

async function load_tsrx(hooks, file_path) {
	const hook = hooks.onLoad.find(({ options }) => options.namespace === 'file');
	return hook.callback({ path: file_path, namespace: 'file', importer: '', kind: 'entry-point' });
}

describe('@tsrx/bun-plugin-hono', () => {
	it('compiles server files and selects hono/jsx', async () => {
		const transpiler = install_transpiler_stub();
		const dir = await mkdtemp(path.join(os.tmpdir(), 'tsrx-bun-plugin-hono-'));
		try {
			const file_path = path.join(dir, 'App.tsrx');
			await writeFile(file_path, `export function App() @{ <div class="app">{'Hello'}</div> }`);
			const hooks = setup_plugin(undefined, { target: 'browser' });
			const result = await load_tsrx(hooks, file_path);
			expect(result.loader).toBe('js');
			expect(result.contents).toContain('// transformed');
			expect(result.contents).toContain('<div class="app">');
			expect(transpiler.options).toEqual([
				expect.objectContaining({
					tsconfig: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'hono/jsx' } },
				}),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('selects hono/jsx/dom and serves component CSS', async () => {
		const transpiler = install_transpiler_stub();
		const dir = await mkdtemp(path.join(os.tmpdir(), 'tsrx-bun-plugin-hono-dom-'));
		try {
			const file_path = path.join(dir, 'App.tsrx');
			await writeFile(
				file_path,
				`export function App() @{ <><div class="app">{'Hello'}</div><style>.app { color: red; }</style></> }`,
			);
			const hooks = setup_plugin({ mode: 'dom' }, { target: 'browser' });
			const result = await load_tsrx(hooks, file_path);
			const css_id = `${file_path}?tsrx-css&lang.css`;
			const resolved = hooks.onResolve.find(({ options }) => options.filter.test(css_id));
			const css = hooks.onLoad.find(
				({ options }) => options.namespace === resolved.callback({ path: css_id }).namespace,
			);
			const css_result = css.callback({ path: css_id });
			expect(result.contents).toContain(css_id);
			expect(css_result.contents).toContain('color: red;');
			expect(transpiler.options[0].tsconfig.compilerOptions.jsxImportSource).toBe('hono/jsx/dom');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('fails clearly when Bun.Transpiler is unavailable', () => {
		expect(() => setup_plugin()).toThrow(
			/@tsrx\/bun-plugin-hono requires Bun\.Transpiler to select the configured Hono JSX runtime/,
		);
	});
});
