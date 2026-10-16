// 46 P1 — THE OPTIMIZER WORKER. glTF-Transform, meshoptimizer's encoder + simplifier and the Basis
// encoder (a 3.3 MB wasm) all live HERE and nowhere else, so the main bundle never carries them
// and a minutes-long KTX2 encode of a big scan never costs the window a frame.
//
// Protocol, keyed by `id` (the decimateWorker shape):
//   in:   {id, bytes: ArrayBuffer, options}                  (bytes TRANSFERRED)
//   out:  {id, progress: {step, done?, total?}}              (any number of these)
//         {id, bytes: ArrayBuffer, report}                   (bytes transferred back)
//       | {id, error, unsupported?: true}
//
// Images: createImageBitmap decodes (resizing on the way, `resizeQuality: 'high'`) and an
// OffscreenCanvas reads the pixels back / encodes them again — both exist in a Chromium worker.
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { BrowserBasisEncoder } from 'ktx2-encoder';
import { optimizeGltfBytes, optimizeImages, UnsupportedGltfError } from './core.js';
import { fitSize, ktx2EncodeOptions } from './presets.js';

/** @type {any} */
let basis = null;

/** @param {Uint8Array} bytes @param {string} mime @param {number} maxSize */
async function decodeImage(bytes, mime, maxSize) {
	const blob = new Blob([/** @type {any} */ (bytes)], { type: mime });
	/** @type {ImageBitmapOptions} */
	const base = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
	let bitmap = await createImageBitmap(blob, base);
	const sourceWidth = bitmap.width;
	const sourceHeight = bitmap.height;
	const [w, h] = fitSize(sourceWidth, sourceHeight, maxSize);
	if (w !== sourceWidth || h !== sourceHeight) {
		bitmap.close();
		bitmap = await createImageBitmap(blob, {
			...base,
			resizeWidth: w,
			resizeHeight: h,
			resizeQuality: 'high'
		});
	}
	const canvas = new OffscreenCanvas(w, h);
	const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (
		canvas.getContext('2d', { willReadFrequently: true })
	);
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();
	const data = ctx.getImageData(0, 0, w, h).data;
	return {
		data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		width: w,
		height: h,
		sourceWidth,
		sourceHeight
	};
}

/** @param {{data: Uint8Array, width: number, height: number}} rgba @param {string} mime */
async function encodeImage(rgba, mime) {
	const canvas = new OffscreenCanvas(rgba.width, rgba.height);
	const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
	const pixels = /** @type {any} */ (
		new Uint8ClampedArray(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength)
	);
	ctx.putImageData(new ImageData(pixels, rgba.width, rgba.height), 0, 0);
	const type = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png';
	const blob = await canvas.convertToBlob({ type, quality: 0.9 });
	return new Uint8Array(await blob.arrayBuffer());
}

/** @param {{data: Uint8Array, width: number, height: number}} rgba @param {{mode: 'etc1s' | 'uastc', srgb: boolean, normal: boolean}} t */
async function encodeKtx2(rgba, t) {
	basis ??= new BrowserBasisEncoder();
	return basis.encode(new Uint8Array(1), {
		imageDecoder: async () => rgba,
		...ktx2EncodeOptions(t)
	});
}

self.onmessage = async (/** @type {MessageEvent} */ event) => {
	const { id, bytes, options, images } = event.data ?? {};
	const post = (/** @type {any} */ msg, /** @type {Transferable[]} */ transfer = []) =>
		/** @type {any} */ (self).postMessage({ id, ...msg }, transfer);
	try {
		await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
		const env = {
			MeshoptEncoder,
			MeshoptDecoder,
			MeshoptSimplifier,
			decodeImage,
			encodeImage,
			encodeKtx2,
			onProgress: (/** @type {any} */ progress) => post({ progress }),
			now: () => performance.now()
		};
		if (images) {
			// a batch of loose images (a .tpscene's textures)
			const results = await optimizeImages(
				images.map((/** @type {any} */ j) => ({ ...j, bytes: new Uint8Array(j.bytes) })),
				options,
				env
			);
			/** @type {ArrayBuffer[]} */
			const transfer = [];
			const out = results.map((r) => {
				const plain = r.plain ? r.plain.slice().buffer : null;
				const ktx2 = r.ktx2 ? r.ktx2.slice().buffer : null;
				if (plain) transfer.push(plain);
				if (ktx2) transfer.push(ktx2);
				return { ...r, plain, ktx2 };
			});
			post({ images: out }, transfer);
			return;
		}
		const { bytes: out, report } = await optimizeGltfBytes(new Uint8Array(bytes), options, env);
		const buffer =
			out.byteOffset === 0 && out.byteLength === out.buffer.byteLength
				? out.buffer
				: out.slice().buffer;
		post({ bytes: buffer, report }, [/** @type {ArrayBuffer} */ (buffer)]);
	} catch (error) {
		post({
			error: String(/** @type {any} */ (error)?.message ?? error),
			unsupported: error instanceof UnsupportedGltfError
		});
	}
};
