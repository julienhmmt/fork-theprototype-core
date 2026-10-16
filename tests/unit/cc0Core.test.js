// @ts-nocheck — fixtures of the sites' JSON, deliberately loose
import { describe, it, expect } from 'vitest';
import {
	defaultResolution,
	normalizePolyHaven,
	normalizeAmbientCg,
	normalizePhCategories,
	normalizeAcgCategories,
	filterRows,
	phFilePlan,
	acgDownloadFor,
	acgMapsFromNames,
	sourceRecord,
	normalizeSource,
	creditLine,
	assetFileName,
	classifyError,
	gltfExternalUris,
	packGlb,
	glbJson,
	glbBin,
	isPhDownload
} from '../../src/lib/cc0/cc0Core.js';

const PH_MODELS = {
	wooden_crate_02: {
		name: 'Wooden Crate 02',
		categories: ['containers', 'props'],
		tags: ['wood', 'crate'],
		authors: { 'James Ray Cock': 'modeling' },
		download_count: 13060
	},
	ArmChair_01: { name: 'Arm Chair 01', categories: ['furniture', 'seating'], tags: ['chair'], authors: { 'Kirill Sannikov': 'All' }, download_count: 900 },
	'bad id!': { name: 'nope' }
};

describe('rows', () => {
	it('Poly Haven: most downloaded first, bad ids dropped, authors as names', () => {
		const rows = normalizePolyHaven(PH_MODELS, 'models');
		expect(rows.map((r) => r.id)).toEqual(['wooden_crate_02', 'ArmChair_01']);
		expect(rows[0]).toMatchObject({ source: 'polyhaven', kind: 'models', name: 'Wooden Crate 02', authors: ['James Ray Cock'], url: 'https://polyhaven.com/a/wooden_crate_02' });
		expect(rows[0].thumb).toMatch(/^https:\/\/cdn\.polyhaven\.com\/asset_img\/thumbs\/wooden_crate_02\.png/);
		expect(normalizePolyHaven(null, 'models')).toEqual([]);
	});
	it('ambientCG: title, thumb, downloads, one author', () => {
		const rows = normalizeAmbientCg({
			totalResults: 2,
			assets: [
				{ id: 'Wood096', title: 'Wood 096', tags: ['wood'], thumbnails: { '256-JPG-242424': 'https://acg-media.struffelproductions.com/x.jpg' }, downloads: [{ attributes: '1K-JPG' }] },
				{ id: '../evil' }
			]
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ source: 'ambientcg', kind: 'materials', name: 'Wood 096', authors: ['Lennart Demes'], thumb: 'https://acg-media.struffelproductions.com/x.jpg' });
	});
	it('categories: no "all", no collections, biggest first', () => {
		expect(normalizePhCategories({ all: 9, props: 5, 'collection: shed': 3, nature: 7 }).map((c) => c.id)).toEqual(['nature', 'props']);
		expect(normalizeAcgCategories([{ id: 'Wood', title: 'Wood', type: 'material', numberOfAssets: 3 }, { id: 'Sky', type: 'hdri', numberOfAssets: 9 }])).toEqual([{ id: 'Wood', label: 'Wood', count: 3 }]);
	});
	it('search: every word must hit; category narrows', () => {
		const rows = normalizePolyHaven(PH_MODELS, 'models');
		expect(filterRows(rows, { query: 'wood crate' }).map((r) => r.id)).toEqual(['wooden_crate_02']);
		expect(filterRows(rows, { query: 'chair wood' })).toHaveLength(0);
		expect(filterRows(rows, { category: 'seating' }).map((r) => r.id)).toEqual(['ArmChair_01']);
		expect(filterRows(rows, {})).toHaveLength(2);
	});
});

describe('resolution', () => {
	it('1k on a headset or a phone, 2k on a desktop', () => {
		expect(defaultResolution({ headset: true })).toBe('1k');
		expect(defaultResolution({ coarse: true })).toBe('1k');
		expect(defaultResolution({ coarse: true, fine: true })).toBe('2k');
		expect(defaultResolution({})).toBe('2k');
	});
});

describe('file plans', () => {
	const dl = (p) => 'https://dl.polyhaven.org/file/ph-assets/' + p;
	it('model: gltf + its includes at the asked resolution, nearest lower when missing', () => {
		const files = {
			gltf: {
				'1k': { gltf: { url: dl('m_1k.gltf'), size: 10, include: { 'm.bin': { url: dl('m.bin'), size: 100 }, 'textures/d_1k.jpg': { url: dl('d_1k.jpg'), size: 50 } } } },
				'4k': { gltf: { url: dl('m_4k.gltf'), size: 10, include: {} } }
			}
		};
		const p = phFilePlan(files, 'models', '2k');
		expect(p.res).toBe('1k');
		expect(p.total).toBe(160);
		expect(p.include.map((x) => x.path).sort()).toEqual(['m.bin', 'textures/d_1k.jpg']);
		expect(phFilePlan({ gltf: { '1k': { gltf: { url: 'https://evil.example/x.gltf' } } } }, 'models', '1k')).toBeNull();
	});
	it('hdri: the .hdr at the resolution', () => {
		const p = phFilePlan({ hdri: { '1k': { hdr: { url: dl('HDRIs/hdr/1k/sky_1k.hdr'), size: 5 } }, '2k': { hdr: { url: dl('HDRIs/hdr/2k/sky_2k.hdr'), size: 9 } } } }, 'hdris', '2k');
		expect(p).toMatchObject({ res: '2k', size: 9, fileName: 'sky_2k.hdr' });
	});
	it('texture: diffuse required, GL normal, rough', () => {
		const at = (n) => ({ '1k': { jpg: { url: dl(n), size: 1 } } });
		const p = phFilePlan({ Diffuse: at('d.jpg'), nor_gl: at('n.jpg'), nor_dx: at('dx.jpg'), Rough: at('r.jpg') }, 'textures', '1k');
		expect(Object.keys(p.maps).sort()).toEqual(['map', 'normalMap', 'roughness']);
		expect(p.maps.normalMap.url).toMatch(/n\.jpg$/);
		expect(phFilePlan({ nor_gl: at('n.jpg') }, 'textures', '1k')).toBeNull();
	});
	it('only Poly Haven download urls', () => {
		expect(isPhDownload('https://dl.polyhaven.org/file/x')).toBe(true);
		expect(isPhDownload('http://dl.polyhaven.org/file/x')).toBe(false);
		expect(isPhDownload('https://dl.polyhaven.org.evil/x')).toBe(false);
	});
	it('ambientCG: the JPG zip, nearest lower', () => {
		const d = [
			{ attributes: '1K-JPG', extension: 'zip', url: 'https://ambientcg.com/get?file=W_1K-JPG.zip', size: 7 },
			{ attributes: '1K-PNG', extension: 'zip', url: 'https://ambientcg.com/get?file=W_1K-PNG.zip', size: 17 },
			{ attributes: '4K-JPG', extension: 'zip', url: 'https://ambientcg.com/get?file=W_4K-JPG.zip', size: 70 }
		];
		expect(acgDownloadFor(d, '2k')).toMatchObject({ file: 'W_1K-JPG.zip', res: '1k' });
		expect(acgDownloadFor(d, '4k')).toMatchObject({ file: 'W_4K-JPG.zip' });
		expect(acgDownloadFor([], '1k')).toBeNull();
	});
	it('ambientCG zip names -> maps (GL not DX)', () => {
		const m = acgMapsFromNames(['W_1K-JPG.usdc', 'W_1K-JPG_Color.jpg', 'W_1K-JPG_NormalDX.jpg', 'W_1K-JPG_NormalGL.jpg', 'W_1K-JPG_Roughness.jpg', 'W.png']);
		expect(m).toEqual({ map: 'W_1K-JPG_Color.jpg', normalMap: 'W_1K-JPG_NormalGL.jpg', roughness: 'W_1K-JPG_Roughness.jpg' });
	});
});

describe('source records', () => {
	it('a row becomes a small CC0 record; foreign urls are dropped', () => {
		const s = sourceRecord({ source: 'polyhaven', id: 'x', name: 'X', authors: ['A'], url: 'https://polyhaven.com/a/x' });
		expect(s).toEqual({ site: 'polyhaven', id: 'x', name: 'X', authors: ['A'], license: 'CC0', url: 'https://polyhaven.com/a/x' });
		expect(sourceRecord({ source: 'ambientcg', url: 'javascript:alert(1)' }).url).toBe('');
		expect(normalizeSource({ site: 'elsewhere' })).toBeNull();
		expect(creditLine(s)).toBe('X — A (Poly Haven, CC0)');
	});
	it('file names', () => {
		expect(assetFileName('Wooden Crate 02', 'glb')).toBe('Wooden Crate 02.glb');
		expect(assetFileName('<b>/..', 'hdr')).toBe('b.hdr');
	});
	it('errors read as something to do', () => {
		expect(classifyError(new TypeError('Failed to fetch'), false).code).toBe('offline');
		expect(classifyError({ status: 503 }, true).code).toBe('http');
		expect(classifyError({ code: 'proxy', status: 502 }, true).code).toBe('proxy');
		expect(classifyError(new TypeError('Failed to fetch'), true).code).toBe('network');
	});
});

describe('glTF -> GLB', () => {
	const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7]); // 7 bytes: forces padding
	const jpg = new Uint8Array([0xff, 0xd8, 0xff, 9, 9]);
	const gltf = {
		asset: { version: '2.0' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0 }],
		buffers: [{ uri: 'm.bin', byteLength: 7 }],
		bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 3 }],
		images: [{ uri: 'textures/d%201k.jpg' }]
	};
	const res = (/** @type {string} */ u) => (u === 'm.bin' ? bin : u === 'textures/d 1k.jpg' ? jpg : null);

	it('lists what to fetch', () => {
		expect(gltfExternalUris(gltf).sort()).toEqual(['m.bin', 'textures/d%201k.jpg']);
	});
	it('one BIN chunk, views re-based, image embedded, credit in the scene extras', () => {
		const glb = packGlb(gltf, res, { source: { site: 'polyhaven', id: 'm', name: 'M', authors: ['A'], url: 'https://polyhaven.com/a/m' } });
		const dv = new DataView(glb.buffer);
		expect(dv.getUint32(0, true)).toBe(0x46546c67);
		expect(dv.getUint32(8, true)).toBe(glb.byteLength);
		expect(glb.byteLength % 4).toBe(0);
		const json = glbJson(glb);
		const body = glbBin(glb);
		expect(json.buffers).toEqual([{ byteLength: body.byteLength }]);
		expect(json.bufferViews[0]).toEqual({ buffer: 0, byteOffset: 4, byteLength: 3 });
		expect([...body.subarray(4, 7)]).toEqual([5, 6, 7]);
		const iv = json.bufferViews[json.images[0].bufferView];
		expect(iv.byteOffset % 4).toBe(0);
		expect([...body.subarray(iv.byteOffset, iv.byteOffset + iv.byteLength)]).toEqual([...jpg]);
		expect(json.images[0]).toMatchObject({ mimeType: 'image/jpeg' });
		expect(json.images[0].uri).toBeUndefined();
		expect(json.scenes[0].extras.source).toMatchObject({ site: 'polyhaven', license: 'CC0', id: 'm' });
		expect(json.asset.copyright).toBe('M — A (Poly Haven, CC0)');
		expect(gltf.images[0].uri).toBe('textures/d%201k.jpg'); // input untouched
	});
	it('a missing resource refuses with a format error', () => {
		expect(() => packGlb(gltf, () => null)).toThrow(/missing/);
	});
	it('data: uris are decoded in place', () => {
		const g = { asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AQID', byteLength: 3 }], bufferViews: [{ buffer: 0, byteLength: 3 }] };
		const glb = packGlb(g, () => null);
		expect([...glbBin(glb).subarray(0, 3)]).toEqual([1, 2, 3]);
	});
});

import { normalizePreset } from '../../src/lib/materialPresetsCore.js';
describe('material presets keep the credit', () => {
	it('a valid source survives normalizePreset; a forged one does not', () => {
		const src = { site: 'ambientcg', id: 'Wood096', name: 'Wood 096', authors: ['Lennart Demes'], url: 'https://ambientcg.com/a/Wood096' };
		expect(normalizePreset({ version: 1, label: 'Wood 096', type: 'MeshStandardMaterial', source: src }).source).toEqual({ ...src, license: 'CC0' });
		expect(normalizePreset({ version: 1, label: 'X', type: 'MeshStandardMaterial', source: { site: 'evil' } }).source).toBeUndefined();
		expect(normalizePreset({ version: 1, label: 'X', type: 'MeshStandardMaterial' }).source).toBeUndefined();
	});
});
