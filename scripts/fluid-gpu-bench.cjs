// 49-fluid W2 — THE GPU FLUID BENCH: 8000 particles, ms per step, the WebGPU solver against
// the CPU solver on this machine's Chromium, with the adapter recorded. Runs the GPU worker's
// own `bench` op (the calibration Settings ▸ Performance ▸ GPU fluid "Auto" decides by), so the
// bench and the in-app verdict are one code path.
//
//   node scripts/fluid-gpu-bench.cjs [--url https://localhost:5483] [--steps 60] [--runs 3] [--count 8000] [--json out.json]
//
// Needs the lane's dev server (vite serves the worker module) — it does NOT boot the app: the
// page is the worker's own source URL, so nothing else competes for the CPU while it measures.
// Linux Chromium hides WebGPU behind --enable-unsafe-webgpu and needs Vulkan for the real GPU
// (without it the adapter is SwiftShader); both are passed here.
const { chromium } = require('playwright');
const fs = require('fs');

const arg = (/** @type {string} */ k, /** @type {string} */ d) => {
	const i = process.argv.indexOf('--' + k);
	return i > 0 ? process.argv[i + 1] : d;
};
const URL = arg('url', process.env.APP_URL || 'https://localhost:5483');
const STEPS = Number(arg('steps', '60'));
const RUNS = Number(arg('runs', '3'));
const COUNT = Number(arg('count', '8000'));
const OUT = arg('json', '');
const ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];

(async () => {
	const browser = await chromium.launch({ args: ARGS });
	const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
	await page.goto(URL + '/src/lib/sim/fluidGpuCore.js', { timeout: 120000 });
	const runs = [];
	for (let r = 0; r < RUNS; r++) {
		const res = await page.evaluate(
			({ steps, count }) =>
				new Promise((resolve) => {
					const w = new Worker(new URL('/src/lib/sim/fluidGpu.worker.js', location.origin), { type: 'module' });
					w.onmessage = (e) => {
						if (e.data?.op !== 'bench') console.log('worker says', JSON.stringify(e.data));
						if (e.data?.op === 'bench') {
							w.terminate();
							resolve(e.data);
						}
					};
					w.onerror = (e) => resolve({ error: String(e.message) });
					w.postMessage({ op: 'bench', count, steps, warm: 10 });
				}),
			{ steps: STEPS, count: COUNT }
		);
		runs.push(res);
		console.log(`run ${r + 1}: cpu ${res.cpuMs?.toFixed(2)} ms/step · gpu ${res.gpuMs == null ? '— (' + res.reason + ')' : res.gpuMs.toFixed(2) + ' ms/step'} · count cpu ${res.cpuCount} gpu ${res.gpuCount} · meanY cpu ${res.cpuMeanY?.toFixed(3)} gpu ${res.gpuMeanY?.toFixed(3)} · inside cpu ${res.cpuInside} gpu ${res.gpuInside}`);
	}
	const med = (/** @type {number[]} */ a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
	const summary = {
		at: new Date().toISOString(),
		chromium: browser.version(),
		args: ARGS,
		count: COUNT,
		steps: STEPS,
		adapter: runs.find((r) => r.adapter)?.adapter ?? null,
		cpuMs: med(runs.map((r) => r.cpuMs)),
		gpuMs: runs.every((r) => r.gpuMs != null) ? med(runs.map((r) => r.gpuMs)) : null,
		runs
	};
	console.log(`\nmedian: cpu ${summary.cpuMs.toFixed(2)} ms · gpu ${summary.gpuMs == null ? 'n/a' : summary.gpuMs.toFixed(2) + ' ms'} · adapter ${JSON.stringify(summary.adapter)} · Chromium ${summary.chromium}`);
	if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
	await browser.close();
})();
