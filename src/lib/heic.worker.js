// 46-media H1 — the HEIC decoder's worker: decoding a 12 MP photo is a second or two of wasm, which
// must not be the page's frame. One request at a time per message id; the reply carries a JPEG
// blob, or the raw RGBA when this browser's worker has no OffscreenCanvas (heic.js encodes then).
import { decodeHeicToJpeg } from './heicDecode.js';

self.onmessage = async (/** @type {MessageEvent} */ e) => {
	const { id, buffer, maxSide, quality } = e.data ?? {};
	try {
		const out = await decodeHeicToJpeg(buffer, { maxSide, quality });
		const transfer = out.rgba ? [out.rgba.buffer] : [];
		/** @type {any} */ (self).postMessage({ id, ok: true, ...out }, transfer);
	} catch (error) {
		/** @type {any} */ (self).postMessage({ id, ok: false, error: String(/** @type {any} */ (error)?.message ?? error) });
	}
};
