// 42 I1 — STICKY PANEL HEADERS, a LEAF (svelte/store + safeStorage).
//
// The user's words: "add additional pin button or implement somehow to stick/unstick/lock/unlock
// sticky header/name/'filter properties' … for 'configure scene'/'object properties' drawers, as it
// takes much space, but I want it to be configurable, enabled by default". The panel header (the
// title row + "Filter properties") either STICKS to the top of the panel while its properties
// scroll under it (the 38 R5 behaviour, still the default) or SCROLLS AWAY with them, giving the
// whole panel to the properties. One flag per PANEL — Configure Scene and Properties are separate
// panels and a person may want them different — the same on the phone's sheet / dock tab and the
// desktop sidebars, because the header component is one (InspectorHead).
//
// LOCAL like every chrome preference: saved on this device, never sent, never in a scene file.
// The header's own lock button flips its panel; Settings ▸ Interface ▸ "Sticky panel headers"
// sets both at once (and reads mixed when they differ).

import { writable, get } from 'svelte/store';
import { safeStorage } from './safeStorage';

const KEY = 'panels:stickyHeads';

/** the panels whose header can stick, in the order Settings lists them */
export const STICKY_PANELS = /** @type {const} */ (['scene', 'properties']);
/** @typedef {'scene'|'properties'} StickyPanel */

/** @returns {Record<StickyPanel, boolean>} */
function read() {
	/** @type {Record<StickyPanel, boolean>} */
	const out = { scene: true, properties: true };
	try {
		const raw = JSON.parse(safeStorage.getItem(KEY) || 'null');
		if (raw && typeof raw === 'object') for (const p of STICKY_PANELS) if (typeof raw[p] === 'boolean') out[p] = raw[p];
	} catch {
		/* a broken value is the default */
	}
	return out;
}

/** per panel: does its header stick (true, the default) or scroll away with the content */
export const stickyPanelHeads = writable(read());

let seen = false;
stickyPanelHeads.subscribe((v) => {
	// the first call is the value just read — nothing to write back
	if (!seen) {
		seen = true;
		return;
	}
	// write only what differs from the default, so an untouched device stores nothing
	if (STICKY_PANELS.every((p) => v[p] !== false)) safeStorage.removeItem(KEY);
	else safeStorage.setItem(KEY, JSON.stringify(v));
});

/** @param {StickyPanel} panel */
export function isStickyHead(panel) {
	return get(stickyPanelHeads)[panel] !== false;
}

/** the header's lock button @param {StickyPanel} panel */
export function toggleStickyHead(panel) {
	stickyPanelHeads.update((v) => ({ ...v, [panel]: v[panel] === false }));
}

/** Settings ▸ "Sticky panel headers": both panels at once @param {boolean} on */
export function setAllStickyHeads(on) {
	stickyPanelHeads.set({ scene: !!on, properties: !!on });
}
