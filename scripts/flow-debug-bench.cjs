#!/usr/bin/env node
// @ts-nocheck — a Playwright driver; the page-side code runs in the app, not under checkJs
// 48 D1 — THE DEBUGGER'S PERF GATE: "zero cost when no breakpoint".
//
// The flow tick is pumped N times SYNCHRONOUSLY (flowRuntime.pumpFlowTick, the XR pump) over a
// synthetic graph sized like a big game's Main graph — event chains (On Click -> Counter -> Map
// Range -> Math -> Compare -> Gate), a Delay per chain, and a Spin effect per chain on its own box —
// with a click every 15 ticks, so applyNodeTrigger's path is in the measurement too. The rAF loop
// cannot interleave a synchronous loop, so the number is the tick's own cost on this machine.
//
//   APP_URL=https://localhost:5491/ node scripts/flow-debug-bench.cjs [--label lane] [--out file.json]
//
// Rounds alternate scenarios and the MEDIAN ms/tick per scenario is reported. Run it against this
// build and against the base (an older build has no debugger: its `idle` is the only scenario),
// under `e2e-slot --exclusive` — a timing.
const { chromium } = require('playwright');
const fs = require('fs');

const URL = process.env.APP_URL || 'https://localhost:5491/';
const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i !== -1 ? process.argv[i + 1] : fallback;
};
const LABEL = arg('--label', 'build');
const OUT = arg('--out', null);
const CHAINS = Number(arg('--chains', '40'));
const TICKS = Number(arg('--ticks', '600'));
const ROUNDS = Number(arg('--rounds', '7'));

(async () => {
	const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=default'] });
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
	await ctx.addInitScript(() => {
		localStorage.setItem('debugStores', 'true');
		localStorage.setItem('hasSeenDisclaimer', 'true');
		localStorage.setItem('hasSeenWelcome', 'true');
	});
	const page = await ctx.newPage();
	await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
	await page.waitForFunction(() => window.__stores && !!window.__stores.flowRuntime && !!window.__stores.moduleSDK, null, { timeout: 120000 });
	await page.waitForTimeout(3000);
	const info = await page.evaluate(async (chains) => {
		const s = window.__stores;
		const boxes = [];
		for (let i = 0; i < chains; i++) {
			s.commandsHandler.sceneCommand('/create box');
		}
		await new Promise((r) => setTimeout(r, 2500));
		let group;
		s.objectsGroup.subscribe((v) => (group = v))();
		for (const c of group.children) if (c.isMesh) boxes.push(c.uuid);
		const nodes = [];
		const edges = [];
		const N = (id, type, data = {}) => nodes.push({ id, type, position: { x: 0, y: 0 }, data: { type, ...data } });
		const E = (source, target, targetHandle) =>
			edges.push({ id: 'e-' + source + '-' + target + (targetHandle ? '.' + targetHandle : ''), source, target, ...(targetHandle ? { targetHandle } : {}) });
		for (let i = 0; i < chains; i++) {
			N('c' + i, 'onclick');
			N('n' + i, 'counter', { step: 1, op: 'up' });
			N('m' + i, 'maprange', { inMin: 0, inMax: 10, outMin: 0, outMax: 1, clamp: false });
			N('x' + i, 'math', { op: 'add', b: 1 });
			N('q' + i, 'compare', { op: 'gt', b: 2 });
			N('g' + i, 'gate', { op: 'and' });
			N('d' + i, 'delay', { seconds: 0.2, pulse: 0.3 });
			N('s' + i, 'spin', { axis: 'y', speed: 1 + (i % 3) });
			N('o' + i, 'objectselector', { selected: boxes[i % boxes.length] });
			E('c' + i, 'n' + i, 'trigger');
			E('n' + i, 'm' + i, 'a');
			E('m' + i, 'x' + i, 'a');
			E('x' + i, 'q' + i, 'a');
			E('q' + i, 'g' + i, 'a');
			E('c' + i, 'd' + i, 'trigger');
			E('d' + i, 'g' + i, 'b');
			E('g' + i, 's' + i, 'speed'); // pulled every tick: the whole chain evaluates
			E('s' + i, 'o' + i);
		}
		s.flowGraphs.update((g) => ({ ...g, scene: { nodes, edges } }));
		s.flowNodes.set(nodes);
		s.flowEdges.set(edges);
		s.isLocked.set(true); // Play: the debugger only arms there
		return { nodes: nodes.length, edges: edges.length, boxes: boxes.length, debugger: !!s.flowDebug };
	}, CHAINS);
	await page.waitForTimeout(1500);
	console.log(`${LABEL}: graph ${info.nodes} nodes / ${info.edges} edges on ${info.boxes} boxes; debugger ${info.debugger ? 'present' : 'absent'}`);

	const scenarios = info.debugger ? ['idle', 'armed'] : ['idle'];
	/** @type {Record<string, number[]>} */
	const samples = Object.fromEntries(scenarios.map((s) => [s, []]));
	for (let round = 0; round < ROUNDS; round++) {
		for (const scenario of scenarios) {
			const ms = await page.evaluate(
				({ scenario, ticks, chains }) => {
					const s = window.__stores;
					const fr = s.flowRuntime;
					// armed = a breakpoint on a node no event reaches (the cost of LOOKING, never pausing)
					if (s.flowDebug) s.flowDebug.toggleBreakpoint('g0', scenario === 'armed');
					let now = performance.now();
					// warm up: let the arming reach the runtime and the memo/JIT settle
					for (let i = 0; i < 60; i++) fr.pumpFlowTick((now += 16.7));
					const t0 = performance.now();
					for (let i = 0; i < ticks; i++) {
						now += 16.7;
						if (i % 15 === 0) fr.applyNodeTrigger('c' + (i % chains), (Date.now() % 86400000) / 1000, false);
						fr.pumpFlowTick(now);
					}
					const per = (performance.now() - t0) / ticks;
					if (s.flowDebug) s.flowDebug.toggleBreakpoint('g0', false);
					return per;
				},
				{ scenario, ticks: TICKS, chains: CHAINS }
			);
			samples[scenario].push(ms);
			await page.waitForTimeout(300);
		}
	}
	const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const result = { label: LABEL, url: URL, graph: info, ticks: TICKS, rounds: ROUNDS };
	for (const scenario of scenarios) {
		result[scenario] = { medianMs: Number(median(samples[scenario]).toFixed(4)), samples: samples[scenario].map((x) => Number(x.toFixed(4))) };
		console.log(`${LABEL} ${scenario}: median ${result[scenario].medianMs} ms/tick  (${result[scenario].samples.join(', ')})`);
	}
	const paused = await page.evaluate(() => window.__stores.flowRuntime.flowDebugRuntime?.().paused ?? false);
	result.neverPaused = !paused;
	if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
	await browser.close();
})().catch((error) => {
	console.error(error);
	process.exit(2);
});
