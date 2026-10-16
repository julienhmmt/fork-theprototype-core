// 47-cc0 — the Asset Browser's LEAF stores (svelte/store + safeStorage only), so the dock host,
// the menus and the window can all reach them without pulling the fetch/import code into the
// boot graph. Everything here is LOCAL: which tab, the search, the resolution — a fact about this
// screen, never replicated, saved or undone.
import { writable } from 'svelte/store';
import { safeStorage } from '../safeStorage';
import { CC0_KINDS, RESOLUTIONS, defaultResolution } from './cc0Core.js';

/** the window is open (the hosted-dock HOSTED table reads it) */
export const assetBrowserOpen = writable(false);

/** @param {string} key @param {string} fallback @param {string[]} allowed */
function persisted(key, fallback, allowed) {
	const raw = safeStorage.getItem(key);
	const store = writable(raw && allowed.includes(raw) ? raw : fallback);
	store.subscribe((v) => safeStorage.setItem(key, v));
	return store;
}

function deviceResolution() {
	if (typeof navigator === 'undefined' || typeof matchMedia === 'undefined') return '2k';
	return defaultResolution({
		headset: /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent ?? ''),
		coarse: matchMedia('(pointer: coarse)').matches,
		fine: matchMedia('(pointer: fine)').matches
	});
}

/** which tab: models | hdris | textures | materials */
export const assetBrowserKind = persisted(
	'assetBrowser:kind',
	'models',
	CC0_KINDS.map((k) => k.key)
);
/** the resolution pick — the device's default until the person picks one */
export const assetBrowserRes = persisted('assetBrowser:res', deviceResolution(), RESOLUTIONS);

/** open the window (menus, the Add menu, the Explorer) */
export function openAssetBrowser() {
	assetBrowserOpen.set(true);
}
