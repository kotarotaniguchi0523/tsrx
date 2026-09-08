import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const arguments_by_name = new Map(
	process.argv.slice(2).map((argument) => {
		const [name, value = 'true'] = argument.replace(/^--/, '').split('=');
		return [name, value];
	}),
);

const candidate_root = path.resolve(arguments_by_name.get('candidate') ?? process.cwd());
const baseline_root = arguments_by_name.get('baseline')
	? path.resolve(arguments_by_name.get('baseline'))
	: null;
const warmup = Number(arguments_by_name.get('warmup') ?? 20);
const samples = Number(arguments_by_name.get('samples') ?? 20);
const sizes = [64, 512, 4096];

for (const [name, value] of [
	['warmup', warmup],
	['samples', samples],
]) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
}

const candidate = await load_target(candidate_root);
const baseline = baseline_root ? await load_target(baseline_root) : null;

function make_source(size, with_async_control) {
	const children = Array.from({ length: size }, (_, index) => `<div>{helper(${index})}</div>`).join(
		'',
	);
	return `export function App() @{ <>${children}</> }${
		with_async_control ? '\nasync function loadPreview() { return 1; }' : ''
	}`;
}

function make_async_component_source() {
	return `
async function Card() {
		return <div />;
}

export function App() @{
		<Card />
}
`;
}

function count_ast_nodes(node, seen = new Set()) {
	if (!node || typeof node !== 'object' || seen.has(node)) return 0;
	seen.add(node);
	if (Array.isArray(node))
		return node.reduce((count, child) => count + count_ast_nodes(child, seen), 0);

	let count = 1;
	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
		count += count_ast_nodes(value, seen);
	}
	return count;
}

function validate(target, source, ast) {
	try {
		target.platform.validate_hono_dom_components(ast, 'Perf.tsrx', {
			source,
			comments: [],
		});
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function checksum(source, validation_message) {
	return createHash('sha256')
		.update(source)
		.update('\0')
		.update(validation_message ?? '')
		.digest('hex');
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function measure(targets, source, asts, iterations) {
	const order = [
		'baseline',
		'candidate',
		'candidate',
		'baseline',
		'baseline',
		'candidate',
		'candidate',
		'baseline',
	];
	const times = { baseline: [], candidate: [] };

	for (const name of ['baseline', 'candidate']) {
		if (!targets[name]) continue;
		for (let index = 0; index < warmup; index++) {
			for (let iteration = 0; iteration < iterations; iteration++) {
				validate(targets[name], source, asts[name]);
			}
		}
	}

	for (let sample = 0; sample < samples; sample++) {
		for (const name of order) {
			if (!targets[name]) continue;
			const started = process.hrtime.bigint();
			for (let iteration = 0; iteration < iterations; iteration++) {
				validate(targets[name], source, asts[name]);
			}
			const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
			times[name].push(elapsed_ms / iterations);
		}
	}

	return Object.fromEntries(
		Object.entries(times)
			.filter(([, values]) => values.length > 0)
			.map(([name, values]) => [name, { median_ms: median(values), samples: values.length }]),
	);
}

async function load_target(root) {
	const import_suffix = `?perf=${Date.now()}-${Math.random()}`;
	const dom = await import(
		pathToFileURL(path.join(root, 'packages/tsrx-hono/src/dom.js')).href + import_suffix
	);
	const platform = await import(
		pathToFileURL(path.join(root, 'packages/tsrx-hono/src/platform.js')).href + import_suffix
	);
	return { dom, platform, root };
}

const targets = { candidate, baseline };
const report = [];

for (const with_async_control of [false, true]) {
	for (const size of sizes) {
		const source = make_source(size, with_async_control);
		const asts = Object.fromEntries(
			Object.entries(targets)
				.filter(([, target]) => target)
				.map(([name, target]) => [name, target.dom.parse(source, 'Perf.tsrx')]),
		);
		const validation = Object.fromEntries(
			Object.entries(targets)
				.filter(([, target]) => target)
				.map(([name, target]) => [name, validate(target, source, asts[name])]),
		);

		if (new Set(Object.values(validation)).size !== 1 || Object.values(validation)[0] !== null) {
			throw new Error(
				`Unexpected validation result for size=${size}: ${JSON.stringify(validation)}`,
			);
		}

		report.push({
			workload: with_async_control ? 'async-control' : 'async-free',
			size,
			source_bytes: Buffer.byteLength(source),
			ast_nodes: count_ast_nodes(asts.candidate),
			checksum: checksum(source, validation.candidate),
			iterations: size <= 64 ? 200 : size <= 512 ? 40 : 4,
			measurements: measure(targets, source, asts, size <= 64 ? 200 : size <= 512 ? 40 : 4),
		});
	}
}

const async_component_source = make_async_component_source();
const async_component_results = Object.fromEntries(
	Object.entries(targets)
		.filter(([, target]) => target)
		.map(([name, target]) => {
			const ast = target.dom.parse(async_component_source, 'AsyncComponent.tsrx');
			return [name, validate(target, async_component_source, ast)];
		}),
);

if (
	Object.values(async_component_results).some(
		(message) => !message?.includes('Hono JSX DOM does not support async components'),
	) ||
	new Set(Object.values(async_component_results)).size !== 1
) {
	throw new Error(`Baseline and candidate disagree: ${JSON.stringify(async_component_results)}`);
}

console.log(
	JSON.stringify(
		{
			node: process.version,
			platform: process.platform,
			architecture: process.arch,
			baseline_root,
			candidate_root,
			warmup,
			samples,
			async_component_error: async_component_results.candidate,
			report,
		},
		null,
		2,
	),
);
