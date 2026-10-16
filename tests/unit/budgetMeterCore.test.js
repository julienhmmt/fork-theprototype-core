// @ts-nocheck — plain fixtures; the module under test is typed
// 46 B1/B2 — the budget meter's arithmetic (src/lib/budgetMeterCore.js): the three targets read from the
// gate's own file, the tiers, and the scene cost counted the gate's way. The browser half (the chip,
// Statistics ▸ Budget) is e2e `budget-meter`.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
	resolveTargets,
	judgeCost,
	tierOfShare,
	measureScene,
	heaviest,
	textureBytes,
	optimizedTextureBytes,
	trianglesOf,
	callsOf,
	formatCount,
	METRICS,
	OPTIMIZE_TRIANGLES
} from '../../src/lib/budgetMeterCore.js';

const budgets = JSON.parse(readFileSync(new URL('../../perf/budgets.json', import.meta.url), 'utf8'));
const T = resolveTargets(budgets);

/** a texture of w x h (no real image needed: the cost reads image.width/height) */
const tex = (w, h, extra = {}) => Object.assign(new THREE.Texture({ width: w, height: h }), extra);

describe('resolveTargets — one source with the perf gate', () => {
	it("Quest's gated numbers ARE the gate's defaults", () => {
		for (const m of ['calls', 'triangles', 'lights', 'textureMB']) expect(T.quest[m]).toBe(budgets.defaults[m]);
		expect(T.quest.calls).toBe(150);
		expect(T.quest.triangles).toBe(300000);
	});
	it('phone and desktop come from targets, every metric present, labels for the chip', () => {
		for (const id of ['phone', 'desktop']) for (const m of METRICS) expect(T[id][m]).toBe(budgets.targets[id][m]);
		expect(T.quest.short).toBe('Quest');
		expect(T.desktop.label).toBe('Desktop');
	});
	it('a missing number reads as Infinity — never a false red', () => {
		const t = resolveTargets({ defaults: { calls: 150 }, targets: {} });
		expect(t.quest.calls).toBe(150);
		expect(t.quest.triangles).toBe(Infinity);
		expect(t.phone.calls).toBe(Infinity);
		expect(tierOfShare(1e12, Infinity)).toBe('green');
	});
	it('a Quest copy in targets cannot override the gate (defaults win)', () => {
		const t = resolveTargets({ defaults: { calls: 150 }, targets: { quest: { calls: 999 } } });
		expect(t.quest.calls).toBe(150);
	});
});

describe('tiers', () => {
	it('green below 80 %, amber from 80 % up to the budget, red past it', () => {
		expect(tierOfShare(119, 150)).toBe('green');
		expect(tierOfShare(120, 150)).toBe('amber');
		expect(tierOfShare(150, 150)).toBe('amber');
		expect(tierOfShare(151, 150)).toBe('red');
	});
	it('a small whole-number budget has no amber band: AT it is green, past it red (an empty scene\'s one sun is not a warning)', () => {
		expect(tierOfShare(1, 1, true)).toBe('green');
		expect(tierOfShare(2, 1, true)).toBe('red');
		const sunOnly = judgeCost({ calls: 1, triangles: 48, textureMB: 0, lights: 1, shadowLights: 1, shadowCasters: 1 }, T.quest);
		expect(sunOnly.tier).toBe('green');
		expect(sunOnly.worst.key).not.toBe('shadowLights');
		expect(sunOnly.percent).toBeLessThan(5);
	});
	it('the verdict is the worst tier; the headline is the largest share', () => {
		const v = judgeCost({ calls: 30, triangles: 280000, textureMB: 10, lights: 1, shadowLights: 0, shadowCasters: 0 }, T.quest);
		expect(v.tier).toBe('amber');
		expect(v.worst.key).toBe('triangles');
		expect(v.percent).toBe(93);
		const red = judgeCost({ calls: 30, triangles: 10, textureMB: 10, lights: 3, shadowLights: 0, shadowCasters: 0 }, T.quest);
		expect(red.tier).toBe('red');
		expect(red.worst.key).toBe('lights');
		expect(judgeCost({ calls: 30, triangles: 10, textureMB: 10, lights: 3, shadowLights: 0, shadowCasters: 0 }, T.desktop).tier).toBe('green');
	});
});

describe('counting the gate’s way', () => {
	it('texture bytes = w*h*4 (x 4/3 mipmapped), faces for a cube', () => {
		expect(textureBytes(tex(1024, 1024))).toBeCloseTo(1024 * 1024 * 4 * (4 / 3));
		expect(textureBytes(tex(1024, 1024, { generateMipmaps: false }))).toBe(1024 * 1024 * 4);
		const cube = new THREE.CubeTexture([{ width: 64, height: 64 }, { width: 64, height: 64 }, { width: 64, height: 64 }, { width: 64, height: 64 }, { width: 64, height: 64 }, { width: 64, height: 64 }]);
		expect(textureBytes(cube)).toBeCloseTo(64 * 64 * 4 * 6 * (4 / 3));
	});
	it('optimizing resizes past 2048 px and keeps a quarter (KTX2)', () => {
		expect(optimizedTextureBytes(tex(4096, 4096))).toBeCloseTo(textureBytes(tex(2048, 2048)) * 0.25);
		expect(optimizedTextureBytes(tex(1024, 1024))).toBeCloseTo(textureBytes(tex(1024, 1024)) * 0.25);
		const compressed = Object.assign(tex(1024, 1024), { isCompressedTexture: true });
		expect(optimizedTextureBytes(compressed)).toBe(textureBytes(compressed));
	});
	it('triangles from the index (or positions), calls per material group', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		expect(trianglesOf(box)).toBe(12);
		expect(trianglesOf(box.toNonIndexed())).toBe(12);
		expect(callsOf(new THREE.Mesh(box, new THREE.MeshBasicMaterial()))).toBe(1);
		// a box with six groups and a six-slot material array is six draws
		expect(callsOf(new THREE.Mesh(box, Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial())))).toBe(6);
	});
});

describe('measureScene', () => {
	const scene = () => {
		const group = new THREE.Group();
		const box = new THREE.BoxGeometry(1, 1, 1);
		const big = new THREE.SphereGeometry(1, 256, 128); // 65k triangles
		const shared = tex(4096, 4096);
		const a = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ map: shared }));
		a.name = 'Crate';
		a.castShadow = true;
		const b = new THREE.Mesh(big, new THREE.MeshStandardMaterial({ map: shared }));
		b.name = 'Statue';
		const hidden = new THREE.Mesh(big, new THREE.MeshStandardMaterial());
		hidden.visible = false;
		const nested = new THREE.Group();
		nested.name = 'Lamp';
		const lamp = new THREE.PointLight();
		lamp.castShadow = true;
		nested.add(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), lamp, new THREE.AmbientLight());
		const helper = new THREE.Mesh(big, new THREE.MeshBasicMaterial());
		helper.layers.set(30); // HELPER_LAYER: the game camera never draws it
		group.add(a, b, hidden, nested, helper);
		const env = new THREE.Group();
		env.name = 'environment-root';
		env.add(new THREE.DirectionalLight(), new THREE.HemisphereLight());
		return { group, env, shared, a, b };
	};

	it('one row per top-level object, hidden subtrees and helper-layer meshes skipped', () => {
		const { group, env } = scene();
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }, { object: env, kind: 'environment', label: 'Environment' }] });
		expect(m.objects).toBe(5); // the hidden and helper rows exist but cost nothing
		const byName = Object.fromEntries(m.rows.map((r) => [r.name, r]));
		expect(byName.Crate.triangles).toBe(12);
		expect(byName.Statue.triangles).toBe(trianglesOf(new THREE.SphereGeometry(1, 256, 128)));
		expect(m.totals.triangles).toBe(12 + byName.Statue.triangles + 12);
		expect(m.totals.calls).toBe(3);
		expect(byName.Lamp.lights).toBe(1); // the ambient is not counted (the gate's rule)
		expect(byName.Lamp.shadowLights).toBe(1);
		expect(m.totals.lights).toBe(2); // + the environment's sun, not its hemisphere
		expect(m.totals.shadowCasters).toBe(1); // 1 caster x 1 shadow light
		expect(byName.Environment.selectable).toBe(false);
		expect(byName.Crate.selectable).toBe(true);
	});

	it('shadow DRAWS = casters x shadow-casting lights, and none without a shadow light', () => {
		const group = new THREE.Group();
		for (let i = 0; i < 5; i++) {
			const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
			m.castShadow = true;
			group.add(m);
		}
		expect(measureScene({ roots: [{ object: group, kind: 'objects' }] }).totals.shadowCasters).toBe(0);
		const sun = new THREE.DirectionalLight();
		sun.castShadow = true;
		const spot = new THREE.SpotLight();
		spot.castShadow = true;
		group.add(sun, spot);
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }] });
		expect(m.totals.shadowLights).toBe(2);
		expect(m.totals.shadowCasters).toBe(10);
		expect(m.rows.reduce((n, r) => n + r.shadowCasters, 0)).toBe(10); // rows add up to the total
	});

	it('a texture two objects share is in BOTH rows but counted once in the total', () => {
		const { group } = scene();
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }] });
		const crate = m.rows.find((r) => r.name === 'Crate');
		const statue = m.rows.find((r) => r.name === 'Statue');
		const mb = Math.round((textureBytes(tex(4096, 4096)) / 1048576) * 10) / 10;
		expect(crate.textureMB).toBe(mb);
		expect(statue.textureMB).toBe(mb);
		expect(m.totals.textureMB).toBe(mb);
	});

	it('the background / environment map count toward the total texture memory', () => {
		const { group } = scene();
		const sky = tex(2048, 1024);
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }], background: sky });
		const without = measureScene({ roots: [{ object: group, kind: 'objects' }] });
		expect(m.totals.textureMB).toBeGreaterThan(without.totals.textureMB);
	});

	it('kit copies that instance draw ONE call per (geometry, material); transparent ones do not batch', () => {
		const group = new THREE.Group();
		const geo = new THREE.BoxGeometry(1, 1, 1);
		const mat = new THREE.MeshStandardMaterial();
		const glass = new THREE.MeshStandardMaterial({ transparent: true });
		const kit = new Set();
		for (let i = 0; i < 10; i++) {
			const m = new THREE.Mesh(geo, mat);
			kit.add(m);
			group.add(m);
		}
		for (let i = 0; i < 3; i++) {
			const g = new THREE.Mesh(geo, glass);
			kit.add(g);
			group.add(g);
		}
		const input = { roots: [{ object: group, kind: 'objects' }], kitSourceOf: (n) => (kit.has(n) ? {} : null) };
		expect(measureScene({ ...input, kitInstancing: true }).totals.calls).toBe(1 + 3);
		expect(measureScene({ ...input, kitInstancing: false }).totals.calls).toBe(13);
		expect(measureScene({ ...input, kitInstancing: true }).totals.triangles).toBe(13 * 12);
	});

	it('an InstancedMesh is one call and count x the triangles', () => {
		const group = new THREE.Group();
		group.add(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 50));
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }] });
		expect(m.totals.calls).toBe(1);
		expect(m.totals.triangles).toBe(600);
	});

	it('what optimizing would save: a LOD chain for meshes past 50k, KTX2 + resize for textures', () => {
		const { group, b } = scene();
		const m = measureScene({ roots: [{ object: group, kind: 'objects' }] });
		const statue = m.rows.find((r) => r.name === 'Statue');
		expect(statue.triangles).toBeGreaterThan(OPTIMIZE_TRIANGLES);
		expect(statue.save.heavyMeshes).toBe(1);
		// the shipped Settings ▸ Import chain ends at 10 % of LOD 0
		expect(statue.save.lodTriangles).toBe(Math.round(statue.triangles * 0.9));
		expect(statue.save.bigTextures).toBe(1);
		expect(statue.save.textureMB).toBeGreaterThan(statue.textureMB * 0.9);
		const crate = m.rows.find((r) => r.name === 'Crate');
		expect(crate.save.heavyMeshes).toBe(0);
		// a mesh that already switches detail by distance gains nothing from a LOD chain
		const withLod = measureScene({ roots: [{ object: group, kind: 'objects' }], hasLod: (n) => n === b });
		expect(withLod.rows.find((r) => r.name === 'Statue').save.lodTriangles).toBe(0);
	});

	it("the estimate follows this device's Settings ▸ Import (46-int: the pipeline's own numbers)", () => {
		const { group } = scene();
		const roots = [{ object: group, kind: 'objects' }];
		const statueOf = (optimize) => measureScene({ roots, optimize }).rows.find((r) => r.name === 'Statue');
		// a higher triangle threshold: the statue is no longer a heavy mesh
		expect(statueOf({ triangleThreshold: 10_000_000 }).save.heavyMeshes).toBe(0);
		// a two-level chain at 50 % / 25 % saves three quarters
		const two = statueOf({ lodRatios: [0.5, 0.25] });
		expect(two.save.lodTriangles).toBe(Math.round(two.triangles * 0.75));
		// compression off: a resize only, no KTX2 quarter
		expect(optimizedTextureBytes(tex(4096, 4096), { textureThreshold: 2048, maxTextureSize: 2048, compress: false })).toBeCloseTo(textureBytes(tex(2048, 2048)));
		// a texture past the threshold but within the max size is only compressed
		expect(optimizedTextureBytes(tex(4096, 4096), { textureThreshold: 2048, maxTextureSize: 4096 })).toBeCloseTo(textureBytes(tex(4096, 4096)) * 0.25);
	});
});

describe('heaviest', () => {
	it('ranks by the largest share of any one budget, skips rows that cost nothing', () => {
		const rows = [
			{ uuid: 'a', name: 'a', calls: 1, triangles: 12, textureMB: 0, lights: 0, shadowLights: 0, shadowCasters: 0 },
			{ uuid: 'b', name: 'b', calls: 1, triangles: 150000, textureMB: 0, lights: 0, shadowLights: 0, shadowCasters: 0 },
			{ uuid: 'c', name: 'c', calls: 0, triangles: 0, textureMB: 40, lights: 0, shadowLights: 0, shadowCasters: 0 },
			{ uuid: 'd', name: 'd', calls: 0, triangles: 0, textureMB: 0, lights: 0, shadowLights: 0, shadowCasters: 0 }
		];
		const list = heaviest(rows, T.quest);
		expect(list.map((r) => r.uuid)).toEqual(['c', 'b', 'a']);
		expect(list[0].by).toBe('textureMB');
		expect(list[1].percent).toBe(50);
		expect(heaviest(rows, T.quest, 1)).toHaveLength(1);
	});
	it('formatCount', () => {
		expect(formatCount(950)).toBe('950');
		expect(formatCount(1500)).toBe('1.5k');
		expect(formatCount(300000)).toBe('300k');
		expect(formatCount(4000000)).toBe('4M');
	});
});
