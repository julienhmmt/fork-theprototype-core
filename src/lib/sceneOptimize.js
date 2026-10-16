import { optimizeImagesInWorker } from './gltfOptimize.js';
import { EXPORT_PRESETS, gpuBytes } from './gltfOptimize/presets.js';
import { generatedGroup } from './lodGroupCore';

// 46 P3 — THE .tpscene "FOR QUEST / WEB" PRESET. A .tpscene carries its objects as three toJSON
// elements (textures as data URLs inside each), so the glTF engine cannot take it whole. The same
// policy is applied to its parts instead:
//   TEXTURES  every data-URL image is resized to the preset's cap (the picture in session.json
//             shrinks with it) and encoded to KTX2 beside it — `ktx2/<image uuid>.ktx2` entries in
//             the zip, indexed by TEXTURE uuid in `session.json.ktx2` (ObjectLoader keeps texture
//             uuids, not image ones). A reader that knows the index gives each texture its twin
//             (ktx2Twins.attachTwinsByTextureUuid, from sessions.applySession); an older reader
//             ignores the field and draws the (resized) pictures.
//   LOD       every object over 3000 triangles without a group gets a generated LOD GROUP (the
//             preset's ratios) — numbers in its userData, built on the loading device.
//   GEOMETRY  stays as it is: toJSON writes its vertices plainly and three's loader reads nothing
//             else, so quantization has nowhere to go in this format (the GLTF preset has it).
// Animated imports (their original bytes) and pack stubs are left alone.

const LOD_MIN_TRIANGLES = 3000;
const COLOR_SLOTS = ['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap'];
const NORMAL_SLOTS = ['normalMap', 'clearcoatNormalMap'];
const ALL_SLOTS = [
	...COLOR_SLOTS,
	...NORMAL_SLOTS,
	'roughnessMap',
	'metalnessMap',
	'aoMap',
	'alphaMap',
	'bumpMap',
	'displacementMap',
	'emissiveIntensityMap',
	'clearcoatMap',
	'clearcoatRoughnessMap',
	'sheenRoughnessMap',
	'transmissionMap',
	'thicknessMap',
	'specularIntensityMap',
	'iridescenceMap',
	'anisotropyMap',
	'lightMap'
];

/** @param {string} url @returns {{mime: string, bytes: Uint8Array} | null} */
function dataUrlBytes(url) {
	const m = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(url);
	if (!m) return null;
	const raw = atob(m[2]);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return { mime: m[1], bytes };
}

/** @param {Uint8Array} bytes */
function base64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
	return btoa(s);
}

/** Triangles a toJSON geometry draws. @param {any} g */
function geometryTriangles(g) {
	const data = g?.data;
	if (!data) return 0;
	if (data.index?.array?.length) return Math.floor(data.index.array.length / 3);
	const pos = data.attributes?.position;
	return pos?.array?.length ? Math.floor(pos.array.length / (pos.itemSize || 3) / 3) : 0;
}

/** @param {any} node @param {(n: any) => void} fn */
function walk(node, fn) {
	if (!node) return;
	fn(node);
	for (const c of node.children ?? []) walk(c, fn);
}

/**
 * Apply the Quest/web preset to a session payload (not mutated — a copy comes back).
 * @param {any} payload buildSessionPayload's
 * @param {{onProgress?: (p: any) => void}} [hooks]
 * @returns {Promise<{payload: any, files: Record<string, Uint8Array>, report: any}>}
 */
export async function optimizeScenePayload(payload, hooks = {}) {
	const preset = /** @type {any} */ (EXPORT_PRESETS.quest.options);
	const objects = structuredClone(payload.objects ?? []);
	/** image uuid -> {mime, bytes, normal, srgb, refs: [{image def}]} */
	/** @type {Map<string, any>} */
	const images = new Map();
	/** texture uuid -> image uuid @type {Map<string, string>} */
	const textureImage = new Map();
	let lodStamped = 0;
	let trianglesInLodObjects = 0;
	for (const el of objects) {
		if (!el || typeof el !== 'object' || !el.object) continue;
		/** texture uuid -> the slots that use it in this element @type {Map<string, Set<string>>} */
		const slotsOf = new Map();
		for (const mat of el.materials ?? []) {
			for (const slot of ALL_SLOTS) {
				const t = mat?.[slot];
				if (typeof t !== 'string') continue;
				const set = slotsOf.get(t) ?? new Set();
				set.add(slot);
				slotsOf.set(t, set);
			}
		}
		for (const tex of el.textures ?? [])
			if (tex?.uuid && typeof tex.image === 'string') textureImage.set(tex.uuid, tex.image);
		for (const img of el.images ?? []) {
			if (!img?.uuid || typeof img.url !== 'string') continue;
			const decoded = dataUrlBytes(img.url);
			if (!decoded) continue;
			let entry = images.get(img.uuid);
			if (!entry) {
				entry = { ...decoded, normal: false, srgb: false, defs: [] };
				images.set(img.uuid, entry);
			}
			entry.defs.push(img);
			for (const tex of el.textures ?? []) {
				if (tex?.image !== img.uuid) continue;
				for (const slot of slotsOf.get(tex.uuid) ?? []) {
					if (NORMAL_SLOTS.includes(slot)) entry.normal = true;
					if (COLOR_SLOTS.includes(slot)) entry.srgb = true;
				}
			}
		}
		// the LOD chain, on the root of every heavy object that has none
		const root = el.object;
		const stub = root.userData?.packStub || root.userData?.packRef;
		let skinned = false;
		let tris = 0;
		const geoms = new Map((el.geometries ?? []).map((/** @type {any} */ g) => [g.uuid, g]));
		walk(root, (n) => {
			if (n.type === 'SkinnedMesh') skinned = true;
			if (n.geometry && geoms.has(n.geometry)) tris += geometryTriangles(geoms.get(n.geometry));
		});
		if (!stub && !skinned && !root.userData?.lod && tris >= LOD_MIN_TRIANGLES) {
			root.userData = { ...(root.userData ?? {}), lod: generatedGroup(preset.lods) };
			lodStamped++;
			trianglesInLodObjects += tris;
		}
	}
	const list = [...images.entries()].map(([id, e]) => ({
		id,
		bytes: e.bytes,
		mime: e.mime,
		normal: e.normal,
		srgb: e.srgb
	}));
	const results = list.length
		? await optimizeImagesInWorker(
				list,
				{ maxTextureSize: preset.maxTextureSize, ktx2: true },
				hooks
			)
		: [];
	/** @type {Record<string, Uint8Array>} */
	const files = {};
	/** @type {Record<string, string>} */
	const ktx2Index = {};
	let gpuBefore = 0;
	let gpuAfter = 0;
	let resized = 0;
	let ktx2Bytes = 0;
	let bytesBefore = 0;
	let bytesAfter = 0;
	for (const r of results) {
		const entry = images.get(r.id);
		bytesBefore += entry.bytes.byteLength;
		gpuBefore += r.gpuBefore || gpuBytes(r.sourceWidth, r.sourceHeight, 'rgba8');
		gpuAfter += r.gpuAfter;
		if (r.plain) {
			resized++;
			const url = 'data:' + r.plainMime + ';base64,' + base64(r.plain);
			for (const def of entry.defs) def.url = url;
			bytesAfter += r.plain.byteLength;
		} else bytesAfter += entry.bytes.byteLength;
		if (r.ktx2) {
			const file = 'ktx2/' + r.id + '.ktx2';
			files[file] = r.ktx2;
			ktx2Bytes += r.ktx2.byteLength;
			bytesAfter += r.ktx2.byteLength;
			for (const [texture, image] of textureImage) if (image === r.id) ktx2Index[texture] = file;
		}
	}
	const out = { ...payload, objects };
	if (Object.keys(ktx2Index).length) out.ktx2 = ktx2Index;
	return {
		payload: out,
		files,
		report: {
			images: results.length,
			resized,
			ktx2Bytes,
			gpuBefore,
			gpuAfter,
			bytesBefore,
			bytesAfter,
			lodStamped,
			trianglesInLodObjects
		}
	};
}

/**
 * The reading half: the zip's `ktx2/` entries, per TEXTURE uuid, for applySession to give each
 * texture its twin. Kept on the payload under a key no serializer writes (`__ktx2`).
 * @param {any} payload @param {Record<string, Uint8Array>} entries
 */
export function restoreKtx2Sidecars(payload, entries) {
	const index = payload?.ktx2;
	if (!index || typeof index !== 'object') return payload;
	/** @type {Record<string, Uint8Array>} */
	const map = {};
	for (const [texture, file] of Object.entries(index)) {
		const bytes = entries[/** @type {string} */ (file)];
		if (bytes) map[texture] = bytes.slice();
	}
	if (Object.keys(map).length)
		Object.defineProperty(payload, '__ktx2', { value: map, enumerable: false, configurable: true });
	return payload;
}
