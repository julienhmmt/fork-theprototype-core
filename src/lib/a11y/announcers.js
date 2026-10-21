// 53-reader (A4) — the WIRING behind the live regions: which app events are spoken. Kept out
// of the `announce` leaf because it reads the app stores.
//
// - every NEW toast (the shared stack, id'd cards updated in place included) is read POLITELY,
//   an error toast ASSERTIVELY — even when the viewport pop-ups are hidden (toastsInDrawerOnly),
//   because a hidden card is exactly the one a sighted user would still find in the drawer;
// - a connection request is read politely;
// - a selection change is read as "<name>, <type>" — coalesced, so a marquee or a Ctrl+A that
//   writes the set several times in one gesture is ONE sentence.
import { get } from 'svelte/store';
import { toastStore, pendingApprovals } from '../../stores/appStore';
import { selectedObjects, objectsGroup } from '../../stores/sceneStore';
import { announce, isErrorText, selectionPhrase } from './announce';

/** a burst of selection writes inside this window is one announcement */
export const SELECTION_SETTLE_MS = 120;

/** @param {any} entry */
function toastText(entry) {
	if (typeof entry === 'string') return entry;
	return String(entry?.text ?? '');
}

/** @param {string[]} uuids */
function resolve(uuids) {
	const group = get(objectsGroup);
	/** @type {any} */
	const g = group;
	if (!g?.getObjectByProperty) return [];
	return uuids.map((u) => g.getObjectByProperty('uuid', u)).filter(Boolean);
}

/** Start every announcer; returns the stop function. */
export function startAnnouncers() {
	/** @type {(() => void)[]} */
	const offs = [];

	// ---- toasts ------------------------------------------------------------------------------
	/** @type {any[]} */
	let prevToasts = get(toastStore) ?? [];
	offs.push(
		toastStore.subscribe((list) => {
			const next = Array.isArray(list) ? list : [];
			for (const entry of next) {
				// a plain string stays the same string while it is up (showToast dedupes it); an
				// object is new whenever it is a new object — an id'd card updated in place is
				if (prevToasts.includes(entry)) continue;
				const text = toastText(entry);
				if (text) announce(text, { assertive: isErrorText(text) });
			}
			prevToasts = next;
		})
	);

	// ---- connection requests -----------------------------------------------------------------
	/** @type {Set<string>} */
	let seenPeers = new Set((get(pendingApprovals) ?? []).map((/** @type {any} */ a) => String(a?.peerId)));
	offs.push(
		pendingApprovals.subscribe((list) => {
			const now = new Set();
			for (const a of /** @type {any[]} */ (list ?? [])) {
				const id = String(a?.peerId);
				now.add(id);
				if (!seenPeers.has(id)) announce(`Connection request ${id.slice(0, 6).toUpperCase()}${a?.label ? ', ' + a.label : ''}`);
			}
			seenPeers = now;
		})
	);

	// ---- selection ---------------------------------------------------------------------------
	let lastKey = (get(selectedObjects) ?? []).join(',');
	let lastCount = (get(selectedObjects) ?? []).length;
	/** @type {any} */
	let timer = null;
	offs.push(
		selectedObjects.subscribe(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const uuids = get(selectedObjects) ?? [];
				const key = uuids.join(',');
				if (key === lastKey) return;
				const phrase = selectionPhrase(resolve(uuids), lastCount);
				lastKey = key;
				lastCount = uuids.length;
				if (phrase) announce(phrase);
			}, SELECTION_SETTLE_MS);
		})
	);
	offs.push(() => clearTimeout(timer));

	return () => offs.forEach((off) => off());
}
