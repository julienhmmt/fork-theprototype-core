// 53 (A5) — REDUCED MOTION. Settings ▸ Accessibility ▸ Motion: 'system' (follow the OS
// `prefers-reduced-motion`, the default) · 'reduce' · 'full'. LOCAL to this device.
//
// The resolved answer is ONE attribute, `data-motion="reduce" | "full"` on <html> (app.html sets it
// before first paint; this module keeps it current as the OS setting or the choice changes):
//   · styles/motion.css makes every CSS animation and transition instant under it;
//   · the build transform (scripts/a11y-css.cjs) re-keys the app's own
//     `@media (prefers-reduced-motion: reduce)` blocks onto it, so "Full" really is full motion on a
//     reduced-motion OS and "Reduce" works on one that is not;
//   · JS motion asks `motionMs(ms)` — Svelte transitions (toasts, the docked panels, the Connect
//     drawer) run on Web Animations that CSS cannot reach, and the camera fly-to is a rAF tween.
// A LEAF: svelte/store + safeStorage.
import { writable, readable, derived, get } from 'svelte/store';
import { safeStorage } from './safeStorage';

export const MOTION_KEY = 'ui:motion';
export const MOTION_PREFS = [
	{ value: 'system', label: 'Follow system' },
	{ value: 'reduce', label: 'Reduce' },
	{ value: 'full', label: 'Full' }
];
export const DEFAULT_MOTION = 'system';

/** @param {unknown} v @returns {'system' | 'reduce' | 'full'} */
export function normalizeMotion(v) {
	return v === 'reduce' || v === 'full' ? v : 'system';
}

/** 'system' | 'reduce' | 'full' */
export const motionPref = writable(normalizeMotion(safeStorage.getItem(MOTION_KEY)));
motionPref.subscribe((v) => {
	const value = normalizeMotion(v);
	if (value === DEFAULT_MOTION) safeStorage.removeItem(MOTION_KEY);
	else safeStorage.setItem(MOTION_KEY, value);
});

/** the OS asks for reduced motion */
export const systemReducedMotion = readable(false, (set) => {
	if (typeof window === 'undefined' || !window.matchMedia) return;
	const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
	set(mq.matches);
	const on = () => set(mq.matches);
	mq.addEventListener?.('change', on);
	return () => mq.removeEventListener?.('change', on);
});

/**
 * The resolved answer for a pref and the OS setting (pure — the suites and the unit test use it).
 * @param {string} pref @param {boolean} system @returns {boolean}
 */
export function resolveReducedMotion(pref, system) {
	const p = normalizeMotion(pref);
	return p === 'reduce' || (p === 'system' && !!system);
}

/** true = make motion instant */
export const reducedMotion = derived([motionPref, systemReducedMotion], ([$p, $s]) => resolveReducedMotion($p, $s));

reducedMotion.subscribe((reduce) => {
	if (typeof document !== 'undefined') document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
});

/**
 * A JS animation's duration under the current motion setting: 0 when reduced.
 * @param {number} ms @returns {number}
 */
export function motionMs(ms) {
	return get(reducedMotion) ? 0 : ms;
}
