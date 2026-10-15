// 46-media H1 — the libheif half of HEIC import. Imported ONLY by heic.worker.js: the 1.4 MB wasm and its
// 90 KB loader are their own chunk + asset, fetched the first time a HEIC is actually decoded and
// never by a page — or a peer — that does not bring one.
import createLibheif from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { fitWithin, HEIC_MAX_SIDE } from './heicCore.js';

/** @type {Promise<any> | null} */
let libPromise = null;

/** Load libheif once: fetch the wasm, hand it over as `wasmBinary` (the package's own recipe). */
function loadLibheif() {
	libPromise ??= (async () => {
		const res = await fetch(wasmUrl);
		if (!res.ok) throw new Error('the HEIC decoder could not be fetched (' + res.status + ')');
		const wasmBinary = await res.arrayBuffer();
		const lib = /** @type {any} */ (await createLibheif({ wasmBinary }));
		if (!lib?.HeifDecoder) throw new Error('the HEIC decoder did not start');
		return lib;
	})();
	libPromise.catch(() => (libPromise = null));
	return libPromise;
}

/**
 * Decode a HEIC/HEIF file's PRIMARY image to RGBA (libheif applies its rotation/mirror), scaled so
 * its longer side is at most `maxSide`.
 * @param {ArrayBuffer} buffer @param {{maxSide?: number}} [opts]
 * @returns {Promise<{rgba: Uint8ClampedArray, width: number, height: number, sourceWidth: number, sourceHeight: number}>}
 */
export async function decodeHeicToRgba(buffer, opts = {}) {
	const lib = await loadLibheif();
	const decoder = new lib.HeifDecoder();
	const images = decoder.decode(new Uint8Array(buffer));
	if (!images || !images.length) throw new Error('no image in this HEIF file');
	try {
		const image = images.find((/** @type {any} */ i) => i.is_primary?.()) ?? images[0];
		const sourceWidth = image.get_width();
		const sourceHeight = image.get_height();
		const rgba = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
		await new Promise((resolve, reject) =>
			image.display({ data: rgba, width: sourceWidth, height: sourceHeight }, (/** @type {any} */ out) => (out ? resolve(out) : reject(new Error('the HEIF image could not be decoded'))))
		);
		const fit = fitWithin(sourceWidth, sourceHeight, opts.maxSide ?? HEIC_MAX_SIDE);
		if (fit.scale >= 1) return { rgba, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight };
		// scaled on a canvas (the caller encodes; a worker has OffscreenCanvas wherever this runs)
		const full = new OffscreenCanvas(sourceWidth, sourceHeight);
		/** @type {any} */ (full.getContext('2d')).putImageData(new ImageData(/** @type {any} */ (rgba), sourceWidth, sourceHeight), 0, 0);
		const small = new OffscreenCanvas(fit.width, fit.height);
		const sctx = /** @type {any} */ (small.getContext('2d'));
		sctx.imageSmoothingQuality = 'high';
		sctx.drawImage(full, 0, 0, fit.width, fit.height);
		return { rgba: sctx.getImageData(0, 0, fit.width, fit.height).data, width: fit.width, height: fit.height, sourceWidth, sourceHeight };
	} finally {
		for (const i of images) i.free?.();
	}
}

/**
 * Decode and ENCODE: a JPEG blob of the primary image (needs OffscreenCanvas — every browser with
 * module workers has it; heic.js encodes on a page canvas otherwise).
 * @param {ArrayBuffer} buffer @param {{maxSide?: number, quality?: number}} [opts]
 */
export async function decodeHeicToJpeg(buffer, opts = {}) {
	const d = await decodeHeicToRgba(buffer, opts);
	if (typeof OffscreenCanvas === 'undefined') return { ...d, blob: null };
	const canvas = new OffscreenCanvas(d.width, d.height);
	/** @type {any} */ (canvas.getContext('2d')).putImageData(new ImageData(/** @type {any} */ (d.rgba), d.width, d.height), 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: opts.quality ?? 0.92 });
	return { blob, width: d.width, height: d.height, sourceWidth: d.sourceWidth, sourceHeight: d.sourceHeight, rgba: null };
}
