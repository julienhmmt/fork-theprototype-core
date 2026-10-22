// 53-reader (A4) — WHAT A SCREEN READER HEARS. A LEAF (svelte/store only): two live-region
// texts that `LiveRegions.svelte` renders at the App root, the one `announce()` that writes
// them, and the pure helpers that decide WHAT is said and HOW loudly.
//
// Two regions, the ARIA split: POLITE (role=status) waits for the reader to finish — toasts,
// a selection; ASSERTIVE (role=alert) interrupts — an error. A region speaks on CHANGE, so the
// same words twice in a row are cleared first and written a moment later, or the second is
// silence.
//
// Scope is deliberately small (the user's 2026-10-21 trim): UI and selection only — no scene
// narration, no Play-mode announcements.
import { get, writable } from 'svelte/store';

export const politeAnnouncement = writable('');
export const assertiveAnnouncement = writable('');

/** ms between clearing a region and re-writing the same words */
export const REPEAT_GAP_MS = 60;

/** @type {Record<string, any>} */
const repeatTimers = {};

/**
 * Say something. Empty text says nothing.
 * @param {string} text @param {{assertive?: boolean}} [opts]
 */
export function announce(text, opts = {}) {
	const words = String(text ?? '').replace(/\s+/g, ' ').trim();
	if (!words) return;
	const key = opts.assertive ? 'assertive' : 'polite';
	const store = opts.assertive ? assertiveAnnouncement : politeAnnouncement;
	clearTimeout(repeatTimers[key]);
	if (get(store) !== words) {
		store.set(words);
		return;
	}
	store.set('');
	repeatTimers[key] = setTimeout(() => store.set(words), REPEAT_GAP_MS);
}

/**
 * An error is said ASSERTIVELY. Toasts carry no kind, so the words decide — the app's error
 * toasts all say so ("Could not …", "… failed", "Something went wrong: …").
 * @param {string} text
 */
export function isErrorText(text) {
	return /\b(fail(ed|s|ure)?|errors?|could ?n[o']t|cannot|can't|unable|refused|denied|invalid|went wrong|not allowed|crash(ed)?)\b/i.test(String(text ?? ''));
}

/** 'PointLight' -> 'point light', 'RoundedBox' -> 'rounded box' @param {string} s */
function words(s) {
	return s
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/_/g, ' ')
		.toLowerCase()
		.trim();
}

/**
 * What KIND of thing an object is, in words a person would use. Read off the object itself
 * (userData markers first, then three's type) — a leaf, so it may not reach geometryEdit.
 * @param {any} obj
 */
export function objectTypeLabel(obj) {
	if (!obj) return 'object';
	const u = obj.userData ?? {};
	if (u.camera) return 'camera';
	if (obj.isLight || /Light$/.test(obj.type ?? '')) return words(String(obj.type ?? 'light').replace(/Light$/, '')) + ' light';
	if (u.measure?.points) return 'measurement';
	if (u.spline) return 'spline';
	if (u.terrain) return 'terrain';
	if (u.water) return 'water';
	if (u.animatedClips) return 'animated model';
	if (u.packRef) return 'kit piece';
	if (/Group$/.test(obj.type ?? '')) return 'group';
	if (obj.isMesh || obj.isLine || obj.isPoints) {
		const g = u.geometryParams?.gtype ?? String(obj.geometry?.type ?? '').replace(/(Buffer)?Geometry$/, '');
		if (g) return words(g);
		return obj.children?.length ? 'model' : 'mesh';
	}
	return 'object';
}

/** @param {any} obj */
export function objectName(obj) {
	return String(obj?.name ?? '').trim() || 'Unnamed';
}

/**
 * The sentence a selection change is announced with: "<name>, <type>" for one object,
 * "<n> objects selected" for several, "Nothing selected" once the last one goes.
 * @param {any[]} objects the selected objects (resolved, in selection order)
 * @param {number} [was] how many were selected before
 */
export function selectionPhrase(objects, was = 0) {
	const list = objects.filter(Boolean);
	if (list.length === 0) return was > 0 ? 'Nothing selected' : '';
	if (list.length === 1) return `${objectName(list[0])}, ${objectTypeLabel(list[0])}`;
	return `${list.length} objects selected`;
}
