// @ts-nocheck — test fixture builder (node only)
// 46 P1 — glTF FIXTURES FOR THE OPTIMIZER SUITE, built in node with glTF-Transform + sharp so the
// repository carries no binary blobs: a UV sphere of a chosen density, a textured material (a
// colour map and a normal map at chosen sizes), the same mesh placed twice (a shared mesh must be
// simplified once and counted twice), and a duplicate material (dedup has something to merge).
// `nodeEnv()` is the engine's environment for node: sharp decodes/resizes/encodes, the Basis
// encoder's node build writes KTX2.
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';
import * as THREE from 'three';
import { ktx2EncodeOptions } from '../../src/lib/gltfOptimize/presets.js';

/** A deterministic RGBA gradient image as PNG (or JPEG) bytes. */
export async function gradientImage(width, height, { mime = 'image/png', alpha = false, seed = 0 } = {}) {
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = (x * 255) / Math.max(1, width - 1);
			data[i + 1] = (y * 255) / Math.max(1, height - 1);
			data[i + 2] = ((x ^ y) + seed) & 0xff;
			data[i + 3] = alpha ? (x % 2 ? 128 : 255) : 255;
		}
	const s = sharp(data, { raw: { width, height, channels: 4 } });
	const out = mime === 'image/jpeg' ? await s.jpeg({ quality: 90 }).toBuffer() : await s.png().toBuffer();
	return new Uint8Array(out);
}

/**
 * Build a GLB: `placements` copies of one UV sphere (w x h segments), a material with a colour
 * map of `texture` px and (optionally) a normal map, plus a duplicate of that material on a
 * second small box mesh.
 */
export async function buildFixture({
	segments = [64, 32],
	placements = 1,
	texture = [512, 256],
	normalMap = false,
	textureMime = 'image/png',
	duplicateMaterial = true
} = {}) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const g = new THREE.SphereGeometry(1, segments[0], segments[1]);
	const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const position = acc('VEC3', new Float32Array(g.attributes.position.array));
	const normal = acc('VEC3', new Float32Array(g.attributes.normal.array));
	const uv = acc('VEC2', new Float32Array(g.attributes.uv.array));
	const indices = acc('SCALAR', new Uint32Array(g.index.array));
	const tex = doc
		.createTexture('albedo')
		.setImage(await gradientImage(texture[0], texture[1], { mime: textureMime }))
		.setMimeType(textureMime);
	const material = doc.createMaterial('mat').setBaseColorTexture(tex);
	if (normalMap) {
		const n = doc.createTexture('normal').setImage(await gradientImage(texture[0], texture[1], { seed: 77 })).setMimeType('image/png');
		material.setNormalTexture(n);
	}
	const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setAttribute('TEXCOORD_0', uv).setIndices(indices).setMaterial(material);
	const mesh = doc.createMesh('sphere').addPrimitive(prim);
	const scene = doc.createScene('scene');
	for (let i = 0; i < placements; i++)
		scene.addChild(doc.createNode('sphere' + i).setMesh(mesh).setTranslation([i * 3, 0, 0]).setExtras({ __uuid: 'uuid-' + i }));
	if (duplicateMaterial) {
		const b = new THREE.BoxGeometry(1, 1, 1);
		const twin = material.clone().setName('mat-copy');
		const boxPrim = doc
			.createPrimitive()
			.setAttribute('POSITION', acc('VEC3', new Float32Array(b.attributes.position.array)))
			.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(b.attributes.uv.array)))
			.setIndices(acc('SCALAR', new Uint32Array(b.index.array)))
			.setMaterial(twin);
		scene.addChild(doc.createNode('box').setMesh(doc.createMesh('box').addPrimitive(boxPrim)).setTranslation([0, 3, 0]));
	}
	return new Uint8Array(await new WebIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc));
}

/** Read a GLB back with every extension and the meshopt decoder (what a viewer would need). */
export async function readBack(bytes) {
	await MeshoptDecoder.ready;
	return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(bytes);
}

/** The engine's environment in node. */
export function nodeEnv() {
	return {
		MeshoptEncoder,
		MeshoptDecoder,
		MeshoptSimplifier,
		async decodeImage(bytes, _mime, maxSize) {
			let s = sharp(Buffer.from(bytes));
			const meta = await s.metadata();
			if (maxSize && Math.max(meta.width, meta.height) > maxSize)
				s = s.resize({ width: maxSize, height: maxSize, fit: 'inside', kernel: 'lanczos3' });
			const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
			return { data: new Uint8Array(data), width: info.width, height: info.height };
		},
		async encodeImage(rgba, mime) {
			const s = sharp(Buffer.from(rgba.data), { raw: { width: rgba.width, height: rgba.height, channels: 4 } });
			const out = mime === 'image/jpeg' ? await s.jpeg({ quality: 90 }).toBuffer() : mime === 'image/webp' ? await s.webp().toBuffer() : await s.png().toBuffer();
			return new Uint8Array(out);
		},
		async encodeKtx2(rgba, { mode, srgb, normal }) {
			return encodeToKTX2(new Uint8Array(1), { imageDecoder: async () => rgba, ...ktx2EncodeOptions({ mode, srgb, normal }) });
		}
	};
}
