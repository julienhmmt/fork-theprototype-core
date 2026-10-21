// 49-fluid W2: the GPU twin of fluid.worker.js — the SAME protocol (init / step / drop ->
// frame), so fluidRuntime swaps one Worker URL for the other and nothing else changes. Each
// tank keeps a fluidCore FluidSolver MIRROR for the cheap per-step work the CPU worker does
// around a step (shift, budget limit, spawn batches, emitter + drain, flows, sinks, cull) and
// hands the PBF step itself to fluidGpuCore's GpuFluidStepper.
//
// Two extra messages:
//   {op:'bench', count?, steps?, warm?} -> {op:'bench', gpuMs, cpuMs, adapter, count, ...} — the
//     8000-particle calibration Settings ▸ Performance ▸ GPU fluid "Auto" decides by (and the
//     one the lane's bench script records): same tank, same start, ms per step on each solver.
//   out: {op:'gpufail', reason} — no WebGPU / no adapter / device lost / a step threw. The
//     runtime goes back to the CPU worker and re-inits its tanks there (the CPU stays the
//     fallback everywhere).
// Steps are async (the read-back), so messages run strictly in order through one queue.
import { FluidSolver, pourAndDrain, spacingFor } from './fluidCore.js';
import { spawnBatch, applySinks } from './fluidEmitterCore.js';
import { applyFlows } from './flowPathCore.js';
import { requestFluidDevice, GpuFluidStepper } from './fluidGpuCore.js';

/** @type {Map<string, {solver: FluidSolver, gpu: GpuFluidStepper, gen: number, acc: {carry: number, drainCarry: number}}>} */
const tanks = new Map();
/** @type {Promise<{device: any, info: any}> | null} */
let deviceP = null;
let failed = '';
let queue = Promise.resolve();

const post = (/** @type {any} */ m, /** @type {any[]} */ t = []) => /** @type {any} */ (self).postMessage(m, t);

function device() {
	if (!deviceP) {
		deviceP = requestFluidDevice().then((d) => {
			d.device.lost?.then((/** @type {any} */ info) => fail('device lost: ' + (info?.message || info?.reason || 'unknown')));
			d.device.onuncapturederror = (/** @type {any} */ e) => fail('GPU error: ' + (e?.error?.message ?? e));
			return d;
		});
	}
	return deviceP;
}

/** @param {string} reason */
function fail(reason) {
	if (failed) return;
	failed = reason || 'unknown';
	for (const t of tanks.values()) t.gpu.destroy();
	tanks.clear();
	post({ op: 'gpufail', reason: failed });
}

self.onmessage = (/** @type {MessageEvent} */ e) => {
	const m = e.data;
	queue = queue.then(() => handle(m)).catch((err) => fail(String(err?.message ?? err)));
};

/** @param {any} m */
async function handle(m) {
	if (m.op === 'bench') return post(await bench(m));
	if (failed) return;
	// the device-lost fallback, exercised for real (fluid-gpu suite): destroy() resolves device.lost
	if (m.op === 'testLoseDevice') return (await device()).device.destroy();
	if (m.op === 'init') {
		const { device: dev } = await device();
		const old = tanks.get(m.id);
		if (old) old.gpu.destroy();
		const solver = new FluidSolver({ min: m.min, max: m.max, capacity: m.capacity, spacing: m.spacing });
		solver.fillBlock(m.fill, m.count);
		if (m.walls) solver.setWalls(m.walls);
		tanks.set(m.id, { solver, gpu: new GpuFluidStepper(dev, solver), gen: m.gen, acc: { carry: 0, drainCarry: 0 } });
		return;
	}
	if (m.op === 'drop') {
		tanks.get(m.id)?.gpu.destroy();
		tanks.delete(m.id);
		return;
	}
	if (m.op !== 'step') return;
	const tank = tanks.get(m.id);
	if (!tank) return;
	const s = tank.solver;
	const t0 = performance.now();
	if (m.shift) for (let i = 0; i < s.count * 3; i += 3) { s.x[i] -= m.shift[0]; s.x[i + 1] -= m.shift[1]; s.x[i + 2] -= m.shift[2]; }
	if (typeof m.limit === 'number' && s.count > m.limit) s.count = Math.max(0, m.limit);
	spawnBatch(s, m.spawn);
	if (m.spec) pourAndDrain(s, m.spec, m.dt, tank.acc);
	await tank.gpu.step(m.dt, m);
	if (tanks.get(m.id) !== tank) return; // dropped / re-inited while the GPU ran
	if (m.flows) applyFlows(s, m.flows, m.dt);
	const sunk = m.sinks ? applySinks(s, m.sinks) : null;
	const n = s.count;
	const out = m.buffer && m.buffer.byteLength >= n * 12 ? new Float32Array(m.buffer, 0, s.capacity * 3) : new Float32Array(s.capacity * 3);
	out.set(s.x.subarray(0, n * 3));
	const escaped = s.escapedCount ? s.takeEscaped() : null;
	post(
		{ op: 'frame', id: m.id, gen: tank.gen, count: n, positions: out, impulses: s.impulses, ms: performance.now() - t0, solver: 'gpu', ...(escaped ? { escaped } : {}), ...(sunk?.length ? { sunk } : {}) },
		escaped ? [out.buffer, escaped.buffer] : [out.buffer]
	);
}

/**
 * THE BENCH: one tank (1 m cube inside, 45 % fill), `count` particles, the same start on
 * both solvers, a sphere bobbing in it (one collider, like a toy in a tank). ms per step
 * averaged over `steps` after `warm` (pipeline compile and first upload excluded). The GPU
 * figure includes its upload and read-back — what a tank actually waits for.
 * @param {any} m
 */
async function bench(m) {
	const count = Math.min(8000, Math.max(64, m.count ?? 8000));
	const steps = Math.max(5, m.steps ?? 60);
	const warm = Math.max(1, m.warm ?? 10);
	const min = [-0.5, -0.5, -0.5], max = [0.5, 0.5, 0.5];
	const spacing = spacingFor([1, 1, 1], count, 0.45);
	const make = () => {
		const s = new FluidSolver({ min, max, capacity: count, spacing });
		s.fillBlock(0.45, count);
		return s;
	};
	const msg = (/** @type {number} */ k) => ({
		gravity: [0, -9.81, 0], viscosity: 0.05, surfaceTension: 0.5,
		colliders: [{ kind: /** @type {'sphere'} */ ('sphere'), center: [0.1 * Math.sin(k / 9), -0.15, 0], half: [0.12], quat: [0, 0, 0, 1], dynamic: true, id: 'ball' }]
	});
	/** @type {any} */
	const res = { op: 'bench', count, steps, warm, gpuMs: null, cpuMs: null, adapter: null, reason: '' };
	const cpu = make();
	for (let k = 0; k < warm; k++) cpu.step(1 / 60, msg(k));
	let t0 = performance.now();
	for (let k = 0; k < steps; k++) cpu.step(1 / 60, msg(warm + k));
	res.cpuMs = (performance.now() - t0) / steps;
	res.cpuCount = cpu.count;
	res.cpuMeanY = meanY(cpu);
	try {
		const { device: dev, info } = await device();
		res.adapter = info;
		const g = make();
		dev.pushErrorScope('validation');
		const st = new GpuFluidStepper(dev, g);
		for (let k = 0; k < warm; k++) await st.step(1 / 60, msg(k));
		const verr = await dev.popErrorScope();
		if (verr) throw new Error('GPU validation: ' + verr.message);
		t0 = performance.now();
		for (let k = 0; k < steps; k++) await st.step(1 / 60, msg(warm + k));
		res.gpuMs = (performance.now() - t0) / steps;
		res.gpuCount = g.count;
		res.gpuMeanY = meanY(g);
		res.gpuInside = inside(g);
		res.cpuInside = inside(cpu);
		st.destroy();
	} catch (err) {
		res.reason = String(/** @type {any} */ (err)?.message ?? err);
	}
	return res;
}

/** @param {FluidSolver} s */
function meanY(s) {
	let y = 0;
	for (let i = 0; i < s.count; i++) y += s.x[i * 3 + 1];
	return s.count ? y / s.count : 0;
}

/** every particle inside the glass (radius included, a hair of slack) @param {FluidSolver} s */
function inside(s) {
	const e = s.radius * 0.5;
	for (let i = 0; i < s.count * 3; i++) {
		const a = i % 3;
		if (!(s.x[i] >= s.min[a] - e && s.x[i] <= s.max[a] + e)) return false;
	}
	return true;
}
