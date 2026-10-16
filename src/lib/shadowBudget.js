import * as THREE from 'three';
import { get } from 'svelte/store';
import { globalScene, globalRenderer, globalCamera, objectsGroup, isLocked } from '../stores/sceneStore';
import { shadowClaims } from './shadowClaims';
import { fitSquare, claimInForce, ENV_RIG_SUN } from './shadowFitCore';

// 46-media R1 — THE BUDGETED SHADOW, the wiring (the measurement and the rule are in
// shadowFitCore.js). While a claim holds (shadowClaims.js) AND the view is a player's — Play, or a
// headset session — two things change, both LOCAL and both undone the moment it stops:
//
//   · ONE DIRECTIONAL CASTER. When the scene authored its own shadow-casting directional light, the
//     environment rig's sun stops casting (it still LIGHTS): two suns drew every caster twice and
//     put two shadows under every object. Only the rig sun is touched — it lives in ENV_ROOT, which
//     never enters a save or the wire, whereas an authored light's castShadow is scene data.
//   · THE FITTED FRUSTUM. Every directional shadow camera is a square of `radius` around the viewer
//     (texel-snapped), so three's own shadow-frustum cull drops every caster whose shadow cannot
//     land near the player. Written into the shadow camera's PROJECTION MATRIX inside
//     `updateMatrices`, never into left/right/top/bottom: those are serialized (toJSON writes them,
//     the wire carries them), and a fit that wrote them would save the player's position into the
//     scene. A light's authored frustum is exactly what it was the frame the fit stops.
//
// The patch is on DirectionalLightShadow's PROTOTYPE, installed once: it reaches a light added at
// any time with no per-light bookkeeping, and costs one boolean read while no claim holds.

/** @type {{active: boolean, radius: number, viewer: THREE.Vector3, rigStoodDown: any}} */
const state = { active: false, radius: 0, viewer: new THREE.Vector3(), rigStoodDown: null };
const _v = new THREE.Vector3();
const _proj = new THREE.Matrix4();

/** The viewer's world position: the headset when one presents, else the rendering camera. */
function viewerPosition(/** @type {THREE.Vector3} */ out) {
	/** @type {any} */
	const r = get(globalRenderer);
	if (r?.xr?.isPresenting) {
		const cam = r.xr.getCamera();
		return out.setFromMatrixPosition(cam.matrixWorld);
	}
	/** @type {any} */
	const cam = get(globalCamera);
	if (!cam) return null;
	cam.updateWorldMatrix?.(true, false);
	return out.setFromMatrixPosition(cam.matrixWorld);
}

/**
 * Fit one directional shadow around `viewer` — the projection only, then the frustum + shadow
 * matrix three derives from it. Exported for the unit test (a scene with no renderer).
 * @param {any} shadow a DirectionalLightShadow whose camera three has just positioned
 * @param {THREE.Vector3} viewer @param {number} radius
 */
export function fitShadowAround(shadow, viewer, radius) {
	const cam = shadow.camera;
	_v.copy(viewer).applyMatrix4(cam.matrixWorldInverse);
	const sq = fitSquare(_v.x, _v.y, radius, shadow.mapSize?.x);
	cam.projectionMatrix.makeOrthographic(sq.left, sq.right, sq.top, sq.bottom, cam.near, cam.far, cam.coordinateSystem, cam.reversedDepth);
	cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
	if (typeof shadow._updateMatrix === 'function') {
		shadow._updateMatrix(cam, shadow.matrix, shadow._frustum);
		return sq;
	}
	// a three without the private helper: the same two lines it holds (WebGL coordinates)
	_proj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
	shadow._frustum.setFromProjectionMatrix(_proj, cam.coordinateSystem, cam.reversedDepth);
	shadow.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(_proj);
	return sq;
}

let patched = false;
function patchDirectionalShadows() {
	if (patched) return;
	patched = true;
	// three does not export DirectionalLightShadow — reach its prototype through an instance
	const proto = /** @type {any} */ (Object.getPrototypeOf(new THREE.DirectionalLight().shadow));
	const original = proto.updateMatrices;
	proto.updateMatrices = function (/** @type {any} */ light, /** @type {any[]} */ ...rest) {
		original.call(this, light, ...rest);
		if (!state.active) return;
		if (!viewerPosition(state.viewer)) return;
		fitShadowAround(this, state.viewer, state.radius);
	};
}

/** Is there an authored (objectsGroup) directional light that casts? @param {any} group */
function authoredDirectionalCaster(group) {
	let found = false;
	group?.traverse?.((/** @type {any} */ o) => {
		if (!found && o.isDirectionalLight && o.castShadow && o.visible !== false) found = true;
	});
	return found;
}

/** Re-decide: the fit on or off, the rig sun's shadow down or back. Cheap; runs on every input. */
export function evaluateShadowBudget() {
	const claim = claimInForce(get(shadowClaims));
	/** @type {any} */
	const r = get(globalRenderer);
	const playerView = get(isLocked) === true || !!r?.xr?.isPresenting;
	const wasActive = state.active;
	state.active = !!claim && playerView;
	state.radius = claim?.radius ?? 0;
	/** @type {any} */
	const scene = get(globalScene);
	const rigSun = scene?.getObjectByName?.(ENV_RIG_SUN) ?? null;
	const standDown = state.active && !!rigSun && authoredDirectionalCaster(get(objectsGroup));
	if (standDown && rigSun.castShadow) {
		rigSun.castShadow = false;
		state.rigStoodDown = rigSun;
	} else if (!standDown && state.rigStoodDown) {
		state.rigStoodDown.castShadow = true;
		state.rigStoodDown = null;
	}
	// the shadow cameras go back to their authored projection the frame the fit stops
	if (wasActive && !state.active) {
		scene?.traverse?.((/** @type {any} */ o) => {
			if (o.isDirectionalLight && o.shadow?.camera) o.shadow.camera.updateProjectionMatrix();
		});
	}
}

/** For the suites. */
export function shadowBudgetDebug() {
	return { active: state.active, radius: state.radius, rigStoodDown: !!state.rigStoodDown, patched };
}

let started = false;
/** Boot once (App.svelte, beside startLightParams). */
export function startShadowBudget() {
	if (started || typeof window === 'undefined') return;
	started = true;
	patchDirectionalShadows();
	shadowClaims.subscribe(evaluateShadowBudget);
	isLocked.subscribe(evaluateShadowBudget);
	objectsGroup.subscribe(evaluateShadowBudget);
	/** @type {any} */
	let hooked = null;
	globalRenderer.subscribe((/** @type {any} */ r) => {
		if (!r?.xr || r === hooked) return;
		hooked = r;
		r.xr.addEventListener?.('sessionstart', evaluateShadowBudget);
		r.xr.addEventListener?.('sessionend', evaluateShadowBudget);
		evaluateShadowBudget();
	});
}
