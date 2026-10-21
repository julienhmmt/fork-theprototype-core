// 53 (A7) — the VR comfort rows the game menu's Accessibility page shows in a HEADSET (Comfort
// vignette, Stance, One-handed, Recenter). They are DEVICE settings (vr/settingsSchema.js, the one
// VR settings table); this import-free slot lets the VR settings code hand them to the game board
// (vrGamePanel) without either importing the other — both sit in large import families.

/** @typedef {{rows: () => {id: string, label: string, type: string, value: any, display: string}[], press: (id: string, dir: number) => boolean}} ShellVrRows */

/** @type {ShellVrRows | null} */
let provider = null;

/** the VR settings code registers the rows once @param {ShellVrRows | null} p */
export function setShellVrRows(p) {
	provider = p;
}

/** @returns {ShellVrRows | null} */
export function shellVrRows() {
	return provider;
}
