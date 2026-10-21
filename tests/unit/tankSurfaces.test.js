// @ts-nocheck — plain fixtures; the leaf under test is typed
// 49-water W1: a fluid tank's particles landing on a W1 water surface leave the tank's
// simulation and are reported as splashes (the solver contract both solvers implement).
import { describe, it, expect } from 'vitest';
import { surfacesFor, inFootprint, crossSurfaces, SPLASH_CAP, SURFACE_VMIN } from '../../src/lib/sim/tankSurfaces.js';
import { FluidSolver, spacingFor } from '../../src/lib/sim/fluidCore.js';

/** a column-major translate-rotateY matrix (three's Matrix4.elements) */
function mat(tx, ty, tz, yaw = 0, sx = 1, sy = 1, sz = 1) {
	const c = Math.cos(yaw), s = Math.sin(yaw);
	return [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, tx, ty, tz, 1];
}
const IDENTITY = mat(0, 0, 0);
/** a W1 volume stand-in: a box pool with its surface at local y = level */
const pool = (e, level = 0.25, shape = 'box', uuid = 'pool') => ({
	uuid,
	shape,
	level,
	object: { matrixWorld: { elements: e } },
	bounds: { minX: -1, maxX: 1, minY: -0.5, maxY: 0.5, minZ: -1, maxZ: 1 }
});

const min = [-0.4, -0.5, -0.3];
const max = [0.4, 0.5, 0.3];

describe('surfacesFor', () => {
	it('a pool whose surface crosses the tank becomes a plane in the tank frame', () => {
		const list = surfacesFor([pool(IDENTITY, 0.1)], IDENTITY, min, max);
		expect(list.length).toBe(1);
		const s = list[0];
		expect(s.n[1]).toBeCloseTo(1);
		expect(s.d).toBeCloseTo(0.1);
		expect(s.hx).toBeCloseTo(1);
		expect(s.uuid).toBe('pool');
		expect(s.vmin).toBe(SURFACE_VMIN);
	});
	it('a pool whose surface is above or below the tank, or off to the side, is left out', () => {
		expect(surfacesFor([pool(mat(0, 3, 0))], IDENTITY, min, max).length).toBe(0);
		expect(surfacesFor([pool(mat(0, -3, 0))], IDENTITY, min, max).length).toBe(0);
		expect(surfacesFor([pool(mat(5, 0, 0))], IDENTITY, min, max).length).toBe(0);
	});
	it('follows the tank: a tank moved up 2 m sees a pool at y = 2 at its own origin', () => {
		const toTank = mat(0, -2, 0); // the inverse of a tank frame at y = 2
		const s = surfacesFor([pool(mat(0, 2, 0), 0)], toTank, min, max)[0];
		expect(s.d).toBeCloseTo(0);
	});
	it('scale and yaw of the pool are its footprint', () => {
		const s = surfacesFor([pool(mat(0, 0, 0, Math.PI / 4, 3, 1, 2), 0)], IDENTITY, min, max)[0];
		expect(s.hx).toBeCloseTo(3);
		expect(s.hz).toBeCloseTo(2);
		expect(inFootprint(s, 1.8, 0, -1.8)).toBe(true); // along the rotated x axis, 2.5 m out (of 3)
		expect(inFootprint(s, 1.6, 0, 1.6)).toBe(false); // along the rotated z axis, 2.3 m out (of 2)
	});
	it('a round pool is the inscribed ellipse', () => {
		const s = surfacesFor([pool(IDENTITY, 0, 'cylinder')], IDENTITY, min, max)[0];
		expect(s.round).toBe(true);
		expect(inFootprint(s, 0.9, 0, 0)).toBe(true);
		expect(inFootprint(s, 0.9, 0, 0.9)).toBe(false); // the corner of the box, outside the circle
	});
});

describe('crossSurfaces', () => {
	const s = surfacesFor([pool(IDENTITY, 0)], IDENTITY, min, max);
	const run = (from, to, dt = 1 / 60) => {
		const crossed = new Uint8Array(1);
		const hits = new Float32Array(5);
		const r = crossSurfaces(s, new Float32Array(from), new Float32Array(to), 1, dt, crossed, hits, 1);
		return { ...r, crossed: crossed[0], hits: Array.from(hits) };
	};
	it('a fast downward crossing is a landing, hit on the plane', () => {
		const r = run([0.1, 0.02, 0], [0.1, -0.02, 0]); // 2.4 m/s
		expect(r.crossed).toBe(1);
		expect(r.hits[1]).toBeCloseTo(0, 5);
		expect(r.hits[3]).toBeCloseTo(2.4, 3);
		expect(r.hits[4]).toBe(0);
	});
	it('a slow one (a bobbing surface) and an upward one are not', () => {
		expect(run([0, 0.001, 0], [0, -0.001, 0]).crossed).toBe(0); // 0.12 m/s
		expect(run([0, -0.02, 0], [0, 0.02, 0]).crossed).toBe(0);
		expect(run([0, -0.02, 0], [0, -0.06, 0]).crossed).toBe(0); // already under
	});
	it('outside the footprint is not', () => {
		expect(run([1.5, 0.02, 0], [1.5, -0.02, 0]).crossed).toBe(0);
	});
});

describe('the solver (CPU worker form of the contract)', () => {
	const size = [0.8, 1, 0.6];
	const G = { gravity: [0, -9.81, 0], viscosity: 0.05, surfaceTension: 0.5 };
	/** an empty tank with a pour from near the top */
	function pour(surfaces, frames = 90) {
		const sv = new FluidSolver({ min, max, capacity: 2000, spacing: spacingFor(size, 2000, 0.4) });
		let hits = 0;
		let sample = null;
		for (let f = 0; f < frames; f++) {
			for (let k = 0; k < 8; k++) sv.spawn([-0.1 + k * 0.025, 0.4, 0], [0, -1.5, 0]);
			sv.step(1 / 60, { ...G, surfaces });
			const h = sv.takeSplashes();
			if (h.length && !sample) sample = Array.from(h.slice(0, 5));
			hits += h.length / 5;
		}
		return { sv, hits, sample };
	}
	it('a pour onto a pool surface inside the tank LEAVES — counterfactual: no surface, it piles up', () => {
		const surface = surfacesFor([pool(IDENTITY, -0.1)], IDENTITY, min, max);
		const wet = pour(surface);
		const dry = pour(undefined);
		expect(dry.sv.count).toBe(720); // every particle poured is still in the tank
		expect(dry.sv.landed).toBe(0);
		expect(wet.sv.landed).toBeGreaterThan(600); // the stream joined the pool
		expect(wet.sv.count).toBeLessThan(120);
		expect(wet.sv.count + wet.sv.landed).toBe(720);
		expect(wet.hits).toBeGreaterThan(0);
		// a hit is on the plane, inside the stream's x range, moving down fast
		expect(wet.sample[1]).toBeCloseTo(-0.1, 3);
		expect(wet.sample[0]).toBeGreaterThan(-0.2);
		expect(wet.sample[0]).toBeLessThan(0.25);
		expect(wet.sample[3]).toBeGreaterThan(SURFACE_VMIN);
	});
	it('fluid already resting below the surface (a tank standing in a pool) stays in the tank', () => {
		const sv = new FluidSolver({ min, max, capacity: 1500, spacing: spacingFor(size, 1500, 0.4) });
		sv.fillBlock(0.4, 1500); // its top is ~-0.1
		const surface = surfacesFor([pool(IDENTITY, 0.2)], IDENTITY, min, max);
		for (let f = 0; f < 120; f++) sv.step(1 / 60, { ...G, surfaces: surface });
		expect(sv.count).toBe(1500);
		expect(sv.landed).toBe(0);
	});
	it('a resting fluid whose surface bobs across the pool plane is not drained (the vmin rule)', () => {
		const sv = new FluidSolver({ min, max, capacity: 1500, spacing: spacingFor(size, 1500, 0.4) });
		sv.fillBlock(0.4, 1500);
		for (let f = 0; f < 120; f++) sv.step(1 / 60, G); // settle first
		let top = -Infinity;
		for (let i = 0; i < sv.count; i++) top = Math.max(top, sv.x[i * 3 + 1]);
		const surface = surfacesFor([pool(IDENTITY, top - 0.05)], IDENTITY, min, max);
		for (let f = 0; f < 120; f++) sv.step(1 / 60, { ...G, surfaces: surface });
		expect(sv.landed).toBeLessThan(15); // a few spray particles at most, not the 0.05 m layer
	});
	it('the hits are capped per call; every landing is still counted', () => {
		const sv = new FluidSolver({ min, max, capacity: 3000, spacing: spacingFor(size, 3000, 0.4) });
		for (let i = 0; i < 400; i++) sv.spawn([-0.35 + (i % 20) * 0.035, 0.05, -0.25 + Math.floor(i / 20) * 0.025], [0, -6, 0]);
		const surface = surfacesFor([pool(IDENTITY, 0)], IDENTITY, min, max);
		sv.step(1 / 60, { ...G, surfaces: surface });
		const h = sv.takeSplashes();
		expect(sv.landed).toBeGreaterThan(SPLASH_CAP);
		expect(h.length).toBe(SPLASH_CAP * 5);
		expect(sv.count + sv.landed).toBe(400);
		expect(sv.takeSplashes().length).toBe(0);
	});
});
