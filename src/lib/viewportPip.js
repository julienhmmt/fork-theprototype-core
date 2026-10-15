import { writable, get } from 'svelte/store';
import * as THREE from 'three';
import { objectsGroup, selectedObjects } from '../stores/sceneStore';
import { safeStorage } from './safeStorage';

// 43 K5 — THE VIEWPORT PiP. While a docked window is maximized to the FULL window (focus mode
// 'dock' at full height, $lib/focusMode) the 3D view is covered, so it comes back as a
// picture-in-picture: bottom-right, resizable by its corner, closable, above the docked window. It
// is a SECOND VIEW of the live scene — the same renderer and scene ($lib/pipViews), its OWN camera
// and controls — never a snapshot. The window is ViewportPip.svelte; this leaf holds its state so
// the suites and the keymap reach it without importing a component.
//
// Size is remembered (LOCAL, persisted); position and "closed" last for the focus session: the
// next maximize parks it bottom-right again and shows it again, the way the camera preview comes
// back with its camera.

const KEY = 'viewportPip:size';
export const VIEWPORT_PIP_MIN_H = 120;
const DEFAULT = { w: 400, h: 225 };

/** @returns {{w: number, h: number}} */
function readSize() {
	try {
		const v = JSON.parse(safeStorage.getItem(KEY) || 'null');
		if (v && Number.isFinite(v.w) && Number.isFinite(v.h) && v.h >= VIEWPORT_PIP_MIN_H) return { w: v.w, h: v.h };
	} catch {
		/* a bad record is the default */
	}
	return { ...DEFAULT };
}

/** the window's size, CSS px (LOCAL, persisted) */
export const viewportPipSize = writable(readSize());
viewportPipSize.subscribe((v) => {
	// safeStorage never throws: in private mode the size lives for the session
	safeStorage.setItem(KEY, JSON.stringify({ w: Math.round(v.w), h: Math.round(v.h) }));
});

/** back to the default size (the grip's double-click) */
export function resetViewportPipSize() {
	viewportPipSize.set({ ...DEFAULT });
}

/** where the user dragged it this session (null = parked bottom-right)
 * @type {import('svelte/store').Writable<{x: number, y: number} | null>} */
export const viewportPipPosition = writable(null);

/** closed for this focus session */
export const viewportPipClosed = writable(false);

/** the PiP's own camera + controls while it is open (the window publishes them; the keymap's PiP
 *  scope and the suites read them) @type {import('svelte/store').Writable<{camera: any, controls: any} | null>} */
export const viewportPipView = writable(null);

/** is the viewport PiP up (the keymap's `pip` rows ask) */
export function viewportPipOpen() {
	return !!get(viewportPipView);
}

/**
 * F inside the PiP: frame the selection with the PiP's OWN camera (the editor camera stays put) —
 * same rule as the viewport's F: keep the viewing direction, fit the selection's bounds.
 * @returns {boolean} false when nothing was framed
 */
export function framePipSelection() {
	const view = get(viewportPipView);
	const group = /** @type {any} */ (get(objectsGroup));
	const uuids = get(selectedObjects) ?? [];
	if (!view || !group || !uuids.length) return false;
	const box = new THREE.Box3();
	for (const uuid of uuids) {
		const object = group.getObjectByProperty('uuid', uuid);
		if (object) box.expandByObject(object);
	}
	if (box.isEmpty()) return false;
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const { camera, controls } = view;
	const fov = THREE.MathUtils.degToRad(camera.fov || 50);
	const distance = THREE.MathUtils.clamp((Math.max(sphere.radius, 0.05) / Math.sin(fov / 2)) * 1.1, 0.5, 500);
	const direction = camera.position.clone().sub(controls?.target ?? sphere.center).normalize();
	if (!Number.isFinite(direction.x) || direction.lengthSq() < 1e-6) direction.set(0, 0.5, 1).normalize();
	camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
	controls?.target.copy(sphere.center);
	camera.lookAt(sphere.center);
	controls?.update();
	return true;
}

/** a new focus session: parked, shown */
export function resetViewportPipSession() {
	viewportPipPosition.set(null);
	viewportPipClosed.set(false);
}

/** test/debug view */
export function viewportPipDebug() {
	const view = get(viewportPipView);
	const el = typeof document !== 'undefined' ? document.getElementById('viewport-pip') : null;
	const r = el?.getBoundingClientRect();
	return {
		open: !!el,
		rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
		size: get(viewportPipSize),
		closed: get(viewportPipClosed),
		camera: view ? { position: view.camera.position.toArray(), quaternion: view.camera.quaternion.toArray(), target: view.controls?.target?.toArray?.() ?? null } : null
	};
}
