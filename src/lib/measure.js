import * as THREE from 'three';
import { writable, get } from 'svelte/store';
import { showToast } from '../stores/appStore';
import { globalCamera, globalRenderer } from '../stores/sceneStore';
import { viewportHasKeys } from './keyScope'; // 36 U11
import { safeStorage } from './safeStorage';
import { findSnapCandidate, activeSnapCandidate } from './snapEngine';
import { sceneHits } from './scenePick';

// The Measure tool. LOCAL ONLY: a measurement is a personal inspection aid, so nothing here
// replicates, saves or undoes (the user's 47 decision — pinned dimensions are per user).
//
// 47 M1: a measurement is a CHAIN of points (click, click, click …) with a length per segment,
// the angle at every joint and a running total; the arithmetic is the `measureCore` leaf. Each
// click SNAPS through the snap engine's own candidate search — vertex / edge / face / surface —
// with this tool's flags laid over the drag snapping's (which ship all OFF), so measuring a box
// corner to corner reads the box's size and not wherever the cursor happened to land. Enter /
// Pin keeps the chain on screen as a dimension label set; the next click starts a fresh chain.

export const measureMode = writable(false);
/** the chain being drawn: world points + what each one snapped to ('' = a raw hit)
 * @type {import('svelte/store').Writable<{points: number[][], snaps: string[]} | null>} */
export const measurement = writable(null);
/** pinned chains — they stay in the viewport when the tool closes, until Clear measurements
 * @type {import('svelte/store').Writable<{id: string, points: number[][]}[]>} */
export const pinnedMeasurements = writable([]);
/** where the next click would land (desktop hover; null on touch / off the canvas)
 * @type {import('svelte/store').Writable<{point: number[], snap: string} | null>} */
export const measureHover = writable(null);
/** LOCAL pref: snap measure clicks to vertices / edges / faces (default on) */
export const measureSnap = writable(readSnapPref());

function readSnapPref() {
	try {
		return typeof localStorage === 'undefined' || safeStorage.getItem('measure:snap') !== 'false';
	} catch {
		return true;
	}
}
measureSnap.subscribe((on) => {
	try {
		if (typeof localStorage !== 'undefined') safeStorage.setItem('measure:snap', String(on));
	} catch {
		/* private window: the pref simply does not persist */
	}
});

/** the measure tool's own snap flags (the drag snapping's prefs are left alone). No `surface`
 * candidate: the raw hit under the ray IS the fallback, and as a candidate at 0 px it would beat
 * a corner a few pixels away. */
const MEASURE_TARGETS = { vertex: true, edge: true, face: true, surface: false, object: false };
/** a corner wins from anywhere inside the radius; an edge over a face centre */
const MEASURE_BIAS = { vertex: -16, edge: -6, face: -2 };
/** screen radius a candidate may sit from the pointer — a fingertip covers more than a cursor */
const RADIUS_MOUSE = 18;
const RADIUS_TOUCH = 36;
const HOVER_INTERVAL_MS = 33;
/** a second click this soon and this close pins the chain (the spline tool's double click) */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 6;

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const planePoint = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
let lastHoverAt = 0;
let lastClick = { at: 0, px: [0, 0] };
let pinSeq = 0;

export function toggleMeasure() {
	if (get(measureMode)) stopMeasure();
	else startMeasure();
}

export function startMeasure() {
	if (get(measureMode)) return;
	measureMode.set(true);
	measurement.set(null);
	showToast('Measure: click points — Enter pins, Backspace removes the last, Esc stops');
	window.addEventListener('keydown', onKeydown);
}

export function stopMeasure() {
	if (!get(measureMode)) return;
	measureMode.set(false);
	measurement.set(null); // an unpinned chain goes with the tool; pinned ones stay
	measureHover.set(null);
	activeSnapCandidate.set(null);
	window.removeEventListener('keydown', onKeydown);
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
	if (!viewportHasKeys(event)) return; // 36 U11: Esc in another pane is that pane's
	if (event.key === 'Escape') stopMeasure();
	else if (event.key === 'Enter') {
		event.preventDefault();
		pinMeasurement();
	} else if (event.key === 'Backspace') {
		event.preventDefault();
		undoMeasurePoint();
	}
}

/** client px -> NDC against the renderer canvas, or null @param {number[]} clientPx */
function ndcOf(clientPx) {
	/** @type {any} */
	const renderer = get(globalRenderer);
	const rect = renderer?.domElement?.getBoundingClientRect?.();
	if (!rect || !rect.width || !rect.height) return null;
	return [((clientPx[0] - rect.left) / rect.width) * 2 - 1, -((clientPx[1] - rect.top) / rect.height) * 2 + 1];
}

/**
 * Where a click at `clientPx` measures from: the best snap candidate within reach, else the
 * object surface under the ray, else the ground plane.
 * @param {THREE.Raycaster|null} raycaster aimed through the pointer (built here when null)
 * @param {number[]|null} clientPx @param {{touch?: boolean, publish?: boolean}} [opts]
 * @returns {{point: number[], snap: string} | null}
 */
export function resolveMeasurePoint(raycaster, clientPx, opts = {}) {
	const camera = get(globalCamera);
	const ndc = clientPx ? ndcOf(clientPx) : null;
	if (!raycaster) {
		if (!camera || !ndc) return null;
		_ndc.set(ndc[0], ndc[1]);
		_raycaster.setFromCamera(_ndc, /** @type {any} */ (camera));
		raycaster = _raycaster;
	}
	if (get(measureSnap) && camera && ndc) {
		const radiusPx = opts.touch ? RADIUS_TOUCH : RADIUS_MOUSE;
		const before = get(activeSnapCandidate);
		/** @type {any} the scored candidate (scoreCandidates' JSDoc names only the fields it reads) */
		const candidate = findSnapCandidate(camera, ndc, [], { targets: { ...MEASURE_TARGETS, radiusPx }, bias: MEASURE_BIAS });
		// the search publishes its marker; a click resolves silently and leaves the hover's
		if (opts.publish === false && get(activeSnapCandidate) !== before) activeSnapCandidate.set(before);
		if (candidate?.point) return { point: candidate.point.toArray(), snap: candidate.type };
	}
	const hit = sceneHits(raycaster)[0];
	if (hit) return { point: hit.point.toArray(), snap: '' };
	if (raycaster.ray.intersectPlane(groundPlane, planePoint)) return { point: planePoint.toArray(), snap: 'ground' };
	return null;
}

/**
 * A viewport click (or tap) while measuring: add a point to the chain. A quick second click on
 * the same spot pins the chain instead (the spline tool's double click).
 * @param {THREE.Raycaster} raycaster @param {any} _group unused (kept for the Scene call)
 * @param {number[]} [clientPx] @param {{touch?: boolean}} [opts]
 */
export function measureClick(raycaster, _group, clientPx, opts = {}) {
	const now = performance.now();
	if (clientPx && now - lastClick.at < DOUBLE_CLICK_MS &&
		Math.hypot(clientPx[0] - lastClick.px[0], clientPx[1] - lastClick.px[1]) < DOUBLE_CLICK_PX &&
		(get(measurement)?.points.length ?? 0) >= 2) {
		lastClick = { at: 0, px: [0, 0] };
		pinMeasurement();
		return;
	}
	if (clientPx) lastClick = { at: now, px: [clientPx[0], clientPx[1]] };
	const hit = resolveMeasurePoint(raycaster, clientPx ?? null, { touch: opts.touch, publish: false });
	if (!hit) return;
	addMeasurePoint(hit.point, hit.snap);
}

/** @param {number[]} point @param {string} [snap] */
export function addMeasurePoint(point, snap = '') {
	measurement.update((current) => ({
		points: [...(current?.points ?? []), [point[0], point[1], point[2]]],
		snaps: [...(current?.snaps ?? []), snap]
	}));
}

/** desktop hover: where the next click would land (throttled; publishes the snap marker)
 * @param {number[]} clientPx @param {boolean} onCanvas */
export function measureHoverAt(clientPx, onCanvas) {
	if (!get(measureMode)) return;
	if (!onCanvas) {
		if (get(measureHover)) measureHover.set(null);
		if (get(activeSnapCandidate)) activeSnapCandidate.set(null);
		return;
	}
	const now = performance.now();
	if (now - lastHoverAt < HOVER_INTERVAL_MS) return;
	lastHoverAt = now;
	measureHover.set(resolveMeasurePoint(null, clientPx));
}

export function undoMeasurePoint() {
	measurement.update((current) => {
		if (!current || current.points.length <= 1) return null;
		return { points: current.points.slice(0, -1), snaps: current.snaps.slice(0, -1) };
	});
}

/** Keep the current chain on screen as a dimension label set, and start a fresh one.
 * @returns {boolean} whether there was a chain (2+ points) to pin */
export function pinMeasurement() {
	const current = get(measurement);
	if (!current || current.points.length < 2) {
		showToast('Measure: click two points first, then pin');
		return false;
	}
	pinSeq += 1;
	const id = `pin${Date.now().toString(36)}${pinSeq}`;
	pinnedMeasurements.update((list) => [...list, { id, points: current.points.map((p) => [...p]) }]);
	measurement.set(null);
	return true;
}

/** "Clear measurements": every pinned chain and the one being drawn */
export function clearMeasurements() {
	pinnedMeasurements.set([]);
	measurement.set(null);
}

/** @param {string} id */
export function removePinnedMeasurement(id) {
	pinnedMeasurements.update((list) => list.filter((m) => m.id !== id));
}

/** label screen positions, published by MeasureOverlay from threlte's RENDER stage (a private
 * rAF projects last frame's camera — the note-marker jiggle) and drawn by MeasureLabels
 * @type {import('svelte/store').Writable<{key: string, kind: string, text: string, x: number, y: number, pinned: boolean}[]>} */
export const measureLabelViews = writable([]);
