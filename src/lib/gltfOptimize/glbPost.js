// 46 P1 — GLB SURGERY THE OPTIMIZER DOES AFTER glTF-Transform HAS WRITTEN THE FILE. PURE and
// import-free (it runs in the Worker, in vitest, and on the main thread when a parse needs the
// KTX2 bytes of a texture), so it only knows the container: a 12-byte header, a JSON chunk and
// one BIN chunk.
//
// WHY AFTER AND NOT INSIDE glTF-Transform: two things the engine writes have no property in its
// document model. KHR_texture_basisu WITH A FALLBACK (the spec allows `texture.source` = a PNG/JPEG
// beside `extensions.KHR_texture_basisu.source` = the KTX2 image; glTF-Transform's texture IS one
// image, so it can say "this is KTX2" but not "this is KTX2 and here is a plain copy"), and
// MSFT_lod, whose `ids` are NODE INDICES that only exist once the writer has numbered the nodes.
// Both are a few lines of JSON once the indices are known, so they happen here, on the written
// file, where they are testable with hand-made JSON.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** @param {ArrayBuffer | ArrayBufferView} input @returns {Uint8Array} */
export function asBytes(input) {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

/** Is this a binary glTF? @param {ArrayBuffer | ArrayBufferView} input */
export function isGlb(input) {
	const b = asBytes(input);
	if (b.byteLength < 12) return false;
	return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true) === GLB_MAGIC;
}

/**
 * Split a GLB into its JSON and its BIN chunk (a view, not a copy). A .gltf JSON file comes back
 * with `bin: null`. Throws on a truncated container.
 * @param {ArrayBuffer | ArrayBufferView} input @returns {{json: any, bin: Uint8Array | null}}
 */
export function unpackGlb(input) {
	const b = asBytes(input);
	if (!isGlb(b)) return { json: JSON.parse(new TextDecoder().decode(b)), bin: null };
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const length = Math.min(view.getUint32(8, true), b.byteLength);
	let offset = 12;
	/** @type {any} */
	let json = null;
	/** @type {Uint8Array | null} */
	let bin = null;
	while (offset + 8 <= length) {
		const chunkLength = view.getUint32(offset, true);
		const chunkType = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + chunkLength > length) throw new Error('GLB chunk runs past the end of the file');
		const chunk = b.subarray(start, start + chunkLength);
		if (chunkType === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(chunk));
		else if (chunkType === CHUNK_BIN && !bin) bin = chunk;
		offset = start + chunkLength;
	}
	if (!json) throw new Error('GLB has no JSON chunk');
	return { json, bin };
}

/** @param {number} n */
const pad4 = (n) => (n + 3) & ~3;

/**
 * Write a GLB from a JSON object and one binary buffer. The JSON chunk is padded with spaces and
 * the BIN chunk with zeros (the spec's rule); `buffers[0].byteLength` is set to the BIN length.
 * @param {any} json @param {Uint8Array | null} bin @returns {Uint8Array}
 */
export function packGlb(json, bin) {
	if (bin && bin.byteLength) {
		json.buffers = json.buffers?.length ? json.buffers : [{}];
		json.buffers[0].byteLength = bin.byteLength;
		delete json.buffers[0].uri;
	}
	const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = pad4(jsonBytes.byteLength);
	const binLength = bin && bin.byteLength ? pad4(bin.byteLength) : 0;
	const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, GLB_MAGIC, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, CHUNK_JSON, true);
	out.set(jsonBytes, 20);
	out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
	if (binLength && bin) {
		const at = 20 + jsonLength;
		view.setUint32(at, binLength, true);
		view.setUint32(at + 4, CHUNK_BIN, true);
		out.set(bin, at + 8);
	}
	return out;
}

/** @param {any} json @param {string} name @param {boolean} [required] */
function useExtension(json, name, required = false) {
	json.extensionsUsed = Array.from(new Set([...(json.extensionsUsed ?? []), name]));
	if (required) json.extensionsRequired = Array.from(new Set([...(json.extensionsRequired ?? []), name]));
}

/**
 * Append KTX2 images BESIDE the plain ones: every texture whose `source` is a key of `ktx2` gets
 * `extensions.KHR_texture_basisu.source` pointing at a new `image/ktx2` image, and the plain image
 * stays as the fallback — so a loader with a transcoder draws the KTX2 one and every other reader
 * (and every serializer in this app) still has an ordinary picture. The extension is USED, not
 * REQUIRED, which is what the spec asks of a file with a fallback.
 * @param {any} json @param {Uint8Array | null} bin
 * @param {Map<number, Uint8Array>} ktx2 image index -> KTX2 bytes
 * @returns {{json: any, bin: Uint8Array}}
 */
export function addKtx2Fallback(json, bin, ktx2) {
	const parts = [bin ?? new Uint8Array(0)];
	let length = pad4(parts[0].byteLength);
	json.bufferViews = json.bufferViews ?? [];
	json.images = json.images ?? [];
	/** @type {Map<number, number>} */
	const added = new Map();
	for (const [imageIndex, bytes] of ktx2) {
		if (!json.images[imageIndex] || !bytes?.byteLength) continue;
		const byteOffset = length;
		parts.push(bytes);
		length = pad4(byteOffset + bytes.byteLength);
		json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength });
		json.images.push({ mimeType: 'image/ktx2', bufferView: json.bufferViews.length - 1 });
		added.set(imageIndex, json.images.length - 1);
	}
	if (!added.size) return { json, bin: bin ?? new Uint8Array(0) };
	for (const texture of json.textures ?? []) {
		const target = added.get(texture.source);
		if (target === undefined) continue;
		texture.extensions = { ...(texture.extensions ?? {}), KHR_texture_basisu: { source: target } };
	}
	useExtension(json, 'KHR_texture_basisu', false);
	const out = new Uint8Array(length);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at = pad4(at + part.byteLength);
	}
	if (!json.buffers?.length) json.buffers = [{ byteLength: length }];
	return { json, bin: out };
}

/**
 * The bytes of an image, from a GLB's BIN chunk or a data: URI. Null for an external URI (the
 * engine never writes one) or anything missing.
 * @param {any} json @param {Uint8Array | null} bin @param {number} imageIndex @returns {Uint8Array | null}
 */
export function imageBytes(json, bin, imageIndex) {
	const image = json.images?.[imageIndex];
	if (!image) return null;
	if (typeof image.uri === 'string') {
		const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(image.uri);
		if (!m) return null;
		if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
		const raw = atob(m[2]);
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	}
	const viewDef = json.bufferViews?.[image.bufferView];
	if (!viewDef || !bin || (viewDef.buffer ?? 0) !== 0) return null;
	const start = viewDef.byteOffset ?? 0;
	if (start + viewDef.byteLength > bin.byteLength) return null;
	return bin.subarray(start, start + viewDef.byteLength);
}

/**
 * For each texture with KHR_texture_basisu: its KTX2 bytes and whether a plain fallback image
 * rides beside it. What the scene path needs to give a parsed texture its twin.
 * @param {any} json @param {Uint8Array | null} bin
 * @returns {Map<number, {bytes: Uint8Array, fallback: boolean}>} texture index -> KTX2
 */
export function ktx2Textures(json, bin) {
	/** @type {Map<number, {bytes: Uint8Array, fallback: boolean}>} */
	const out = new Map();
	(json.textures ?? []).forEach((/** @type {any} */ texture, /** @type {number} */ index) => {
		const source = texture?.extensions?.KHR_texture_basisu?.source;
		if (!Number.isInteger(source)) return;
		const bytes = imageBytes(json, bin, source);
		if (bytes) out.set(index, { bytes, fallback: Number.isInteger(texture.source) });
	});
	return out;
}

/**
 * Turn the engine's LOD markers into MSFT_lod. A LOD0 node carries `extras.tpLodKey`; each coarser
 * node carries `extras.tpLod = {of: key, level}` and sits OUTSIDE every scene (MSFT_lod's rule: a
 * reader that does not know the extension never sees the levels). LOD0 gets `extensions.MSFT_lod
 * .ids` in level order and `extras.MSFT_screencoverage` (one value per level incl. LOD0, the
 * transition heights `coverage` gives), and keeps `extras.tpLodRatios` so this app can rebuild the
 * chain as a generated LOD group when the file comes back in. Markers are removed.
 * @param {any} json @param {number[]} coverage screen coverage per level, LOD0 first
 * @returns {number} how many LOD0 nodes got a chain
 */
export function embedMsftLod(json, coverage) {
	const nodes = json.nodes ?? [];
	/** @type {Map<string, {level: number, index: number, ratio: number}[]>} */
	const levels = new Map();
	nodes.forEach((/** @type {any} */ node, /** @type {number} */ index) => {
		const marker = node?.extras?.tpLod;
		if (!marker || typeof marker.of !== 'string') return;
		const list = levels.get(marker.of) ?? [];
		list.push({ level: Number(marker.level) || 0, index, ratio: Number(marker.ratio) || 0 });
		levels.set(marker.of, list);
		delete node.extras.tpLod;
		if (!Object.keys(node.extras).length) delete node.extras;
	});
	let chains = 0;
	for (const node of nodes) {
		const key = node?.extras?.tpLodKey;
		if (typeof key !== 'string') continue;
		delete node.extras.tpLodKey;
		const list = (levels.get(key) ?? []).sort((a, b) => a.level - b.level);
		if (!list.length) {
			if (!Object.keys(node.extras).length) delete node.extras;
			continue;
		}
		node.extensions = { ...(node.extensions ?? {}), MSFT_lod: { ids: list.map((l) => l.index) } };
		node.extras = {
			...(node.extras ?? {}),
			MSFT_screencoverage: coverage.slice(0, list.length + 1),
			tpLodRatios: list.map((l) => l.ratio)
		};
		chains++;
	}
	if (chains) useExtension(json, 'MSFT_lod', false);
	return chains;
}
