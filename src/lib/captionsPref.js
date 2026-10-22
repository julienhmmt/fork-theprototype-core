// 53 (A5) — the EDITOR's captions switch: Settings ▸ Accessibility ▸ Show captions. On = every caption
// line the app produces is drawn for this person everywhere — the editor too (a Timeline sequence
// previewed in Edit, a Sound node fired while authoring), not only in Play. It is the other way into
// the caption bus 53-play built (captions.js `captionsForced`); a player's own per-game Captions row
// (the game menu ▸ Accessibility) still works on its own. LOCAL to this device, default off.
//
// THE CAPTION FORMAT (owned by 53-scale; 53-play published it — QUESTIONS-53-play Q1):
//   · Timeline audio item: `caption?: string` (one line, ≤ 200 chars; ABSENT when unset, so a document
//     without captions is byte-identical) — shown while the clip plays, for the rest of its window
//     (clamped 1-15 s), source 'timeline';
//   · Sound node / Game Sound node: `data.caption` ('-' = never caption; a blank Game Sound says its
//     built-in default, e.g. "[coin]");
//   · modules: `api.captions.show(text, {seconds})`.
// Nothing replicates: every peer reaches the same producer itself; whether a line SHOWS is per person.
// A LEAF: svelte/store + safeStorage + captions (a leaf).
import { writable } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { captionsForced } from './captions';

export const EDITOR_CAPTIONS_KEY = 'ui:captions';

/** true = draw captions everywhere for this person */
export const editorCaptions = writable(safeStorage.getItem(EDITOR_CAPTIONS_KEY) === 'true');
editorCaptions.subscribe((on) => {
	captionsForced.set(!!on);
	if (on) safeStorage.setItem(EDITOR_CAPTIONS_KEY, 'true');
	else safeStorage.removeItem(EDITOR_CAPTIONS_KEY);
});
