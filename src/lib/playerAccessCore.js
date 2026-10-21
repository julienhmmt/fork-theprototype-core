// 53 (A6) — THE PLAYER'S ACCESSIBILITY SETTINGS, the pure half. The user (2026-10-21): the people
// who PLAY games made here get an Accessibility menu — captions, a colour-blind filter, HUD text
// size and control remapping — saved per player per game, never synced.
//
// Imports nothing (the unit layer's entry rule): the rows and their coercion, the remap table
// maths, the colour-correction matrices and the caption queue. The stores, the persistence and
// every consumer live in playerAccess.js / captions.js.

/**
 * @typedef {{id: string, label: string, type: 'toggle' | 'choice', options?: string[], optionLabels?: string[],
 *   default: any, help?: string, flat?: boolean}} AccessRow
 */

/** The rows the Accessibility page lists, in order. `flat` = has no effect in a headset (yet). @type {AccessRow[]} */
export const ACCESS_ROWS = [
	{ id: 'captions', label: 'Captions', type: 'toggle', default: false, help: 'Shows a line of text for the game’s sounds and voices' },
	{
		id: 'captionSize',
		label: 'Caption size',
		type: 'choice',
		options: ['medium', 'large', 'huge'],
		optionLabels: ['Medium', 'Large', 'Huge'],
		default: 'medium'
	},
	{
		id: 'colorFilter',
		label: 'Colour filter',
		type: 'choice',
		options: ['none', 'protan', 'deutan', 'tritan'],
		optionLabels: ['None', 'Protanopia (red)', 'Deuteranopia (green)', 'Tritanopia (blue)'],
		default: 'none',
		help: 'Shifts colours so the ones you find hard to tell apart stand out',
		flat: true
	},
	{
		id: 'hudText',
		label: 'HUD text size',
		type: 'choice',
		options: ['100', '125', '150', '200'],
		optionLabels: ['100 %', '125 %', '150 %', '200 %'],
		default: '100'
	}
];
const ROW_BY_ID = new Map(ACCESS_ROWS.map((r) => [r.id, r]));

/** @param {string} id @returns {AccessRow | null} */
export function accessRow(id) {
	return ROW_BY_ID.get(id) ?? null;
}

/**
 * A value of the row's kind (a toggle a boolean, a choice one of its options); anything else
 * answers the default. @param {AccessRow} row @param {any} value
 */
export function coerceAccess(row, value) {
	if (row.type === 'toggle') {
		if (typeof value === 'boolean') return value;
		if (value === 'true' || value === 1) return true;
		if (value === 'false' || value === 0) return false;
		return row.default;
	}
	const s = value === undefined || value === null ? '' : String(value);
	return (row.options ?? []).includes(s) ? s : row.default;
}

/**
 * Every row's value from a stored object, falling back to `inherit` (the player's last
 * choices) and then the row default. Pure. @param {any} raw @param {any} [inherit]
 * @returns {Record<string, any>}
 */
export function accessValuesFrom(raw, inherit = null) {
	/** @type {Record<string, any>} */
	const out = {};
	for (const row of ACCESS_ROWS) {
		const own = raw && typeof raw === 'object' && row.id in raw ? raw[row.id] : undefined;
		out[row.id] = own !== undefined ? coerceAccess(row, own) : coerceAccess(row, inherit?.[row.id]);
	}
	return out;
}

/** A row's value as the menu shows it. @param {AccessRow} row @param {any} value */
export function accessDisplay(row, value) {
	if (row.type === 'toggle') return value ? 'On' : 'Off';
	const i = (row.options ?? []).indexOf(String(value));
	return String(row.optionLabels?.[i] ?? value);
}

/**
 * Step a row the way a controller does: a toggle flips, a choice walks (wrapping). Pure.
 * @param {AccessRow} row @param {any} value @param {number} [dir]
 */
export function stepAccess(row, value, dir = 1) {
	if (row.type === 'toggle') return !value;
	const options = row.options ?? [];
	const i = Math.max(0, options.indexOf(String(value)));
	return options[(i + (dir < 0 ? -1 : 1) + options.length) % options.length];
}

/** the HUD text multiplier for a stored choice @param {any} choice */
export function hudTextScale(choice) {
	const n = Number(choice);
	return Number.isFinite(n) && n >= 50 && n <= 300 ? n / 100 : 1;
}

/** caption font size (CSS px on a flat screen) per choice @param {any} choice */
export function captionPx(choice) {
	return choice === 'huge' ? 32 : choice === 'large' ? 24 : 18;
}

/* ------------------------------------------------------------------ remapping ---- */
// A remap table maps the GAME's code (what a Key Press node / Gamepad Button node / the walker
// listens for) to the PLAYER's code (the key or pad button they press instead):
//   { KeyW: 'ArrowUp' }  → pressing ↑ is W to the game, and W itself is free (it does nothing,
//                          unless it is some other binding's new key).
// Identity entries are dropped, so an empty table is the default layout.

/**
 * A stored table made safe: string → string, no identity entries, no two game codes on one
 * player code (a later duplicate is dropped). Pure. @param {any} raw @returns {Record<string, string>}
 */
export function normalizeRemap(raw) {
	/** @type {Record<string, string>} */
	const out = {};
	if (!raw || typeof raw !== 'object') return out;
	const taken = new Set();
	for (const [game, player] of Object.entries(raw)) {
		if (typeof game !== 'string' || typeof player !== 'string' || !game || !player || game.length > 40 || player.length > 40) continue;
		if (game === player || taken.has(player)) continue;
		taken.add(player);
		out[game] = player;
	}
	return out;
}

/** The player code a game code answers to now. @param {Record<string, string>} table @param {string} game */
export function playerCodeFor(table, game) {
	return table[game] ?? game;
}

/**
 * What the GAME hears for a physical press: the game code bound to it, or null when the key
 * was remapped away and nothing took it, or the key itself. Pure, allocation-free.
 * @param {Record<string, string>} table @param {string} physical @returns {string | null}
 */
export function translateCode(table, physical) {
	for (const game in table) if (table[game] === physical) return game;
	return physical in table ? null : physical;
}

/**
 * Bind `game` to `player`. Whatever game code answered to `player` before takes `game`'s old
 * key (a SWAP — two bindings can never share a key): a remapped binding, or — when `bound` lists
 * the game's codes — an unmapped game code that IS that key. Pure: returns a new normalized table.
 * @param {Record<string, string>} table @param {string} game @param {string} player
 * @param {Iterable<string>} [bound] every game code the game listens for
 */
export function assignRemap(table, game, player, bound = []) {
	const next = { ...table };
	const old = playerCodeFor(next, game);
	if (old === player) return normalizeRemap(next);
	// the binding that answered to `player` (a remapped one, or an unmapped game code equal to it)
	let other = null;
	for (const g in next) if (next[g] === player) other = g;
	if (other === null && !(player in next) && new Set(bound).has(player)) other = player;
	next[game] = player;
	if (other !== null && other !== game) next[other] = old;
	// identity entries mean "default" — drop them; keep the rest consistent
	for (const g of Object.keys(next)) if (next[g] === g) delete next[g];
	return normalizeRemap(next);
}

/** A key code as a person reads it: KeyW → W, ArrowUp → ↑, GamepadA → A … @param {string} code */
export function codeLabel(code) {
	const c = String(code ?? '');
	if (/^Key[A-Z]$/.test(c)) return c.slice(3);
	if (/^Digit\d$/.test(c)) return c.slice(5);
	if (/^Numpad\d$/.test(c)) return 'Num ' + c.slice(6);
	const named = /** @type {Record<string, string>} */ ({
		ArrowUp: '↑',
		ArrowDown: '↓',
		ArrowLeft: '←',
		ArrowRight: '→',
		Space: 'Space',
		Enter: 'Enter',
		Escape: 'Esc',
		ShiftLeft: 'Left Shift',
		ShiftRight: 'Right Shift',
		ControlLeft: 'Left Ctrl',
		ControlRight: 'Right Ctrl',
		AltLeft: 'Left Alt',
		AltRight: 'Right Alt',
		Tab: 'Tab',
		Backspace: 'Backspace'
	});
	if (named[c]) return named[c];
	if (c.startsWith('Gamepad')) return c.slice(7).replace(/([a-z])([A-Z])/g, '$1 $2');
	return c;
}

/** keys a player may never take (the pause menu's own key, and the browser's) */
export const RESERVED_KEYS = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'Tab']);

/* ----------------------------------------------------------- colour correction ---- */
// A CORRECTION filter (daltonize), not a simulation: the colour information a viewer with the
// given deficiency cannot see is shifted into channels they can. One 3x3 matrix per type —
//   M = I + E · (I − S)
// where S simulates the deficiency (Machado et al. 2009, severity 1.0) and E spreads the lost
// red/green error into green/blue (Fidaner et al.). Linear, so it is ONE feColorMatrix on a flat
// screen and one mat3 in a shader. Grey stays grey: every S row sums to 1, so (I − S) of a grey
// is zero.

/** @type {Record<string, number[][]>} */
const SIMULATE = {
	protan: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deutan: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritan: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
};
const SHIFT = [
	[0, 0, 0],
	[0.7, 1, 0],
	[0.7, 0, 1]
];

/** @param {number[][]} a @param {number[][]} b */
function mul3(a, b) {
	return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}

/**
 * The correction matrix for a filter choice (row-major 3x3), or null for 'none' / unknown.
 * Pure. @param {string} kind @returns {number[][] | null}
 */
export function colorFilterMatrix(kind) {
	const S = SIMULATE[kind];
	if (!S) return null;
	const IminusS = S.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
	const ES = mul3(SHIFT, IminusS);
	return ES.map((row, i) => row.map((v, j) => Math.round(((i === j ? 1 : 0) + v) * 1e6) / 1e6));
}

/** The 20 numbers an SVG feColorMatrix `values` takes. @param {number[][]} m */
export function feColorMatrixValues(m) {
	return [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0].map((v) => +v.toFixed(6)).join(' ');
}

/* ------------------------------------------------------------------- captions ---- */
// A caption is one short line for a sound: {id, text, source, at, until} (ms). At most
// MAX_CAPTIONS stay on screen (the oldest goes); the same text again while it is still showing
// just extends it — a looping sound or a coin streak is one line, not a column of copies.

export const MAX_CAPTIONS = 3;
export const CAPTION_MS = 3000;
export const CAPTION_MAX_CHARS = 200;

/** @typedef {{id: number, text: string, source: string, at: number, until: number}} Caption */

/** Clean a caption text: trimmed, one line, capped; '' = nothing to show. @param {any} text */
export function cleanCaption(text) {
	return String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, CAPTION_MAX_CHARS);
}

/**
 * Add a caption to the live list. Pure: returns the new list.
 * @param {Caption[]} list @param {{text: any, source?: string, ms?: number}} cap @param {number} now @param {number} id
 * @returns {Caption[]}
 */
export function pushCaption(list, cap, now, id) {
	const text = cleanCaption(cap.text);
	const live = list.filter((c) => c.until > now);
	if (!text) return live;
	const ms = Math.max(500, Math.min(15000, Number(cap.ms) || CAPTION_MS));
	const same = live.find((c) => c.text === text);
	if (same) return live.map((c) => (c === same ? { ...c, until: Math.max(c.until, now + ms) } : c));
	const next = [...live, { id, text, source: String(cap.source ?? ''), at: now, until: now + ms }];
	return next.slice(-MAX_CAPTIONS);
}

/** the captions still showing at `now` @param {Caption[]} list @param {number} now */
export function liveCaptions(list, now) {
	return list.filter((c) => c.until > now);
}

/** Built-in Game Sound names that get no default caption (too frequent to be worth a line). */
export const QUIET_SOUNDS = new Set(['step', 'click', 'pop']);

/**
 * The caption a sound shows: the creator's text, else (for a built-in game sound) a default
 * "[coin]"; '-' means "never caption this one". Pure.
 * @param {any} authored @param {string} [soundName] a built-in Game Sound name
 */
export function captionFor(authored, soundName) {
	const own = cleanCaption(authored);
	if (own === '-') return '';
	if (own) return own;
	if (!soundName || QUIET_SOUNDS.has(soundName)) return '';
	return '[' + String(soundName).replace(/[-_]+/g, ' ') + ']';
}
