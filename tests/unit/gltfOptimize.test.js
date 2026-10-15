// @ts-nocheck — fixture-driven engine suite (node; sharp + the Basis encoder's node build)
// 46 P1 — the glTF optimizer engine (src/lib/gltfOptimize): the pure GLB surgery, the import
// settings arithmetic, and the engine itself against REAL meshoptimizer + the REAL Basis encoder
// on generated fixtures. What is pinned is what the import and export paths rely on: a scene-safe
// file keeps an ordinary image beside every KTX2 one, a Quest/web file reads back with only the
// decoders a viewer has, the LOD chain sits outside every scene, and the numbers the report gives
// (the docs quote them) are the file's own.
import { describe, it, expect, beforeAll } from 'vitest';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { optimizeGltfBytes, sceneStats, sniffMime, UnsupportedGltfError } from '../../src/lib/gltfOptimize/core.js';
import {
	unpackGlb,
	packGlb,
	isGlb,
	addKtx2Fallback,
	ktx2Textures,
	imageBytes,
	embedMsftLod
} from '../../src/lib/gltfOptimize/glbPost.js';
import {
	normalizeImportSettings,
	importDecision,
	importOptions,
	fitSize,
	gpuBytes,
	EXPORT_PRESETS,
	IMPORT_DEFAULTS,
	percentChange,
	shortBytes
} from '../../src/lib/gltfOptimize/presets.js';
import { buildFixture, readBack, nodeEnv, gradientImage } from '../fixtures/gltfOptimizeFixtures.js';

const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];
const isKtx2 = (b) => KTX2_MAGIC.every((v, i) => b[i] === v);

beforeAll(async () => {
	await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
});

describe('glbPost — the container', () => {
	it('packs and unpacks a GLB, padding both chunks to 4 bytes', () => {
		const json = { asset: { version: '2.0' }, buffers: [{ byteLength: 3 }] };
		const glb = packGlb(json, new Uint8Array([1, 2, 3]));
		expect(isGlb(glb)).toBe(true);
		expect(glb.byteLength % 4).toBe(0);
		const back = unpackGlb(glb);
		expect(back.json.asset.version).toBe('2.0');
		expect(Array.from(back.bin.subarray(0, 3))).toEqual([1, 2, 3]);
		expect(back.json.buffers[0].byteLength).toBe(3);
	});
	it('reads a .gltf JSON (no BIN) and refuses a truncated GLB', () => {
		const text = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
		expect(unpackGlb(text).bin).toBe(null);
		const glb = packGlb({ asset: { version: '2.0' } }, new Uint8Array(16));
		const cut = glb.slice(0, glb.byteLength - 8);
		// the header still claims the full length; the BIN chunk now runs past the end
		new DataView(cut.buffer).setUint32(8, glb.byteLength, true);
		expect(() => unpackGlb(cut)).toThrow();
	});
	it('appends KTX2 images BESIDE the plain ones (used, not required)', () => {
		const json = {
			asset: { version: '2.0' },
			buffers: [{ byteLength: 4 }],
			bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
			images: [{ mimeType: 'image/png', bufferView: 0 }],
			textures: [{ source: 0 }, { source: 0, sampler: 0 }]
		};
		const ktx = new Uint8Array([...KTX2_MAGIC, 9, 9, 9]);
		const { json: out, bin } = addKtx2Fallback(json, new Uint8Array([7, 7, 7, 7]), new Map([[0, ktx]]));
		expect(out.images).toHaveLength(2);
		expect(out.images[1].mimeType).toBe('image/ktx2');
		for (const t of out.textures) {
			expect(t.source).toBe(0);
			expect(t.extensions.KHR_texture_basisu.source).toBe(1);
		}
		expect(out.extensionsUsed).toContain('KHR_texture_basisu');
		expect(out.extensionsRequired ?? []).not.toContain('KHR_texture_basisu');
		expect(Array.from(imageBytes(out, bin, 0))).toEqual([7, 7, 7, 7]);
		expect(isKtx2(imageBytes(out, bin, 1))).toBe(true);
		const twins = ktx2Textures(out, bin);
		expect(twins.size).toBe(2);
		expect(twins.get(0).fallback).toBe(true);
	});
	it('reads an image out of a data: URI', () => {
		const json = { images: [{ uri: 'data:image/png;base64,' + Buffer.from([1, 2, 3]).toString('base64') }] };
		expect(Array.from(imageBytes(json, null, 0))).toEqual([1, 2, 3]);
	});
	it('turns LOD markers into MSFT_lod with coverage and ratios', () => {
		const json = {
			nodes: [
				{ name: 'a', mesh: 0, extras: { tpLodKey: 'k0', keep: 1 } },
				{ name: 'a2', mesh: 2, extras: { tpLod: { of: 'k0', level: 2, ratio: 0.25 } } },
				{ name: 'a1', mesh: 1, extras: { tpLod: { of: 'k0', level: 1, ratio: 0.5 } } },
				{ name: 'b', mesh: 3, extras: { tpLodKey: 'k1' } }
			]
		};
		expect(embedMsftLod(json, [0.25, 0.1, 0.04])).toBe(1);
		expect(json.nodes[0].extensions.MSFT_lod.ids).toEqual([2, 1]);
		expect(json.nodes[0].extras.MSFT_screencoverage).toEqual([0.25, 0.1, 0.04]);
		expect(json.nodes[0].extras.tpLodRatios).toEqual([0.5, 0.25]);
		expect(json.nodes[0].extras.keep).toBe(1);
		expect(json.nodes[1].extras).toBeUndefined();
		// a key with no levels gets no extension and loses its marker
		expect(json.nodes[3].extensions).toBeUndefined();
		expect(json.nodes[3].extras).toBeUndefined();
		expect(json.extensionsUsed).toEqual(['MSFT_lod']);
	});
});

describe('presets — the import settings', () => {
	it('clamps, fills and orders the ratios', () => {
		const s = normalizeImportSettings({ lodLevels: 4, lodRatios: [0.6, 0.7, 'x'], maxTextureSize: 99999, triangleThreshold: -5 });
		expect(s.lodLevels).toBe(4);
		expect(s.lodRatios).toHaveLength(4);
		for (let i = 1; i < 4; i++) expect(s.lodRatios[i]).toBeLessThan(s.lodRatios[i - 1]);
		expect(s.maxTextureSize).toBe(4096);
		expect(s.triangleThreshold).toBe(1000);
		expect(normalizeImportSettings(null)).toEqual({ ...IMPORT_DEFAULTS, lodRatios: [0.5, 0.25, 0.1] });
		expect(normalizeImportSettings({ lodLevels: 0 }).lodRatios).toEqual([]);
	});
	it('decides from the decision thresholds (50k triangles / 2048 px)', () => {
		const d = normalizeImportSettings();
		expect(importDecision({ triangles: 50001, maxTextureSide: 1024 }, d)).toEqual({ optimize: true, lod: true, textures: false });
		expect(importDecision({ triangles: 50000, maxTextureSide: 2048 }, d).optimize).toBe(false);
		expect(importDecision({ triangles: 10, maxTextureSide: 4096 }, d)).toEqual({ optimize: true, lod: false, textures: true });
		expect(importDecision({ triangles: 9e6, maxTextureSide: 8192 }, { ...d, auto: false }).optimize).toBe(false);
	});
	it('an import keeps a plain image and never quantizes', () => {
		const o = importOptions(normalizeImportSettings());
		expect(o.textures).toBe('ktx2+fallback');
		expect(o.meshopt).toBe(false);
		expect(o.embedLods).toBe(false);
		expect(importOptions(normalizeImportSettings({ compress: false })).textures).toBe('keep');
		expect(EXPORT_PRESETS.full.options).toBe(null);
		expect(EXPORT_PRESETS.quest.options.textures).toBe('ktx2');
	});
	it('fits sizes, estimates GPU bytes and words the deltas', () => {
		expect(fitSize(4096, 2048, 2048)).toEqual([2048, 1024]);
		expect(fitSize(100, 50, 0)).toEqual([100, 50]);
		expect(gpuBytes(1024, 1024, 'rgba8')).toBe(Math.round(1024 * 1024 * 4 * (4 / 3)));
		expect(gpuBytes(1024, 1024, 'etc1sOpaque') * 8).toBeCloseTo(gpuBytes(1024, 1024, 'rgba8'), -2);
		expect(percentChange(100, 37)).toBe('−63%');
		expect(percentChange(100, 120)).toBe('+20%');
		expect(shortBytes(3 * 1024 * 1024)).toBe('3 MB');
	});
});

describe('engine', () => {
	it('dedups, welds and reports — geometry untouched without a reduce', async () => {
		const input = await buildFixture({ segments: [48, 24], placements: 2, texture: [64, 64] });
		const { bytes, report } = await optimizeGltfBytes(input, {}, nodeEnv());
		const doc = await readBack(bytes);
		expect(doc.getRoot().listMaterials()).toHaveLength(1); // the duplicate material merged
		expect(report.trianglesAfter).toBe(report.trianglesBefore);
		expect(report.trianglesBefore).toBe(2 * 48 * 24 * 2 - 2 * 2 * 48 + 12);
		// both placements and the app's extras survive
		const names = doc.getRoot().listNodes().map((n) => n.getName());
		expect(names).toEqual(expect.arrayContaining(['sphere0', 'sphere1', 'box']));
		expect(doc.getRoot().listNodes().find((n) => n.getName() === 'sphere1').getExtras().__uuid).toBe('uuid-1');
	});

	it('resizes a texture past the cap and reports the GPU saving', async () => {
		const input = await buildFixture({ texture: [1024, 512], duplicateMaterial: false });
		const { bytes, report } = await optimizeGltfBytes(input, { maxTextureSize: 256 }, nodeEnv());
		const tex = report.textures[0];
		expect([tex.width, tex.height]).toEqual([1024, 512]);
		expect([tex.after.width, tex.after.height]).toEqual([256, 128]);
		expect(tex.after.mime).toBe('image/png');
		expect(report.gpuBytesAfter * 16).toBeCloseTo(report.gpuBytesBefore, -2);
		const doc = await readBack(bytes);
		expect(doc.getRoot().listTextures()[0].getSize()).toEqual([256, 128]);
		expect(report.bytesAfter).toBeLessThan(report.bytesBefore);
	});

	it('keeps a texture under the cap byte-identical', async () => {
		const input = await buildFixture({ texture: [128, 64], duplicateMaterial: false });
		const before = (await readBack(input)).getRoot().listTextures()[0].getImage();
		const { bytes } = await optimizeGltfBytes(input, { maxTextureSize: 256 }, nodeEnv());
		const after = (await readBack(bytes)).getRoot().listTextures()[0].getImage();
		expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
	});

	it('ktx2+fallback: every texture keeps its plain image AND gains a KTX2 twin (UASTC for the normal map)', async () => {
		const input = await buildFixture({ texture: [512, 512], normalMap: true, duplicateMaterial: false });
		const { bytes, report } = await optimizeGltfBytes(input, { maxTextureSize: 256, textures: 'ktx2+fallback' }, nodeEnv());
		const { json, bin } = unpackGlb(bytes);
		const twins = ktx2Textures(json, bin);
		expect(twins.size).toBe(2);
		for (const [, t] of twins) {
			expect(t.fallback).toBe(true);
			expect(isKtx2(t.bytes)).toBe(true);
		}
		expect(json.extensionsRequired ?? []).not.toContain('KHR_texture_basisu');
		// plain images are still PNG at the capped size
		const doc = await readBack(bytes);
		const plain = doc.getRoot().listTextures().filter((t) => t.getMimeType() === 'image/png');
		expect(plain.map((t) => t.getSize())).toEqual([[256, 256], [256, 256]]);
		const normalRow = report.textures.find((t) => t.slots.includes('normalTexture'));
		const colorRow = report.textures.find((t) => t.slots.includes('baseColorTexture'));
		// UASTC lands at 1 B/px, ETC1S opaque at 0.5
		expect(normalRow.after.gpu).toBe(gpuBytes(256, 256, 'uastc'));
		expect(colorRow.after.gpu).toBe(gpuBytes(256, 256, 'etc1sOpaque'));
		expect(report.gpuBytesAfter).toBeLessThan(report.gpuBytesBefore / 8);
	}, 60000);

	it('the Quest/web preset: KTX2 only, meshopt, MSFT_lod — smaller, and it reads back', async () => {
		const input = await buildFixture({ segments: [256, 128], placements: 2, texture: [1024, 1024], normalMap: true });
		const { bytes, report } = await optimizeGltfBytes(input, EXPORT_PRESETS.quest.options, nodeEnv());
		expect(report.bytesAfter).toBeLessThan(report.bytesBefore / 2);
		const { json } = unpackGlb(bytes);
		expect(json.extensionsRequired).toEqual(expect.arrayContaining(['KHR_texture_basisu', 'EXT_meshopt_compression']));
		expect(json.extensionsUsed).toContain('MSFT_lod');
		// no plain image is left
		expect(json.images.every((i) => i.mimeType === 'image/ktx2')).toBe(true);
		// the LOD chain: one chain per placement, levels outside every scene, triangles falling
		const lod0 = json.nodes.filter((n) => n.extensions?.MSFT_lod);
		expect(lod0).toHaveLength(2);
		const inScene = new Set();
		const walk = (i) => {
			inScene.add(i);
			for (const c of json.nodes[i].children ?? []) walk(c);
		};
		for (const s of json.scenes) for (const n of s.nodes) walk(n);
		for (const n of lod0) {
			expect(n.extensions.MSFT_lod.ids).toHaveLength(3);
			for (const id of n.extensions.MSFT_lod.ids) expect(inScene.has(id)).toBe(false);
			expect(n.extras.tpLodRatios).toEqual([0.5, 0.25, 0.1]);
			expect(n.extras.MSFT_screencoverage).toHaveLength(4);
		}
		const sphereTris = 2 * 256 * 128 - 2 * 256;
		expect(report.lods.map((l) => l.ratio)).toEqual([0.5, 0.25, 0.1]);
		report.lods.forEach((l, i) => {
			const target = 2 * sphereTris * l.ratio;
			expect(l.triangles).toBeLessThanOrEqual(target * 1.02);
			expect(l.triangles).toBeGreaterThan(target * 0.6);
			if (i) expect(l.triangles).toBeLessThan(report.lods[i - 1].triangles);
		});
		// LOD0 is untouched
		expect(report.trianglesAfter).toBe(report.trianglesBefore);
		// reads back with only what a viewer has (meshopt decoder + the extensions)
		const doc = await readBack(bytes);
		expect(sceneStats(doc).triangles).toBe(report.trianglesBefore);
		for (const t of doc.getRoot().listTextures()) {
			expect(t.getMimeType()).toBe('image/ktx2');
			expect(t.getSize()).toEqual([1024, 1024]);
		}
	}, 120000);

	it('reduce simplifies LOD0 toward the ratio', async () => {
		const input = await buildFixture({ segments: [128, 64], texture: [32, 32], duplicateMaterial: false });
		const { report } = await optimizeGltfBytes(input, { reduce: 0.25 }, nodeEnv());
		const target = report.trianglesBefore * 0.25;
		expect(report.trianglesAfter).toBeLessThanOrEqual(target * 1.02);
		expect(report.trianglesAfter).toBeGreaterThan(target * 0.5);
		expect(report.verticesAfter).toBeLessThan(report.verticesBefore / 2);
	});

	it('takes a .gltf with embedded data, refuses one with external files', async () => {
		const input = await buildFixture({ texture: [64, 64], duplicateMaterial: false });
		const { json, bin } = unpackGlb(input);
		json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64');
		const text = new TextEncoder().encode(JSON.stringify(json));
		const { report } = await optimizeGltfBytes(text, {}, nodeEnv());
		expect(report.trianglesBefore).toBeGreaterThan(0);
		json.buffers[0].uri = 'scene.bin';
		await expect(optimizeGltfBytes(new TextEncoder().encode(JSON.stringify(json)), {}, nodeEnv())).rejects.toBeInstanceOf(UnsupportedGltfError);
	});

	it('reports progress through the textures and a failed decode as a skipped row', async () => {
		const input = await buildFixture({ texture: [512, 256], duplicateMaterial: false });
		const steps = [];
		const env = { ...nodeEnv(), onProgress: (p) => steps.push(p.step), decodeImage: async () => { throw new Error('boom'); } };
		const { report } = await optimizeGltfBytes(input, { maxTextureSize: 128 }, env);
		expect(steps[0]).toBe('reading');
		expect(steps).toContain('textures');
		expect(steps.at(-1)).toBe('done');
		expect(report.textures[0].skipped).toMatch(/boom/);
		expect(report.textures[0].after.width).toBe(512);
	});

	it('sniffs image formats', async () => {
		expect(sniffMime(await gradientImage(4, 4))).toBe('image/png');
		expect(sniffMime(await gradientImage(4, 4, { mime: 'image/jpeg' }))).toBe('image/jpeg');
		expect(sniffMime(new Uint8Array(KTX2_MAGIC.concat([0, 0, 0, 0, 0, 0, 0, 0])))).toBe('image/ktx2');
	});
});
