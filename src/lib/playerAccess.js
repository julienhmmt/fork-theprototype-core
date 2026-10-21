// 53 (A6) — THE PLAYER'S ACCESSIBILITY SETTINGS: captions, a colour filter, HUD text size and
// control remapping, for the person PLAYING a game made here (Play, play links, embeds, exports).
//
// PER PLAYER PER GAME, LOCAL: the game is gameSettings' `gameId` (the scene file's slug), the
// values sit in ONE safeStorage key `tp:game:<id>:access`, and nothing here is replicated, saved
// into a scene or undone — my captions and my colour filter are about MY eyes and ears (the
// gameSettings rule). A game this player has never set takes their LAST choices
// (`tp:access:last`) for every row but the remap, so a colour-blind player does not re-pick the
// filter in every game; key remaps are the game's own keys and never carry over.
//
// The remap table maps the GAME's code to the PLAYER's (playerAccessCore). It is applied at the
// ONE input channel (inputRuntime: Key Press, Gamepad Button, Move Input, the Character
// Controller's code, every module's onInput/getInput) and in PointerLockControls' own walker
// keys, so every consumer reads it without knowing it exists.
//
// A LEAF: svelte/store + safeStorage + gameSettings (itself a leaf) + the pure core.
import { writable, get } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { gameId } from './gameSettings';
import { ACCESS_ROWS, accessRow, accessValuesFrom, coerceAccess, stepAccess, normalizeRemap, translateCode, assignRemap, RESERVED_KEYS } from './playerAccessCore';

/** @param {string} gid */
export function accessKey(gid) {
	return 'tp:game:' + gid + ':access';
}
const LAST_KEY = 'tp:access:last';

/** @param {string | null} raw */
function parse(raw) {
	try {
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

/** The current game's row values. @type {import('svelte/store').Writable<Record<string, any>>} */
export const accessValues = writable(accessValuesFrom(null));

/** The current game's remap tables (game code → player code), keys and pad separately.
 * @type {import('svelte/store').Writable<{keys: Record<string, string>, pad: Record<string, string>}>} */
export const accessRemap = writable({ keys: {}, pad: {} });

/** plain mirrors for the input hot path (no get() per key event) */
let keyTable = /** @type {Record<string, string>} */ ({});
let padTable = /** @type {Record<string, string>} */ ({});
accessRemap.subscribe((r) => {
	keyTable = r.keys;
	padTable = r.pad;
});

function reload() {
	const stored = parse(safeStorage.getItem(accessKey(get(gameId))));
	accessValues.set(accessValuesFrom(stored, parse(safeStorage.getItem(LAST_KEY))));
	accessRemap.set({ keys: normalizeRemap(stored?.remap?.keys), pad: normalizeRemap(stored?.remap?.pad) });
}

function save() {
	const values = get(accessValues);
	const remap = get(accessRemap);
	/** @type {Record<string, any>} */
	const out = { ...values };
	if (Object.keys(remap.keys).length || Object.keys(remap.pad).length) out.remap = remap;
	safeStorage.setItem(accessKey(get(gameId)), JSON.stringify(out));
	safeStorage.setItem(LAST_KEY, JSON.stringify(values));
}

/**
 * Set one row for this game (coerced, persisted). Returns the value stored, undefined for an
 * unknown row. @param {string} id @param {any} value
 */
export function setAccess(id, value) {
	const row = accessRow(id);
	if (!row) return undefined;
	const next = coerceAccess(row, value);
	accessValues.update((v) => ({ ...v, [id]: next }));
	save();
	return next;
}

/** A controller step (toggle flips, choice walks). @param {string} id @param {number} [dir] */
export function stepAccessSetting(id, dir = 1) {
	const row = accessRow(id);
	if (!row) return undefined;
	return setAccess(id, stepAccess(row, get(accessValues)[id], dir));
}

/** Every row back to its default for this game (the remap stays; it has its own reset). */
export function resetAccess() {
	/** @type {Record<string, any>} */
	const defaults = {};
	for (const row of ACCESS_ROWS) defaults[row.id] = row.default;
	accessValues.set(defaults);
	save();
}

/**
 * Bind a game code to the key/pad button the player pressed (a swap when that key was another
 * binding's — `bound` = the game's codes of this kind). Refuses the menu's own key and the browser's.
 * @param {'keys' | 'pad'} kind @param {string} game @param {string} player @param {Iterable<string>} [bound]
 * @returns {boolean}
 */
export function remapControl(kind, game, player, bound = []) {
	if (!game || !player || (kind === 'keys' && RESERVED_KEYS.has(player))) return false;
	accessRemap.update((r) => ({ ...r, [kind]: assignRemap(r[kind], game, player, bound) }));
	save();
	return true;
}

/** Put every key and pad button back to the game's own layout. */
export function resetRemap() {
	accessRemap.set({ keys: {}, pad: {} });
	save();
}

/** What the game hears for a physical KEY (null = remapped away). Hot path. @param {string} code */
export function playCode(code) {
	return translateCode(keyTable, code);
}
/** What the game hears for a physical PAD button (null = remapped away). Hot path. @param {string} code */
export function playPadCode(code) {
	return translateCode(padTable, code);
}
/** any remap in force? (inputRuntime skips the lookup when not) */
export function remapActive() {
	for (const _ in keyTable) return true;
	for (const _ in padTable) return true;
	return false;
}

/** The value of a row now. @param {string} id */
export function accessValue(id) {
	return get(accessValues)[id];
}

/** the suites' view */
export function accessDebug() {
	return { game: get(gameId), values: { ...get(accessValues) }, remap: JSON.parse(JSON.stringify(get(accessRemap))) };
}

// LAST (a module-level subscribe runs synchronously at evaluation — the TDZ rule): follow the game.
gameId.subscribe(() => reload());
