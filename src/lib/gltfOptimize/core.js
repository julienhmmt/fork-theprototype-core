// 46 P1 — THE OPTIMIZER ENGINE: glTF bytes in, optimized glTF bytes + a report out.
//
// ONE ENGINE FOR IMPORT AND EXPORT (the roadmap's line). An import asks it for a scene-safe copy
// (textures resized, KTX2 BESIDE the plain image, geometry deduplicated, the LOD chain left to the
// runtime); the "For Quest / web" export asks it for the smallest file (KTX2 only, quantized +
// meshopt-compressed, the LOD chain embedded as MSFT_lod). Which is which is only `options` —
// presets.js names the two.
//
// WHERE IT RUNS: in the optimizer Worker (gltfOptimize/optimizeWorker.js) and in vitest. It therefore
// takes the parts that differ between those two as an ENVIRONMENT: the meshoptimizer modules
// (their wasm is initialised by the caller), and three image functions — decode to RGBA8 at a
// maximum size, encode RGBA8 back to PNG/JPEG/WebP, encode RGBA8 to KTX2. The Worker builds them
// from createImageBitmap + OffscreenCanvas + the Basis encoder; the unit suite from sharp + the
// encoder's node build. Nothing here touches the DOM, three or a store.
//
// TEXTURE POLICY (the gltf-transform CLI's, and Unity's): colour data (base colour, emissive, and
// the occlusion/metal-rough maps) goes to ETC1S — small, and its block artifacts are invisible in
// those; NORMAL maps go to UASTC, because ETC1S smears a normal map into visible faceting. sRGB is
// declared exactly where the glTF slot says the texture is colour.

import { WebIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import {
	dedup,
	prune,
	weld,
	simplify,
	simplifyPrimitive,
	reorder,
	meshopt,
	listTextureSlots,
	getTextureColorSpace
} from '@gltf-transform/functions';
import { OPTIMIZE_DEFAULTS, gpuBytes, fitSize } from './presets.js';
import { isGlb, unpackGlb, packGlb, addKtx2Fallback, embedMsftLod, asBytes } from './glbPost.js';
import { defaultScreenSizes } from '../lodGroupCore.js';

/**
 * @typedef {{data: Uint8Array, width: number, height: number}} Rgba
 * @typedef {{
 *   MeshoptEncoder: any, MeshoptSimplifier: any, MeshoptDecoder: any,
 *   decodeImage: (bytes: Uint8Array, mime: string, maxSize: number) => Promise<Rgba>,
 *   encodeImage: (rgba: Rgba, mime: string) => Promise<Uint8Array>,
 *   encodeKtx2: (rgba: Rgba, opts: {mode: 'etc1s' | 'uastc', srgb: boolean, normal: boolean}) => Promise<Uint8Array>,
 *   onProgress?: (info: {step: string, done?: number, total?: number}) => void,
 *   now?: () => number
 * }} OptimizeEnv
 * @typedef {{name: string, slots: string[], mime: string, width: number, height: number, bytes: number,
 *   gpu: number, after: {mime: string, width: number, height: number, bytes: number, ktx2Bytes: number,
 *   gpu: number}, skipped?: string}} TextureReport
 * @typedef {{
 *   ms: number, bytesBefore: number, bytesAfter: number,
 *   trianglesBefore: number, trianglesAfter: number, verticesBefore: number, verticesAfter: number,
 *   lods: {ratio: number, triangles: number}[],
 *   textures: TextureReport[], gpuBytesBefore: number, gpuBytesAfter: number,
 *   meshes: number, skipped: {what: string, why: string}[], options: any
 * }} OptimizeReport
 */

/** The one error the engine raises on purpose: the file is fine, we just cannot work on it. */
export class UnsupportedGltfError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'UnsupportedGltfError';
	}
}

/** Textures the Basis encoder refuses past this many texels (its v2.5 32-bit guard). */
const MAX_KTX2_TEXELS = 12 * 1024 * 1024;
/** A mesh below this many triangles gets no LOD chain — nothing to take away. */
const LOD_MIN_TRIANGLES = 300;
const COLOR_SLOTS = /baseColor|emissive|diffuse|sheenColor|specularColor|specularGlossiness/i;
const NORMAL_SLOTS = /normal/i;

/** @param {any} prim */
function primTriangles(prim) {
	const mode = prim.getMode();
	const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
	if (mode === 4) return Math.floor(count / 3);
	if (mode === 5 || mode === 6) return Math.max(0, count - 2);
	return 0;
}

/** @param {any} mesh */
function meshTriangles(mesh) {
	let t = 0;
	for (const prim of mesh.listPrimitives()) t += primTriangles(prim);
	return t;
}

/** Triangles drawn by every scene (a mesh used twice counts twice) and the vertices uploaded
 * (a shared primitive once). @param {any} doc */
export function sceneStats(doc) {
	let triangles = 0;
	let vertices = 0;
	let meshes = 0;
	const seen = new Set();
	for (const scene of doc.getRoot().listScenes()) {
		scene.traverse((/** @type {any} */ node) => {
			const mesh = node.getMesh();
			if (!mesh) return;
			meshes++;
			for (const prim of mesh.listPrimitives()) {
				triangles += primTriangles(prim);
				if (seen.has(prim)) continue;
				seen.add(prim);
				vertices += prim.getAttribute('POSITION')?.getCount() ?? 0;
			}
		});
	}
	return { triangles, vertices, meshes };
}

/** Does any pixel have alpha below 255? Every 4th byte, early out. @param {Uint8Array} data */
function hasAlpha(data) {
	for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
	return false;
}

/**
 * @param {any} env @returns {any} a WebIO with every extension the engine reads or writes.
 */
function makeIo(env) {
	const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS);
	/** @type {Record<string, any>} */
	const deps = {};
	if (env.MeshoptDecoder) deps['meshopt.decoder'] = env.MeshoptDecoder;
	if (env.MeshoptEncoder) deps['meshopt.encoder'] = env.MeshoptEncoder;
	return io.registerDependencies(deps);
}

/** @param {any} io @param {Uint8Array} bytes */
async function readDocument(io, bytes) {
	try {
		if (isGlb(bytes)) return await io.readBinary(bytes);
		const json = JSON.parse(new TextDecoder().decode(bytes));
		for (const buffer of json.buffers ?? [])
			if (buffer.uri && !/^data:/.test(buffer.uri))
				throw new UnsupportedGltfError('This .gltf points at an external file (' + buffer.uri + '). Use a .glb, or embed its buffers.');
		for (const image of json.images ?? [])
			if (image.uri && !/^data:/.test(image.uri))
				throw new UnsupportedGltfError('This .gltf points at an external image (' + image.uri + '). Use a .glb, or embed its images.');
		return await io.readJSON({ json, resources: {} });
	} catch (error) {
		if (error instanceof UnsupportedGltfError) throw error;
		const message = String(/** @type {any} */ (error)?.message ?? error);
		if (/draco/i.test(message))
			throw new UnsupportedGltfError('This file is Draco-compressed; the optimizer cannot read Draco. It imports as it is.');
		throw error;
	}
}

/**
 * Build the LOD chain: for every mesh node that can take one, coarser copies of its mesh at each
 * ratio, on nodes OUTSIDE the scene (MSFT_lod's shape), marked for glbPost.embedMsftLod. A mesh
 * used by several nodes is simplified once. Skinned, morphed and parent nodes are left alone (a
 * level replaces the NODE, so a parent's children would vanish with it).
 * @param {any} doc @param {number[]} ratios @param {any} simplifier
 * @param {OptimizeReport} report
 */
function buildLodChain(doc, ratios, simplifier, report) {
	const root = doc.getRoot();
	/** @type {Map<any, any[]>} */
	const byMesh = new Map();
	const levelTriangles = ratios.map(() => 0);
	let key = 0;
	for (const scene of root.listScenes()) {
		/** @type {any[]} */
		const nodes = [];
		scene.traverse((/** @type {any} */ n) => nodes.push(n));
		for (const node of nodes) {
			const mesh = node.getMesh();
			if (!mesh) continue;
			if (node.getSkin()) {
				report.skipped.push({ what: node.getName() || 'mesh', why: 'skinned — no LOD' });
				continue;
			}
			if (node.listChildren().length) {
				report.skipped.push({ what: node.getName() || 'mesh', why: 'has children — no LOD' });
				continue;
			}
			if (mesh.listPrimitives().some((/** @type {any} */ p) => p.listTargets().length)) {
				report.skipped.push({ what: node.getName() || 'mesh', why: 'morph targets — no LOD' });
				continue;
			}
			if (meshTriangles(mesh) < LOD_MIN_TRIANGLES) continue;
			let levels = byMesh.get(mesh);
			if (!levels) {
				levels = ratios.map((ratio, li) => {
					const lodMesh = doc.createMesh((mesh.getName() || 'mesh') + '_LOD' + (li + 1));
					for (const prim of mesh.listPrimitives()) {
						if (prim.getMode() !== 4 || !prim.getIndices()) {
							lodMesh.addPrimitive(prim);
							continue;
						}
						const copy = prim.clone();
						// a coarser level may move further: the cap grows with the level
						simplifyPrimitive(copy, { simplifier, ratio, error: Math.min(0.2, 0.01 * 3 ** li) });
						lodMesh.addPrimitive(copy);
					}
					return lodMesh;
				});
				byMesh.set(mesh, levels);
			}
			const id = 'k' + key++;
			node.setExtras({ ...(node.getExtras() ?? {}), tpLodKey: id });
			levels.forEach((lodMesh, li) => {
				levelTriangles[li] += meshTriangles(lodMesh);
				doc
					.createNode((node.getName() || 'mesh') + '_LOD' + (li + 1))
					.setMesh(lodMesh)
					.setTranslation(node.getTranslation())
					.setRotation(node.getRotation())
					.setScale(node.getScale())
					.setExtras({ tpLod: { of: id, level: li + 1, ratio: ratios[li] } });
			});
		}
	}
	report.lods = ratios.map((ratio, i) => ({ ratio, triangles: levelTriangles[i] }));
}

/**
 * Resize and/or compress every texture. Returns the KTX2 twin per Texture when the mode keeps the
 * plain image (`ktx2+fallback`), for glbPost to append after the write.
 * @param {any} doc @param {import('./presets.js').OptimizeOptions} options @param {OptimizeEnv} env
 * @param {OptimizeReport} report @returns {Promise<Map<any, Uint8Array>>}
 */
async function processTextures(doc, options, env, report) {
	/** @type {Map<any, Uint8Array>} */
	const twins = new Map();
	const textures = doc.getRoot().listTextures();
	const wantKtx2 = options.textures === 'ktx2' || options.textures === 'ktx2+fallback';
	let done = 0;
	for (const texture of textures) {
		env.onProgress?.({ step: 'textures', done: done++, total: textures.length });
		const mime = texture.getMimeType() || 'image/png';
		const image = texture.getImage();
		const slots = listTextureSlots(texture);
		const [width, height] = texture.getSize() ?? [0, 0];
		/** @type {TextureReport} */
		const row = {
			name: texture.getName() || texture.getURI() || 'texture ' + done,
			slots,
			mime,
			width,
			height,
			bytes: image?.byteLength ?? 0,
			gpu: mime === 'image/ktx2' ? gpuBytes(width, height, 'uastc') : gpuBytes(width, height, 'rgba8'),
			after: { mime, width, height, bytes: image?.byteLength ?? 0, ktx2Bytes: 0, gpu: 0 }
		};
		row.after.gpu = row.gpu;
		report.textures.push(row);
		if (!image || !width || !height) {
			row.skipped = 'no image data';
			continue;
		}
		if (mime === 'image/ktx2') {
			row.skipped = 'already KTX2';
			continue;
		}
		const [w, h] = fitSize(width, height, options.maxTextureSize);
		const resize = w !== width || h !== height;
		if (!resize && !wantKtx2) continue;
		/** @type {Rgba} */
		let rgba;
		try {
			rgba = await env.decodeImage(image, mime, options.maxTextureSize);
		} catch (error) {
			row.skipped = 'could not decode: ' + String(/** @type {any} */ (error)?.message ?? error);
			continue;
		}
		const alpha = hasAlpha(rgba.data);
		let plain = image;
		let plainMime = mime;
		if (resize) {
			plain = await env.encodeImage(rgba, mime);
			// a format the encoder cannot write comes back as PNG
			plainMime = sniffMime(plain) ?? mime;
		}
		row.after.width = rgba.width;
		row.after.height = rgba.height;
		row.after.gpu = gpuBytes(rgba.width, rgba.height, 'rgba8');
		if (wantKtx2 && rgba.width * rgba.height <= MAX_KTX2_TEXELS) {
			const normal = slots.some((s) => NORMAL_SLOTS.test(s));
			const srgb = getTextureColorSpace(texture) === 'srgb' || slots.some((s) => COLOR_SLOTS.test(s) && !NORMAL_SLOTS.test(s));
			const mode = normal ? 'uastc' : 'etc1s';
			try {
				const ktx2 = await env.encodeKtx2(rgba, { mode, srgb, normal });
				row.after.ktx2Bytes = ktx2.byteLength;
				row.after.gpu = gpuBytes(rgba.width, rgba.height, mode === 'uastc' ? 'uastc' : alpha ? 'etc1sAlpha' : 'etc1sOpaque');
				if (options.textures === 'ktx2') {
					texture.setImage(ktx2).setMimeType('image/ktx2');
					if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.\w+$/, '') + '.ktx2');
					row.after.mime = 'image/ktx2';
					row.after.bytes = ktx2.byteLength;
					continue;
				}
				twins.set(texture, ktx2);
			} catch (error) {
				row.skipped = 'KTX2 encode failed: ' + String(/** @type {any} */ (error)?.message ?? error);
			}
		} else if (wantKtx2) row.skipped = 'too large for the Basis encoder';
		if (resize) {
			texture.setImage(plain).setMimeType(plainMime);
			row.after.mime = plainMime;
			row.after.bytes = plain.byteLength;
		}
	}
	if (options.textures === 'ktx2' && report.textures.some((t) => t.after.mime === 'image/ktx2'))
		doc.createExtension(KHRTextureBasisu).setRequired(true);
	env.onProgress?.({ step: 'textures', done: textures.length, total: textures.length });
	return twins;
}

/** PNG / JPEG / WebP by magic bytes. @param {Uint8Array} b @returns {string | null} */
export function sniffMime(b) {
	if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
	if (b.length > 12 && b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58) return 'image/ktx2';
	return null;
}

/**
 * Optimize glTF bytes (a .glb, or a .gltf with embedded data). Resolves the new GLB and a report.
 * @param {ArrayBuffer | ArrayBufferView} input
 * @param {Partial<import('./presets.js').OptimizeOptions> | null | undefined} opts
 * @param {OptimizeEnv} env
 * @returns {Promise<{bytes: Uint8Array, report: OptimizeReport}>}
 */
export async function optimizeGltfBytes(input, opts, env) {
	const now = env.now ?? (() => Date.now());
	const started = now();
	/** @type {import('./presets.js').OptimizeOptions} */
	const options = { ...OPTIMIZE_DEFAULTS, ...(opts ?? {}) };
	const bytes = asBytes(input);
	const io = makeIo(env);
	env.onProgress?.({ step: 'reading' });
	const doc = await readDocument(io, bytes);
	const before = sceneStats(doc);
	/** @type {OptimizeReport} */
	const report = {
		ms: 0,
		bytesBefore: bytes.byteLength,
		bytesAfter: 0,
		trianglesBefore: before.triangles,
		trianglesAfter: before.triangles,
		verticesBefore: before.vertices,
		verticesAfter: before.vertices,
		lods: [],
		textures: [],
		gpuBytesBefore: 0,
		gpuBytesAfter: 0,
		meshes: before.meshes,
		skipped: [],
		options
	};
	if (env.MeshoptSimplifier?.ready) await env.MeshoptSimplifier.ready;
	if (env.MeshoptEncoder?.ready) await env.MeshoptEncoder.ready;
	env.onProgress?.({ step: 'geometry' });
	if (options.dedup) await doc.transform(dedup());
	// prune BEFORE the LOD chain: its level nodes sit outside every scene on purpose. Empty leaves
	// and extras are kept — an app group or a marker can be an empty node that carries data.
	if (options.prune) await doc.transform(prune({ keepLeaves: true, keepExtras: true }));
	const simplifying = (options.reduce != null && options.reduce < 1) || (options.embedLods && options.lods.length > 0);
	if (options.weld || simplifying) await doc.transform(weld());
	if (options.reduce != null && options.reduce > 0 && options.reduce < 1)
		await doc.transform(simplify({ simplifier: env.MeshoptSimplifier, ratio: options.reduce, error: 0.01 }));
	if (options.embedLods && options.lods.length) buildLodChain(doc, options.lods, env.MeshoptSimplifier, report);
	const twins = await processTextures(doc, options, env, report);
	env.onProgress?.({ step: 'packing' });
	if (options.meshopt) await doc.transform(meshopt({ encoder: env.MeshoptEncoder, level: 'medium' }));
	else if (options.reorder && env.MeshoptEncoder) await doc.transform(reorder({ encoder: env.MeshoptEncoder, target: 'performance' }));
	const after = sceneStats(doc);
	report.trianglesAfter = after.triangles;
	report.verticesAfter = after.vertices;
	// the image index of each twin = its Texture's index (the writer numbers images that way)
	const textureOrder = doc.getRoot().listTextures();
	let out = await io.writeBinary(doc);
	const coverage = defaultScreenSizes(options.lods.length + 1);
	if (twins.size || (options.embedLods && report.lods.length)) {
		let { json, bin } = unpackGlb(out);
		if (twins.size) {
			/** @type {Map<number, Uint8Array>} */
			const byImage = new Map();
			for (const [texture, ktx2] of twins) {
				const index = textureOrder.indexOf(texture);
				if (index >= 0) byImage.set(index, ktx2);
			}
			({ json, bin } = addKtx2Fallback(json, bin, byImage));
		}
		if (options.embedLods && report.lods.length) embedMsftLod(json, coverage);
		out = /** @type {any} */ (packGlb(json, bin));
	}
	for (const t of report.textures) {
		report.gpuBytesBefore += t.gpu;
		report.gpuBytesAfter += t.after.gpu;
	}
	report.bytesAfter = out.byteLength;
	report.ms = Math.round(now() - started);
	env.onProgress?.({ step: 'done' });
	return { bytes: out, report };
}
