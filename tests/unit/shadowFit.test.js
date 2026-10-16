// 46-media R1 — the budgeted shadow: the fitted square (pure) and the fit applied to a REAL three
// DirectionalLightShadow, judged by what three's own shadow-frustum cull would draw.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitSquare, fitRadius, claimInForce, SHADOW_FIT_RADIUS, SHADOW_FIT_MIN, SHADOW_FIT_MAX } from '../../src/lib/shadowFitCore.js';
import { fitShadowAround } from '../../src/lib/shadowBudget.js';
import { claimBudgetedShadows, shadowsKeptInXR, shadowClaims } from '../../src/lib/shadowClaims.js';
import { get } from 'svelte/store';

describe('fitSquare', () => {
	it('is a square of the radius around the point', () => {
		const sq = fitSquare(10, -4, 40, 2048);
		expect(sq.right - sq.left).toBeCloseTo(80, 6);
		expect(sq.top - sq.bottom).toBeCloseTo(80, 6);
		expect((sq.left + sq.right) / 2).toBeCloseTo(10, 1);
		expect((sq.top + sq.bottom) / 2).toBeCloseTo(-4, 1);
	});
	it('snaps its centre to whole texels, so a moving viewer does not crawl the shadow edges', () => {
		const texel = 80 / 2048;
		const a = fitSquare(10.001, 3.0004, 40, 2048);
		const b = fitSquare(10.004, 3.0011, 40, 2048);
		expect(a.texel).toBeCloseTo(texel, 9);
		const cx = (a.left + a.right) / 2;
		expect(Math.abs(cx / texel - Math.round(cx / texel))).toBeLessThan(1e-6);
		// sub-texel motion lands on the SAME square
		expect(b.left).toBeCloseTo(a.left, 9);
		expect(b.top).toBeCloseTo(a.top, 9);
	});
	it('clamps the reach and falls back on nonsense', () => {
		expect(fitRadius(undefined)).toBe(SHADOW_FIT_RADIUS);
		expect(fitRadius(-3)).toBe(SHADOW_FIT_RADIUS);
		expect(fitRadius(1)).toBe(SHADOW_FIT_MIN);
		expect(fitRadius(1e6)).toBe(SHADOW_FIT_MAX);
		expect(fitRadius(45)).toBe(45);
	});
	it('the largest claim wins', () => {
		expect(claimInForce([])).toBe(null);
		expect(claimInForce([{ radius: 30 }, { radius: 60 }, { radius: 0 }])).toEqual({ radius: 60 });
	});
});

describe('claims', () => {
	it('hold, stack and release idempotently', () => {
		expect(shadowsKeptInXR()).toBe(false);
		const a = claimBudgetedShadows({ radius: 45, owner: 'race' });
		const b = claimBudgetedShadows({ radius: 20 });
		expect(shadowsKeptInXR()).toBe(true);
		a();
		a();
		expect(get(shadowClaims).length).toBe(1);
		b();
		expect(shadowsKeptInXR()).toBe(false);
	});
});

/** A sun like Race's: far up and away, its authored frustum over the whole valley (±326 x ±262). */
function raceSun() {
	const light = new THREE.DirectionalLight(0xffffff, 2);
	light.castShadow = true;
	light.position.set(-60, 70, 50);
	light.target.position.set(0, 0, 0);
	light.shadow.mapSize.set(2048, 2048);
	const c = light.shadow.camera;
	Object.assign(c, { left: -325.8, right: 325.8, top: 262.4, bottom: -262.4, near: 0.1, far: 364.6 });
	c.updateProjectionMatrix();
	light.updateMatrixWorld(true);
	light.target.updateMatrixWorld(true);
	return light;
}

/** a tree-sized box at (x, z) @param {number} x @param {number} z */
function caster(x, z) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 2), new THREE.MeshBasicMaterial());
	m.position.set(x, 4, z);
	m.updateMatrixWorld(true);
	return m;
}

describe('fitShadowAround (a real DirectionalLightShadow)', () => {
	it('keeps the casters near the viewer and drops the far valley — the authored frustum keeps all', () => {
		const light = raceSun();
		const viewer = new THREE.Vector3(11, 1.6, 40); // Race's spawn
		const near = [caster(14, 34), caster(0, 32), caster(24, 6)];
		const far = [caster(-80, 10), caster(82, -6), caster(30, -54), caster(-50, -52)];
		light.shadow.updateMatrices(light);
		const all = [...near, ...far];
		expect(all.every((m) => light.shadow.getFrustum().intersectsObject(m))).toBe(true);
		fitShadowAround(light.shadow, viewer, 45);
		const f = light.shadow.getFrustum();
		expect(near.every((m) => f.intersectsObject(m))).toBe(true);
		expect(far.filter((m) => f.intersectsObject(m)).length).toBe(0);
	});
	it('touches the projection only: the authored left/right/top/bottom (scene data) are unchanged', () => {
		const light = raceSun();
		light.shadow.updateMatrices(light);
		fitShadowAround(light.shadow, new THREE.Vector3(11, 1.6, 40), 45);
		const c = light.shadow.camera;
		expect([c.left, c.right, c.top, c.bottom]).toEqual([-325.8, 325.8, 262.4, -262.4]);
		const before = c.projectionMatrix.clone();
		c.updateProjectionMatrix();
		expect(c.projectionMatrix.equals(before)).toBe(false); // the authored one comes back on demand
	});
	it('the shadow MATRIX maps the viewer into the middle of the map (what the receivers sample)', () => {
		const light = raceSun();
		light.shadow.updateMatrices(light);
		const viewer = new THREE.Vector3(11, 0, 40);
		fitShadowAround(light.shadow, viewer, 45);
		const uv = viewer.clone().applyMatrix4(light.shadow.matrix);
		expect(uv.x).toBeCloseTo(0.5, 2);
		expect(uv.y).toBeCloseTo(0.5, 2);
	});
});

describe('the prototype patch', () => {
	it('reaches DirectionalLightShadow through an instance (three does not export the class)', () => {
		expect(/** @type {any} */ (THREE).DirectionalLightShadow).toBeUndefined();
		const proto = Object.getPrototypeOf(new THREE.DirectionalLight().shadow);
		expect(typeof proto.updateMatrices).toBe('function');
		expect(proto).not.toBe(Object.getPrototypeOf(new THREE.SpotLight().shadow));
	});
});
