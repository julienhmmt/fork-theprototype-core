// 44 M14 — WHERE THE CONNECT PILL LIVES: pinned to the top row, or floating. A leaf (svelte/store +
// safeStorage + the layouts registry, which imports nothing).
//
// The user: "on unfolded phone connect.svelte sticks to the top by default (this is good, but I also want to
// be able to unstick it …) allow this also to be done for desktop mode". The decision (roadmap 44): a per-SHELL
// toggle in the Connect drawer ("Pin to top row" / "Float") — pinned by default on the unfolded phone, floating
// on desktop, as before. PINNED = the full-width bar along the top edge (the corner chrome drops below it).
// FLOATING = the centred pill; when the top row has no room for it, it COLLAPSES to its compact form (status dot +
// chevron) instead of jumping to its own row, and expands again when room returns (Connect.svelte).
//
// "Shell" is the pointer, read once: a touch screen wide enough for the desktop chrome is the unfolded phone (the
// folded phone draws its own shell, where Connect is a chip and a sheet — this setting does not apply there).
// Each shell keeps its own answer, so a phone's pin never moves the desktop's pill. Both keys are layout chrome
// (`addChromeKeys`): a saved layout carries them and applying one restores them.

import { writable, get } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { addChromeKeys, onLayoutRestore } from './uiLayoutsCore';

/** @typedef {'touch' | 'desktop'} PinShell */
export const PIN_KEYS = { touch: 'connect:pin:touch', desktop: 'connect:pin:desktop' };
addChromeKeys('desktop', [PIN_KEYS.touch, PIN_KEYS.desktop]);

/** @returns {PinShell} */
export function pinShell() {
	if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
	return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop';
}

/** the default per shell: pinned on the (unfolded) phone, floating on desktop @param {PinShell} shell */
export const defaultPinned = (shell) => shell === 'touch';

/** read the stored answer ('pinned' | 'float'; anything else = the shell's default) @param {PinShell} shell */
export function readPinned(shell) {
	const v = safeStorage.getItem(PIN_KEYS[shell]);
	return v === 'pinned' ? true : v === 'float' ? false : defaultPinned(shell);
}

const shell = pinShell();
/** this screen's answer: true = pinned to the top row */
export const connectPinned = writable(readPinned(shell));
let reading = false;
connectPinned.subscribe((v) => {
	if (reading) return;
	// the default is not written: an untouched shell keeps following the default
	if (v === readPinned(shell) && safeStorage.getItem(PIN_KEYS[shell]) == null) return;
	safeStorage.setItem(PIN_KEYS[shell], v ? 'pinned' : 'float');
});
// a layout applied re-reads it (an absent key = the default again)
onLayoutRestore(() => {
	reading = true;
	connectPinned.set(readPinned(shell));
	reading = false;
});

/** flip it @param {boolean} [v] */
export function setConnectPinned(v) {
	connectPinned.set(v ?? !get(connectPinned));
}
