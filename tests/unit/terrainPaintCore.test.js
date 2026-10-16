import { describe, it, expect } from 'vitest';
import {
	createSplat,
	paintSplatAt,
	layerCoverage,
	bytesToBase64,
	base64ToBytes,
	decodeSplatBlock,
	encodeSplatBlock,
	wireSplatBytes,
	normalizeLayers,
	DEFAULT_LAYERS
} from '../../src/lib/terrainPaintCore.js';
import {
	encodeInstances,
	decodeInstances,
	scatterInCircle,
	eraseInCircle,
	normalizeScatter,
	buildHeightGrid,
	sampleHeight,
	rng32,
	MAX_INSTANCES
} from '../../src/lib/terrainScatterCore.js';

const sums = (/** @type {Uint8Array} */ b) => {
	for (let i = 0; i < b.length; i += 4) if (b[i] + b[i + 1] + b[i + 2] + b[i + 3] !== 255) return false;
	return true;
};

describe('terrain splat', () => {
	it('starts as 100 % layer 0', () => {
		const b = createSplat(16);
		expect(layerCoverage(b, 0)).toBe(1);
		expect(sums(b)).toBe(true);
	});

	it('paints a layer at the brush and keeps every texel summing to 255', () => {
		const b = createSplat(32);
		let dirty = null;
		for (let k = 0; k < 60; k++) dirty = paintSplatAt(b, 32, 0.5, 0.5, 0.2, 2, 1, 0.033) ?? dirty;
		expect(dirty).not.toBeNull();
		const centre = (16 * 32 + 16) * 4;
		expect(b[centre + 2]).toBeGreaterThan(240);
		expect(sums(b)).toBe(true);
		// outside the radius is untouched
		expect(b[0]).toBe(255);
		expect(layerCoverage(b, 2)).toBeGreaterThan(0.02);
		expect(layerCoverage(b, 2)).toBeLessThan(0.2);
	});

	it('a slow brush still makes progress (no rounding stall)', () => {
		const b = createSplat(8);
		const d = paintSplatAt(b, 8, 0.5, 0.5, 0.3, 1, 0.05, 0.001);
		expect(d).not.toBeNull();
		expect(sums(b)).toBe(true);
	});

	it('refuses a bad layer or radius', () => {
		const b = createSplat(8);
		expect(paintSplatAt(b, 8, 0.5, 0.5, 0.3, 4, 1)).toBeNull();
		expect(paintSplatAt(b, 8, 0.5, 0.5, 0, 1, 1)).toBeNull();
	});

	it('round-trips through base64 and the stored block', () => {
		const b = createSplat(16);
		paintSplatAt(b, 16, 0.3, 0.7, 0.2, 3, 1, 0.1);
		expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
		const block = encodeSplatBlock(b, 16);
		expect(decodeSplatBlock(block)?.bytes).toEqual(b);
		expect(decodeSplatBlock({ ...block, res: 17 })).toBeNull();
		expect(decodeSplatBlock({ res: 16, data: '!!' })).toBeNull();
		expect(decodeSplatBlock(null)).toBeNull();
	});

	it('copies wire bytes and checks their length', () => {
		const b = createSplat(4);
		const copy = wireSplatBytes(b.buffer, 4);
		expect(copy).toEqual(b);
		expect(copy?.buffer).not.toBe(b.buffer);
		expect(wireSplatBytes(new ArrayBuffer(3), 4)).toBeNull();
	});

	it('normalizes layers to exactly four', () => {
		expect(normalizeLayers(null)).toEqual(DEFAULT_LAYERS.map((l) => ({ ...l })));
		const l = normalizeLayers([{ color: '#FF0000', tiling: 9999, texture: 'abc' }, { color: 'red' }]);
		expect(l).toHaveLength(4);
		expect(l[0]).toEqual({ color: '#ff0000', texture: 'abc', tiling: 200 });
		expect(l[1].color).toBe(DEFAULT_LAYERS[1].color);
		// layer 0 alone may be colourless (= the material)
		expect(normalizeLayers([{ color: '' }, { color: '' }])[0].color).toBe('');
		expect(normalizeLayers([{ color: '' }, { color: '' }])[1].color).toBe(DEFAULT_LAYERS[1].color);
	});
});

describe('terrain scatter', () => {
	const bounds = { minX: -12, minZ: -12, sizeX: 24, sizeZ: 24 };

	it('encodes 8 bytes per instance and decodes within quantization', () => {
		const list = [
			{ x: 0, z: 0, yaw: 1, scale: 1.25 },
			{ x: -12, z: 12, yaw: 7, scale: 0.5 }
		];
		const bytes = encodeInstances(list, bounds);
		expect(bytes.length).toBe(16);
		const back = decodeInstances(bytes, bounds);
		expect(back[0].x).toBeCloseTo(0, 3);
		expect(back[1].z).toBeCloseTo(12, 3);
		expect(back[1].yaw).toBeCloseTo(7 - Math.PI * 2, 3);
		expect(back[0].scale).toBeCloseTo(1.25, 3);
	});

	it('fills a circle up to density × area and never past it', () => {
		const rng = rng32(7);
		const o = { cx: 0, cz: 0, radius: 3, density: 0.5, scaleMin: 0.8, scaleMax: 1.2, randomRotation: true, bounds, rng };
		const target = Math.floor(0.5 * Math.PI * 9);
		const first = scatterInCircle([], o);
		expect(first.length).toBeGreaterThan(target * 0.6);
		expect(first.length).toBeLessThanOrEqual(target);
		for (const p of first) {
			expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(3 + 1e-9);
			expect(p.scale).toBeGreaterThanOrEqual(0.8);
			expect(p.scale).toBeLessThanOrEqual(1.2);
		}
		// painting the same spot again tops up to the target, never beyond it
		const again = scatterInCircle(first, o);
		expect(first.length + again.length).toBeLessThanOrEqual(target);
	});

	it('honours the room left under the cap', () => {
		const o = { cx: 0, cz: 0, radius: 5, density: 2, scaleMin: 1, scaleMax: 1, randomRotation: false, bounds, rng: rng32(1), room: 3 };
		const added = scatterInCircle([], o);
		expect(added).toHaveLength(3);
		expect(added.every((p) => p.yaw === 0)).toBe(true);
	});

	it('erase removes only inside the circle', () => {
		const list = [{ x: 0, z: 0, yaw: 0, scale: 1 }, { x: 5, z: 0, yaw: 0, scale: 1 }];
		expect(eraseInCircle(list, 0, 0, 1)).toEqual([list[1]]);
	});

	it('normalizes blocks: drops bad sets, caps the total', () => {
		const one = bytesToBase64(encodeInstances([{ x: 0, z: 0, yaw: 0, scale: 1 }], bounds));
		const n = normalizeScatter(
			{
				sets: [
					{ id: 'a', source: { kind: 'primitive', type: 'Cone' }, data: one, align: 1 },
					{ id: 'b', source: { kind: 'primitive', type: 'Nope' }, data: one },
					{ id: 'c', source: { kind: 'library', hash: 'deadbeef', name: 'Tree' }, data: '' }
				]
			},
			base64ToBytes
		);
		expect(n?.sets).toHaveLength(1);
		expect(n?.sets[0]).toMatchObject({ id: 'a', align: true, count: 1 });
		expect(normalizeScatter(null, base64ToBytes)).toBeNull();
		const big = bytesToBase64(new Uint8Array((MAX_INSTANCES + 1) * 8));
		expect(normalizeScatter({ sets: [{ source: { kind: 'primitive', type: 'Box' }, data: big }] }, base64ToBytes)?.sets).toHaveLength(0);
	});

	it('samples heights on the drawn triangles', () => {
		// a 2x2-cell grid, size 2, centred: heights = x + 2z (a plane) → exact anywhere
		const pos = [];
		for (let iz = 0; iz <= 2; iz++) for (let ix = 0; ix <= 2; ix++) {
			const x = ix - 1, z = iz - 1;
			pos.push(x, x + 2 * z, z);
		}
		const g = buildHeightGrid(pos);
		expect(g?.n).toBe(2);
		const s = sampleHeight(/** @type {any} */ (g), 0.3, -0.4);
		expect(s.y).toBeCloseTo(0.3 - 0.8, 6);
		const len = Math.hypot(1, 1, 2);
		expect(s.nx).toBeCloseTo(-1 / len, 6);
		expect(s.nz).toBeCloseTo(-2 / len, 6);
		expect(buildHeightGrid([0, 0, 0])).toBeNull();
	});
});
