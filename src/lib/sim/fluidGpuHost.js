// 49-fluid W2: WHICH SOLVER A FLUID TANK RUNS ON — Settings ▸ Performance ▸ "GPU fluid".
//
//   Off  — the CPU worker (fluid.worker.js), as before.
//   Auto — the WebGPU worker (fluidGpu.worker.js) ONLY where WebGPU exists AND this device's
//          calibration says it is clearly faster: the GPU worker's own `bench` op (8000
//          particles, the same tank and start on both solvers, ms per step), run once per device
//          and browser and remembered (`fluid:gpuBench`). "Measure again" forgets it.
//
// The CPU stays the fallback everywhere: no WebGPU, no adapter, a slower GPU, a lost device or
// a step that throws all land on the CPU worker, and fluidRuntime re-inits its tanks there.
// Everything here is LOCAL (this device): the fluid's particles are each peer's own and only
// `userData.fluid` replicates, so two peers on different solvers pour the same fluid.
import { writable, get } from 'svelte/store';
import { safeStorage } from '../safeStorage';

const PREF_KEY = 'fluid:gpu';
const BENCH_KEY = 'fluid:gpuBench';
/** bump when the solver or the bench changes enough that an old verdict no longer holds */
export const BENCH_VERSION = 1;
/** "clearly faster": the GPU must take at most this share of the CPU's step */
export const FASTER_SHARE = 0.75;
/** a calibration that has not answered by then counts as "not faster" (tanks wait meanwhile) */
const CALIBRATE_TIMEOUT_MS = 12000;

/** @typedef {'auto' | 'off'} GpuFluidPref */
/** @typedef {{state: 'off'|'unknown'|'measuring'|'gpu'|'cpu'|'unavailable'|'failed', gpuMs?: number|null, cpuMs?: number|null,
 *   adapter?: any, reason?: string, at?: number}} GpuFluidVerdict */

/** @param {any} v @returns {GpuFluidPref} */
export const normalizeGpuFluidPref = (v) => (v === 'off' ? 'off' : 'auto');

/** The setting. LOCAL, default Auto (on only where the bench says the GPU is clearly faster). */
export const gpuFluidPref = writable(normalizeGpuFluidPref(safeStorage.getItem(PREF_KEY)));

/** What Auto decided on this device (and why) — the Settings row reads it. */
export const gpuFluidVerdict = writable(/** @type {GpuFluidVerdict} */ ({ state: 'unknown' }));

/**
 * The verdict rule, pure: a calibration result -> the solver.
 * @param {{gpuMs?: number|null, cpuMs?: number|null}} r @returns {'gpu' | 'cpu'}
 */
export function pickSolver(r) {
	const g = r?.gpuMs, c = r?.cpuMs;
	if (typeof g !== 'number' || typeof c !== 'number' || !Number.isFinite(g) || !Number.isFinite(c) || g <= 0 || c <= 0) return 'cpu';
	return g <= c * FASTER_SHARE ? 'gpu' : 'cpu';
}

/** the cache key: this browser (a new GPU or browser build measures again) + the bench version */
function deviceKey() {
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
	return BENCH_VERSION + '|' + ua;
}

/** @returns {GpuFluidVerdict | null} */
function cachedVerdict() {
	try {
		const r = JSON.parse(safeStorage.getItem(BENCH_KEY) || 'null');
		if (!r || r.key !== deviceKey()) return null;
		return { state: pickSolver(r), gpuMs: r.gpuMs, cpuMs: r.cpuMs, adapter: r.adapter, reason: r.reason || '', at: r.at };
	} catch {
		return null;
	}
}

/** @type {Worker | null} */
let worker = null;
/** set once the GPU worker failed this session: the CPU from here on */
let failedReason = '';
/** @type {((data: any) => void) | null} */
let frameSink = null;
/** @type {Set<(reason: string) => void>} */
const failListeners = new Set();
let calibrating = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let calibrateTimer = null;

let prefSeen = false;
gpuFluidPref.subscribe((v) => {
	if (prefSeen) safeStorage.setItem(PREF_KEY, v);
	prefSeen = true;
	refreshVerdict();
});

function refreshVerdict() {
	if (get(gpuFluidPref) === 'off') return gpuFluidVerdict.set({ state: 'off' });
	if (failedReason) return gpuFluidVerdict.set({ ...get(gpuFluidVerdict), state: 'failed', reason: failedReason });
	if (!hasWebGpu()) return gpuFluidVerdict.set({ state: 'unavailable', reason: 'no WebGPU in this browser' });
	const c = cachedVerdict();
	gpuFluidVerdict.set(c ?? { state: calibrating ? 'measuring' : 'unknown' });
}

function hasWebGpu() {
	return typeof navigator !== 'undefined' && !!(/** @type {any} */ (navigator).gpu) && typeof Worker !== 'undefined';
}

/**
 * The solver a tank should start on NOW: 'gpu', 'cpu', or 'pending' (Auto is still measuring —
 * the tank waits, at most CALIBRATE_TIMEOUT_MS, then the CPU). Starts the calibration when
 * Auto needs one.
 * @returns {'gpu' | 'cpu' | 'pending'}
 */
export function solverChoice() {
	const v = get(gpuFluidVerdict);
	if (v.state === 'gpu') return 'gpu';
	if (v.state === 'unknown') {
		calibrate();
		return 'pending';
	}
	if (v.state === 'measuring') return 'pending';
	return 'cpu';
}

/** run the calibration in the GPU worker (once; the result is remembered per device) */
function calibrate() {
	if (calibrating || failedReason) return;
	const w = gpuWorker();
	if (!w) return;
	calibrating = true;
	gpuFluidVerdict.set({ state: 'measuring' });
	calibrateTimer = setTimeout(() => finishCalibration({ gpuMs: null, cpuMs: null, reason: 'the measurement took too long' }, false), CALIBRATE_TIMEOUT_MS);
	w.postMessage({ op: 'bench', count: 8000, steps: 20, warm: 5 });
}

/** @param {any} r @param {boolean} remember */
function finishCalibration(r, remember) {
	if (!calibrating) return;
	calibrating = false;
	if (calibrateTimer) clearTimeout(calibrateTimer);
	calibrateTimer = null;
	const rec = { key: deviceKey(), gpuMs: r.gpuMs ?? null, cpuMs: r.cpuMs ?? null, adapter: r.adapter ?? null, reason: r.reason || '', at: Date.now() };
	if (remember) safeStorage.setItem(BENCH_KEY, JSON.stringify(rec));
	if (get(gpuFluidPref) === 'off') return refreshVerdict();
	gpuFluidVerdict.set({ state: pickSolver(rec), gpuMs: rec.gpuMs, cpuMs: rec.cpuMs, adapter: rec.adapter, reason: rec.reason, at: rec.at });
}

/** "Measure again": forget this device's verdict and calibrate on the next tank (or now). */
export function remeasureGpuFluid() {
	safeStorage.removeItem(BENCH_KEY);
	failedReason = '';
	refreshVerdict();
	if (get(gpuFluidPref) === 'auto' && hasWebGpu()) calibrate();
}

/**
 * The GPU worker (made on first use). Frames go to the sink fluidRuntime registers.
 * @returns {Worker | null}
 */
export function gpuWorker() {
	if (worker || failedReason || !hasWebGpu()) return worker;
	try {
		worker = new Worker(new URL('./fluidGpu.worker.js', import.meta.url), { type: 'module' });
	} catch (err) {
		markFailed('could not start the GPU worker: ' + String(/** @type {any} */ (err)?.message ?? err));
		return null;
	}
	worker.onmessage = (e) => {
		const d = e.data;
		if (d?.op === 'bench') return finishCalibration(d, true);
		if (d?.op === 'gpufail') return markFailed(d.reason);
		frameSink?.(d);
	};
	worker.onerror = (e) => markFailed('GPU worker error: ' + (e?.message ?? 'unknown'));
	return worker;
}

/** @param {string} reason */
function markFailed(reason) {
	if (failedReason) return;
	failedReason = reason || 'unknown';
	console.warn('[fluid] GPU solver failed, back on the CPU:', failedReason);
	try {
		worker?.terminate();
	} catch {
		// already gone
	}
	worker = null;
	if (calibrating) finishCalibration({ gpuMs: null, cpuMs: null, reason: failedReason }, false);
	refreshVerdict();
	for (const fn of failListeners) fn(failedReason);
}

/**
 * fluidRuntime's two hooks: where GPU frames go, and who re-inits its tanks on the CPU after a
 * failure. @param {(data: any) => void} onFrame @param {(reason: string) => void} onFail
 */
export function connectGpuFluid(onFrame, onFail) {
	frameSink = onFrame;
	failListeners.add(onFail);
}

/** TEST: lose the GPU worker's device for real (the device-lost fallback path) */
export function loseGpuDeviceForTest() {
	worker?.postMessage({ op: 'testLoseDevice' });
}

/** TEST/DEBUG: the whole state in one object */
export function gpuFluidDebug() {
	return { pref: get(gpuFluidPref), verdict: get(gpuFluidVerdict), failed: failedReason, worker: !!worker, webgpu: hasWebGpu() };
}
