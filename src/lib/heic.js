import { isHeicFileLike, sniffHeic, decodedName, extOf, HEIC_MAX_SIDE } from './heicCore.js';

// 46-media H1 — HEIC/HEIF import, the page half: "is this a HEIC" and "give me the JPEG".
// The pure rules are in heicCore.js; libheif itself is in heicDecode.js, reached through a module
// Worker (heic.worker.js, its only importer) so this file — imported by the Explorer and the material paths — costs
// nothing until a HEIC actually arrives. Callers convert at their DOOR (explorer.importFiles,
// materialsHandler.setObjectsTexture) and everything after the door sees an ordinary JPEG File:
// its hash, its thumbnail, the bytes a peer pulls, the texture.

/** What the suites read: was the decoder ever started on this page, and how many photos it made. */
export const heicStats = { workerStarted: false, decodes: 0, failures: 0, lastMs: 0 };

/** @type {Worker | null} */
let worker = null;
let seq = 0;
/** @type {Map<number, {resolve: (v: any) => void, reject: (e: any) => void}>} */
const pending = new Map();

/** The worker, started on first use (a test may swap the factory). */
export let makeWorker = () => new Worker(new URL('./heic.worker.js', import.meta.url), { type: 'module' });

function getWorker() {
	if (worker) return worker;
	if (typeof Worker === 'undefined') return null;
	worker = makeWorker();
	heicStats.workerStarted = true;
	worker.onmessage = (e) => {
		const job = pending.get(e.data?.id);
		if (!job) return;
		pending.delete(e.data.id);
		if (e.data.ok) job.resolve(e.data);
		else job.reject(new Error(e.data.error || 'the HEIC decoder failed'));
	};
	worker.onerror = (e) => {
		// a worker that cannot even load fails every job in flight, and the next call starts afresh
		const error = new Error('the HEIC decoder could not start' + (e?.message ? ': ' + e.message : ''));
		for (const job of pending.values()) job.reject(error);
		pending.clear();
		worker?.terminate();
		worker = null;
	};
	return worker;
}

/**
 * Decode a HEIC buffer to a JPEG Blob. The buffer is TRANSFERRED to the worker (the caller's copy
 * is detached afterwards).
 * @param {ArrayBuffer} buffer @param {{maxSide?: number, quality?: number}} [opts]
 * @returns {Promise<{blob: Blob, width: number, height: number, sourceWidth: number, sourceHeight: number}>}
 */
export async function decodeHeic(buffer, opts = {}) {
	const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const w = getWorker();
	/** @type {any} */
	let out;
	if (w) {
		const id = ++seq;
		out = await new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			w.postMessage({ id, buffer, maxSide: opts.maxSide ?? HEIC_MAX_SIDE, quality: opts.quality ?? 0.92 }, [buffer]);
		});
	} else {
		// every browser this app runs in has module workers; a main-thread fallback would put a
		// SECOND copy of the 1.4 MB wasm into the page's build graph, so there is none
		throw new Error('this browser cannot run the HEIC decoder');
	}
	if (!out.blob) out = { ...out, blob: await encodeOnPage(out.rgba, out.width, out.height, opts.quality ?? 0.92) };
	heicStats.decodes++;
	heicStats.lastMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
	return out;
}

/** RGBA -> JPEG on a page canvas (a worker without OffscreenCanvas). */
async function encodeOnPage(/** @type {Uint8ClampedArray} */ rgba, /** @type {number} */ width, /** @type {number} */ height, /** @type {number} */ quality) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
	return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))), 'image/jpeg', quality));
}

/**
 * Is this file a HEIC/HEIF photo? Its name or type says so, or — for a file with no extension at
 * all (a share sheet's `image`) — its first bytes do.
 * @param {File | Blob & {name?: string}} file
 */
export async function isHeicFile(file) {
	if (!file) return false;
	if (isHeicFileLike(file)) return true;
	if (extOf(/** @type {any} */ (file).name ?? '')) return false;
	try {
		return sniffHeic(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
	} catch {
		return false;
	}
}

/**
 * THE DOOR: a HEIC becomes `<name>.jpg` (image/jpeg); anything else comes back untouched.
 * Returns null when it WAS a HEIC and could not be read (`onError` hears why — the callers toast).
 * @template {File | Blob & {name?: string}} F
 * @param {F} file @param {{maxSide?: number, quality?: number, onError?: (message: string) => void}} [opts]
 * @returns {Promise<F | File | null>}
 */
export async function heicToJpegFile(file, opts = {}) {
	if (!(await isHeicFile(file))) return file;
	const name = /** @type {any} */ (file).name ?? 'photo.heic';
	try {
		const out = await decodeHeic(await file.arrayBuffer(), opts);
		return new File([out.blob], decodedName(name), { type: 'image/jpeg', lastModified: /** @type {any} */ (file).lastModified ?? Date.now() });
	} catch (error) {
		heicStats.failures++;
		opts.onError?.(`Could not read ${name}: ${String(/** @type {any} */ (error)?.message ?? error)}`);
		return null;
	}
}

/** For the suites. */
export function heicDebug() {
	return { ...heicStats, pending: pending.size, worker: !!worker };
}
