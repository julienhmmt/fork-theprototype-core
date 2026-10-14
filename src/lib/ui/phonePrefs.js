// 42 I5 — THE THREE PHONE CHROME SWITCHES at the bottom of More (and in Settings ▸ Interface):
//   Selection toolbar  the floating Move / Rotate / Scale / Inspect strip over a selection — off
//                      when those tools already sit on the bar ("I do not really need these tools
//                      popup");
//   Dock tab row       the row of docked-window tabs (and its + / minimize chrome) above the dock —
//                      off frees that row; the bar and More still switch views;
//   Grab handle        the visible grab bar of the dock and every phone sheet — off removes the pill
//                      (and its tap-to-full / back), while the invisible edge drag still resizes.
// All three default ON (today's phone). LOCAL per-device prefs in safeStorage, absent = on, never
// replicated or saved into a scene. A leaf (svelte/store + safeStorage) so the kit's SheetGrip can
// read the grab-handle switch without importing the shell (uiLayoutsCore is a leaf too).
import { writable } from 'svelte/store';
import { safeStorage } from '../safeStorage';
import { onLayoutRestore } from '../uiLayoutsCore';

/** @param {string} key */
function onByDefault(key) {
	/** @type {boolean} */
	let initial = true;
	try {
		initial = typeof localStorage === 'undefined' ? true : safeStorage.getItem(key) !== '0';
	} catch {
		// private mode: on
	}
	const store = writable(initial);
	// 42 I8: the switches ride a workspace layout's phone profile (uiLayoutsCore CHROME_KEYS)
	if (typeof localStorage !== 'undefined') onLayoutRestore(() => store.set(safeStorage.getItem(key) !== '0'));
	store.subscribe((on) => {
		try {
			if (on) safeStorage.removeItem(key);
			else safeStorage.setItem(key, '0');
		} catch {
			// private mode: the switch still holds for this session
		}
	});
	return store;
}

export const SELECTION_STRIP_KEY = 'phoneSelectionStrip';
export const DOCK_TABS_KEY = 'phoneDockTabs';
export const GRAB_HANDLE_KEY = 'phoneGrabHandle';

/** show the floating selection strip while something is selected (phone) */
export const phoneSelectionStrip = onByDefault(SELECTION_STRIP_KEY);
/** show the docked-window tab row above the dock (phone) */
export const phoneDockTabs = onByDefault(DOCK_TABS_KEY);
/** show the grab bars of the dock and the phone sheets (the edge still resizes without them) */
export const phoneGrabHandle = onByDefault(GRAB_HANDLE_KEY);
