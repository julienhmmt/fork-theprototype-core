// 46 P1 — `$lib/gltfOptimize`: the app's door to the optimizer engine. A few lines and NO
// dependency, on purpose — glTF-Transform, meshoptimizer's encoder and the Basis encoder live
// in the Worker's own chunk (gltfOptimize/optimizeWorker.js), so the main bundle stays flat and nothing
// is fetched until somebody imports something heavy or exports for Quest.
//
// One Worker, one job at a time (an optimize holds the whole file several times over in memory —
// a queue bounds that), let go after a quiet minute so the Basis wasm heap is returned.
//
// The engine itself is ./gltfOptimize/core.js; the settings, presets and estimates every caller
// shares are ./gltfOptimize/presets.js (pure, safe to import anywhere).

export {
	OPTIMIZE_DEFAULTS,
	IMPORT_DEFAULTS,
	EXPORT_PRESETS,
	normalizeImportSettings,
	importDecision,
	importOptions,
	shortBytes,
	percentChange
} from './gltfOptimize/presets.js';

/** @typedef {import('./gltfOptimize/core.js').OptimizeReport} OptimizeReport */

/** Raised when the optimizer cannot work on a file it can still import as it is (Draco, an
 * external .gltf). Callers fall back to the original, not to an error. */
export class OptimizeUnsupported extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'OptimizeUnsupported';
	}
}

/** The seam a test can replace. @returns {Worker} */
let makeWorker = () => new Worker(new URL('./gltfOptimize/optimizeWorker.js', import.meta.url), { type: 'module' });
/** @param {() => Worker} factory */
export function setOptimizerWorkerFactory(factory) {
	makeWorker = factory;
}

/** @type {Worker | null} */
let worker = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let idle = null;
let nextId = 1;
/** @type {Map<number, {resolve: (v: any) => void, reject: (e: any) => void, onProgress?: (p: any) => void}>} */
const pending = new Map();
/** the tail of the job queue */
let queue = Promise.resolve();
/** what the suite and the progress toast read */
const stats = { jobs: 0, workerStarts: 0, lastMs: 0 };

function failAll(/** @type {string} */ message) {
	for (const job of pending.values()) job.reject(new Error(message));
	pending.clear();
	worker?.terminate();
	worker = null;
}

function ensureWorker() {
	if (idle) clearTimeout(idle);
	idle = null;
	if (worker) return worker;
	worker = makeWorker();
	stats.workerStarts++;
	worker.onmessage = (event) => {
		const data = event.data ?? {};
		const job = pending.get(data.id);
		if (!job) return;
		if (data.progress) {
			job.onProgress?.(data.progress);
			return;
		}
		pending.delete(data.id);
		if (data.error) job.reject(data.unsupported ? new OptimizeUnsupported(data.error) : new Error(data.error));
		else job.resolve({ bytes: new Uint8Array(data.bytes), report: data.report });
		if (!pending.size)
			idle = setTimeout(() => {
				worker?.terminate();
				worker = null;
			}, 60000);
	};
	worker.onerror = (event) => failAll(event?.message || 'the optimizer worker failed');
	return worker;
}

/**
 * Optimize glTF bytes off the main thread. Jobs run one at a time in arrival order.
 * @param {ArrayBuffer | Uint8Array} bytes the file (copied — the caller keeps its buffer)
 * @param {Partial<import('./gltfOptimize/presets.js').OptimizeOptions>} options
 * @param {{onProgress?: (p: {step: string, done?: number, total?: number}) => void}} [hooks]
 * @returns {Promise<{bytes: Uint8Array, report: OptimizeReport}>}
 */
export function optimizeGltf(bytes, options, hooks = {}) {
	const copy = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
	const run = () =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			const started = performance.now();
			pending.set(id, {
				resolve: (v) => {
					stats.lastMs = Math.round(performance.now() - started);
					resolve(v);
				},
				reject,
				onProgress: hooks.onProgress
			});
			stats.jobs++;
			try {
				ensureWorker().postMessage({ id, bytes: copy, options: JSON.parse(JSON.stringify(options ?? {})) }, [copy]);
			} catch (error) {
				pending.delete(id);
				reject(error);
			}
		});
	const job = queue.then(run, run);
	queue = job.catch(() => {});
	return /** @type {Promise<any>} */ (job);
}

/** For the suite. */
export function optimizerStats() {
	return { ...stats, busy: pending.size, alive: !!worker };
}

/** Stop the Worker now (a test, or the app tearing down). Pending jobs reject. */
export function stopOptimizer() {
	if (idle) clearTimeout(idle);
	idle = null;
	failAll('the optimizer was stopped');
}
