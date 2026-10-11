// 38 R9 — THE PHONE BOTTOM BAR's slots (NOTES-38 #7: "Add · Objects · Play · Explorer · More,
// customisable from day one, per device").
//
// Play is not a slot: it is the bar's one live control, placed AMONG the four slots, which hold any
// of the destinations below. It sits in the middle until it is moved (41b H6: its long-press menu's
// Move left / Move right walk it along the bar — `phoneBarPlayAt`, the number of slots on its left,
// absent = the middle).
//
// 41b H6 — MORE MAY LEAVE THE BAR (the user: "'Edit bar…' should also allow to disable 'More'").
// The old rule kept it pinned because "Edit bar…" lives in More; the ways back are now the long
// press on ANY bar item, Play included (its menu carries "Edit bar…" too, so even a bar emptied
// down to Play can be edited), and the editor's header link "More ▸ Edit bar…". Taking More off
// says so ONCE (`MORE_HINT_KEY`).
//
// LOCAL (a fact about this device's screen): `phoneBarSlots` / `phoneBarPlayAt` in safeStorage,
// never replicated, saved or undone. Pure helpers + stores; tests/unit/phoneBar.test.js.
import { writable } from 'svelte/store';
import { safeStorage } from '../safeStorage';

/** every destination a slot may hold, in the order the editor lists them */
export const BAR_CATALOG = [
	'add',
	'objects',
	'explorer',
	'chat',
	'flow',
	'animation',
	'scene',
	'ai',
	'notes',
	'flowcode',
	'shader',
	'uv',
	'hud',
	'profiler',
	'code',
	'more'
];
export const DEFAULT_BAR = ['add', 'objects', 'explorer', 'more'];
export const MAX_SLOTS = 4;
export const STORAGE_KEY = 'phoneBarSlots';

/** safeStorage key: where Play sits (slots on its left); absent = the middle */
export const PLAY_AT_KEY = 'phoneBarPlayAt';
/** safeStorage key: the one-time "how to get More back" notice was shown */
export const MORE_HINT_KEY = 'phoneBarMoreHint';

/**
 * A stored or edited slot list made safe: known keys only, no repeats, at most four (More may be
 * absent — 41b H6). A list that is not a list reads as the default.
 * @param {unknown} list @returns {string[]}
 */
export function normalizeBar(list) {
	if (!Array.isArray(list)) return [...DEFAULT_BAR];
	/** @type {string[]} */
	const out = [];
	for (const k of list) if (typeof k === 'string' && BAR_CATALOG.includes(k) && !out.includes(k)) out.push(k);
	out.splice(MAX_SLOTS);
	return out;
}

/**
 * The editor's tap on one destination: on the bar → off it (More too); off → added, before More
 * while More is on the bar so it stays the last slot (More itself goes back at the end). A full bar
 * refuses (returns it unchanged).
 * @param {string[]} slots @param {string} key @returns {string[]}
 */
export function toggleSlot(slots, key) {
	if (!BAR_CATALOG.includes(key)) return slots;
	if (slots.includes(key)) return normalizeBar(slots.filter((k) => k !== key));
	if (slots.length >= MAX_SLOTS) return slots;
	const next = slots.filter((k) => k !== 'more');
	next.push(key);
	if (slots.includes('more')) next.push('more');
	return normalizeBar(next);
}

/** the middle: the left half gets the odd one @param {number} n */
export function middleOf(n) {
	return Math.ceil(n / 2);
}

/**
 * Where Play sits among `n` slots: the remembered place, clamped to the bar, else the middle.
 * @param {number} n @param {number | null | undefined} playAt @returns {number}
 */
export function playIndex(n, playAt) {
	if (playAt == null || !Number.isFinite(playAt)) return middleOf(n);
	return Math.max(0, Math.min(n, Math.round(playAt)));
}

/**
 * Split the slots around Play (41b H6: wherever it was moved to; the middle by default).
 * @param {string[]} slots @param {number | null} [playAt] @returns {{left: string[], right: string[]}}
 */
export function splitAroundPlay(slots, playAt = null) {
	const at = playIndex(slots.length, playAt);
	return { left: slots.slice(0, at), right: slots.slice(at) };
}

/**
 * Play's Move left (-1) / Move right (+1): its new place, `null` when that is the middle (the
 * default is not remembered), or the old value unchanged at an end.
 * @param {number} n @param {number | null} playAt @param {-1 | 1} dir @returns {number | null}
 */
export function movePlay(n, playAt, dir) {
	const at = playIndex(n, playAt);
	const next = Math.max(0, Math.min(n, at + dir));
	if (next === at) return playAt;
	return next === middleOf(n) ? null : next;
}

function load() {
	try {
		const raw = safeStorage.getItem(STORAGE_KEY);
		return raw ? normalizeBar(JSON.parse(raw)) : [...DEFAULT_BAR];
	} catch {
		return [...DEFAULT_BAR];
	}
}

/** this device's bar (read once, written through) */
export const phoneBarSlots = writable(typeof localStorage === 'undefined' ? [...DEFAULT_BAR] : load());

/** @param {string[]} slots */
export function setBarSlots(slots) {
	const next = normalizeBar(slots);
	phoneBarSlots.set(next);
	try {
		if (next.join() === DEFAULT_BAR.join()) safeStorage.removeItem(STORAGE_KEY);
		else safeStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// private mode: the bar still changes for this session
	}
}

function loadPlayAt() {
	try {
		const raw = safeStorage.getItem(PLAY_AT_KEY);
		const v = raw == null ? NaN : parseInt(raw);
		return Number.isFinite(v) && v >= 0 ? v : null;
	} catch {
		return null;
	}
}

/** where this device's Play sits (slots on its left), null = the middle */
export const phoneBarPlayAt = writable(/** @type {number | null} */ (typeof localStorage === 'undefined' ? null : loadPlayAt()));

/** @param {number | null} playAt */
export function setBarPlayAt(playAt) {
	const next = playAt == null || !Number.isFinite(playAt) ? null : Math.max(0, Math.round(playAt));
	phoneBarPlayAt.set(next);
	try {
		if (next == null) safeStorage.removeItem(PLAY_AT_KEY);
		else safeStorage.setItem(PLAY_AT_KEY, String(next));
	} catch {
		// private mode: Play still moves for this session
	}
}
