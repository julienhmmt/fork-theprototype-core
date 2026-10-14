// 43 J9 — DISMISSIBLE TIPS. A tip is a one-line how-to the app shows until the person closes it
// with its ×; the dismissal is remembered on this device, and Settings ▸ Interface ▸ "Reset tips"
// brings every tip back (the "Reset tours" row's sibling). LOCAL: a tip is guidance for whoever is
// holding this screen, so it never replicates, never saves into a scene and never undoes.
//
// A leaf (svelte/store + safeStorage). The first tip is the phone More sheet's "Hold and drag items
// to or from the bar"; a new tip is a new id, nothing else.
import { writable, derived } from 'svelte/store';
import { safeStorage } from './safeStorage';

const KEY = 'tipsDismissed';

/** @returns {string[]} */
function read() {
	try {
		const v = JSON.parse(safeStorage.getItem(KEY) ?? '[]');
		return Array.isArray(v) ? v.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** the ids of every tip closed on this device */
export const dismissedTips = writable(/** @type {string[]} */ (read()));
dismissedTips.subscribe((ids) => {
	if (ids.length) safeStorage.setItem(KEY, JSON.stringify(ids));
	else safeStorage.removeItem(KEY);
});

/** close a tip for good (until Reset tips) @param {string} id */
export function dismissTip(id) {
	dismissedTips.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
}

/** a store that reads true while the tip should show @param {string} id */
export function tipShown(id) {
	return derived(dismissedTips, (ids) => !ids.includes(id));
}

/** Settings ▸ Reset tips: every closed tip shows again */
export function resetTips() {
	dismissedTips.set([]);
}

/** the phone More sheet's drag how-to */
export const TIP_PHONE_MORE = 'phone-more-drag';
