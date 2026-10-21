// 53 (A1) — the UI SCALE setting (Settings ▸ Accessibility): 90-150 % in 10 % steps, default 100 %,
// saved per DEVICE (LOCAL, like Theme and Density — it is about this screen and these eyes).
//
// THE MECHANISM is one custom property, `--ui-scale` on <html>: scripts/a11y-css.cjs rewrites
// every CSS px length into `calc(Npx * var(--ui-scale, 1))` at build time and tokens.css scales the
// root font size, so every rem follows. Nothing here touches the 3D canvas — it is sized by its
// container, and its drawing buffer by the device pixel ratio.
// app.html applies the saved value before first paint (the theme precedent), so a 150 % user never
// sees a 100 % frame; this module takes over after.
//
// A LEAF: svelte/store + safeStorage + uiLayoutsCore (a leaf).
//
// PANEL SIZES THAT JS OWNS. A sidebar column, the bottom dock and every resizable window keep their
// size in storage as plain px — so at 150 % their content would be scaled and the box not. Two rules
// keep them in step: the owners' DEFAULTS and minimums are multiplied by `uiScaleFactor()` (a fresh
// device at 150 % opens a 480 px column, not a 320 px one), and CHANGING the scale multiplies every
// stored panel size by new/old and asks the live panels to re-read it — the workspace-layout re-read
// (`runLayoutReloaders`), which every geometry owner already answers.
import { writable, get } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { isLayoutKey, runLayoutReloaders } from './uiLayoutsCore';

export const UI_SCALE_KEY = 'ui:scale';
export const UI_SCALE_MIN = 90;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 10;
export const DEFAULT_UI_SCALE = 100;
/** from here up <html data-ui-large> is set (applyUiScale) */
export const LARGE_UI_SCALE = 120;

/** 90, 100, … 150 */
export const UI_SCALES = Array.from({ length: (UI_SCALE_MAX - UI_SCALE_MIN) / UI_SCALE_STEP + 1 }, (_, i) => UI_SCALE_MIN + i * UI_SCALE_STEP);

/**
 * Any stored / typed value → the nearest allowed step (a garbage value reads as the default).
 * @param {unknown} v @returns {number}
 */
export function normalizeUiScale(v) {
	const n = typeof v === 'string' ? parseFloat(v) : Number(v);
	if (!Number.isFinite(n)) return DEFAULT_UI_SCALE;
	const stepped = Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP;
	return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped));
}

/**
 * Put a percentage on the page. 100 % REMOVES the property, so the default page carries no inline
 * style at all (the `var(--ui-scale, 1)` fallbacks take over).
 * @param {number} percent @param {HTMLElement} [root]
 */
export function applyUiScale(percent, root = document.documentElement) {
	const p = normalizeUiScale(percent);
	if (p === DEFAULT_UI_SCALE) root.style.removeProperty('--ui-scale');
	else root.style.setProperty('--ui-scale', String(p / 100));
	// 120 % and up: the few layouts that need a different SHAPE (not just size) at a large scale on a
	// phone — a PropRow's segmented control goes under its label — key off this attribute
	if (p >= LARGE_UI_SCALE) root.dataset.uiLarge = '';
	else delete root.dataset.uiLarge;
}

/** the percentage, 90…150 */
export const uiScale = writable(normalizeUiScale(safeStorage.getItem(UI_SCALE_KEY) ?? DEFAULT_UI_SCALE));

/** the value last applied (the first subscriber call is the boot read, not a change) @type {number|null} */
let applied = null;

uiScale.subscribe((v) => {
	const p = normalizeUiScale(v);
	if (typeof document !== 'undefined') applyUiScale(p);
	const was = applied;
	applied = p;
	if (was != null && was !== p) {
		rescaleStoredSizes(p / was);
		runLayoutReloaders();
	}
	// the default is an ABSENT key, so a fresh device and a reset read the same
	if (p === DEFAULT_UI_SCALE) safeStorage.removeItem(UI_SCALE_KEY);
	else safeStorage.setItem(UI_SCALE_KEY, String(p));
});

/** the live factor (1 at 100 %) */
export function uiScaleFactor() {
	return normalizeUiScale(get(uiScale)) / 100;
}

/** a design-px default or minimum at the current scale @param {number} px */
export function scaledPx(px) {
	return Math.round(px * uiScaleFactor());
}

/** stored numbers that are a panel SIZE (never a position, a fraction or a flag) */
const SIZE_KEY = /(WinW|WinH|Width|Height|TreeW)$|^(sidebarWidth|dockWidth):/;
const SIZE_FIELDS = ['w', 'h', 'width', 'height'];

/**
 * Multiply one stored layout value's sizes by `ratio` (positions are left for the owners' own
 * on-screen clamps). Returns null when the value holds no size.
 * @param {string} key @param {string} value @param {number} ratio @returns {string | null}
 */
export function rescaleStoredValue(key, value, ratio) {
	if (typeof value !== 'string' || !value) return null;
	if (value[0] === '{') {
		try {
			const o = JSON.parse(value);
			if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
			let changed = false;
			for (const f of SIZE_FIELDS)
				if (typeof o[f] === 'number' && Number.isFinite(o[f])) {
					o[f] = Math.round(o[f] * ratio);
					changed = true;
				}
			return changed ? JSON.stringify(o) : null;
		} catch {
			return null;
		}
	}
	if (!SIZE_KEY.test(key)) return null;
	const n = parseFloat(value);
	return Number.isFinite(n) && /^\s*-?[\d.]+\s*$/.test(value) ? String(Math.round(n * ratio)) : null;
}

/** every stored workspace-layout size × ratio @param {number} ratio */
export function rescaleStoredSizes(ratio) {
	if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return 0;
	let n = 0;
	for (const key of safeStorage.keys()) {
		if (!isLayoutKey(key)) continue;
		const next = rescaleStoredValue(key, safeStorage.getItem(key) ?? '', ratio);
		if (next != null) {
			safeStorage.setItem(key, next);
			n++;
		}
	}
	return n;
}

/**
 * A px length as CSS hands it back. A token written `--hud-cell: 38px` in a stylesheet computes to
 * `calc(38px * 1.5)` once the transform has run, which parseFloat reads as NaN — this resolves
 * `Npx`, `calc(Npx * k)` and the unscaled `calc(Npx * var(--ui-scale, 1))` form. Anything else
 * falls back to parseFloat (so a JS-set `--bottom-inset: 312px` still reads 312).
 * @param {string | null | undefined} value @returns {number}
 */
export function cssPx(value) {
	const s = String(value ?? '').trim();
	if (!s) return NaN;
	const calc = /^calc\(\s*(-?[\d.]+)px\s*\*\s*(?:(-?[\d.]+)|var\(--ui-scale(?:,\s*([\d.]+))?\))\s*\)$/.exec(s);
	if (calc) {
		const k = calc[2] != null ? Number(calc[2]) : uiScaleFactor();
		return Number(calc[1]) * k;
	}
	if (/^calc\(/.test(s) && typeof document !== 'undefined') {
		// a compound expression (`calc(76px * 1.5 + env(...))`): let the browser resolve it
		const probe = document.createElement('div');
		probe.style.cssText = `position:absolute;visibility:hidden;width:${s}`;
		document.body.appendChild(probe);
		const w = probe.getBoundingClientRect().width;
		probe.remove();
		return w;
	}
	return parseFloat(s);
}
