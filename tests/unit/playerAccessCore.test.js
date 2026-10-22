import { describe, it, expect } from 'vitest';
import {
	ACCESS_ROWS,
	accessRow,
	accessValuesFrom,
	coerceAccess,
	stepAccess,
	accessDisplay,
	hudTextScale,
	normalizeRemap,
	translateCode,
	assignRemap,
	playerCodeFor,
	codeLabel,
	colorFilterMatrix,
	feColorMatrixValues,
	pushCaption,
	liveCaptions,
	captionFor,
	cleanCaption,
	MAX_CAPTIONS
} from '../../src/lib/playerAccessCore.js';

describe('53 A6 — access rows', () => {
	it('defaults, inheritance from the last choices, own values win', () => {
		const d = accessValuesFrom(null);
		expect(d).toEqual({ captions: false, captionSize: 'medium', colorFilter: 'none', hudText: '100' });
		const inherited = accessValuesFrom(null, { captions: true, colorFilter: 'deutan' });
		expect(inherited.captions).toBe(true);
		expect(inherited.colorFilter).toBe('deutan');
		const own = accessValuesFrom({ captions: false }, { captions: true });
		expect(own.captions).toBe(false);
		// junk falls back to the default
		expect(accessValuesFrom({ hudText: '999', colorFilter: 'sepia' })).toMatchObject({ hudText: '100', colorFilter: 'none' });
	});
	it('coerces, steps (wrapping) and displays', () => {
		const filter = /** @type {any} */ (accessRow('colorFilter'));
		expect(coerceAccess(filter, 'tritan')).toBe('tritan');
		expect(stepAccess(filter, 'tritan', 1)).toBe('none');
		expect(stepAccess(filter, 'none', -1)).toBe('tritan');
		expect(accessDisplay(filter, 'protan')).toBe('Protanopia (red)');
		const cap = /** @type {any} */ (accessRow('captions'));
		expect(stepAccess(cap, false)).toBe(true);
		expect(coerceAccess(cap, 'true')).toBe(true);
		expect(ACCESS_ROWS.map((r) => r.id)).toEqual(['captions', 'captionSize', 'colorFilter', 'hudText']);
		expect(hudTextScale('150')).toBe(1.5);
		expect(hudTextScale('junk')).toBe(1);
	});
});

describe('53 A6 — remapping', () => {
	it('translates a press: the new key is the game key, the old key goes quiet', () => {
		const t = { KeyW: 'ArrowUp' };
		expect(translateCode(t, 'ArrowUp')).toBe('KeyW');
		expect(translateCode(t, 'KeyW')).toBe(null);
		expect(translateCode(t, 'KeyA')).toBe('KeyA');
	});
	it('assigning a taken key SWAPS (no two bindings share a key)', () => {
		// W → ↑, then S → ↑: W takes S's old key (S)
		let t = assignRemap({}, 'KeyW', 'ArrowUp');
		expect(t).toEqual({ KeyW: 'ArrowUp' });
		t = assignRemap(t, 'KeyS', 'ArrowUp');
		expect(playerCodeFor(t, 'KeyS')).toBe('ArrowUp');
		expect(playerCodeFor(t, 'KeyW')).toBe('KeyS');
		expect(translateCode(t, 'KeyS')).toBe('KeyW');
		// binding a game key to another game key's own default swaps them
		const s = assignRemap({}, 'KeyA', 'KeyD', ['KeyA', 'KeyD']);
		expect(translateCode(s, 'KeyD')).toBe('KeyA');
		expect(translateCode(s, 'KeyA')).toBe('KeyD');
		// back to identity drops the entries
		expect(assignRemap(s, 'KeyA', 'KeyA', ['KeyA', 'KeyD'])).toEqual({});
		// a key the game does not use is simply taken
		expect(assignRemap({}, 'KeyA', 'KeyJ', ['KeyA', 'KeyD'])).toEqual({ KeyA: 'KeyJ' });
	});
	it('normalizes junk and duplicate targets', () => {
		expect(normalizeRemap({ KeyW: 'KeyW', KeyA: 'KeyJ', KeyB: 'KeyJ', x: 5 })).toEqual({ KeyA: 'KeyJ' });
		expect(normalizeRemap(null)).toEqual({});
	});
	it('labels codes for people', () => {
		expect(codeLabel('KeyW')).toBe('W');
		expect(codeLabel('ArrowUp')).toBe('↑');
		expect(codeLabel('Digit3')).toBe('3');
		expect(codeLabel('GamepadA')).toBe('A');
		expect(codeLabel('GamepadDpadUp')).toBe('Dpad Up');
	});
});

describe('53 A6 — colour correction', () => {
	it('is null for none, a 3x3 for each type, and keeps grey grey', () => {
		expect(colorFilterMatrix('none')).toBe(null);
		for (const kind of ['protan', 'deutan', 'tritan']) {
			const m = /** @type {number[][]} */ (colorFilterMatrix(kind));
			expect(m.length).toBe(3);
			for (const row of m) {
				// a grey (r = g = b) maps to itself: every row sums to 1
				expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 3);
			}
			// and it actually changes a red
			const red = m.map((row) => row[0]);
			expect(Math.abs(red[0] - 1) + Math.abs(red[1]) + Math.abs(red[2])).toBeGreaterThan(0.05);
			expect(feColorMatrixValues(m).split(' ').length).toBe(20);
		}
	});
});

describe('53 A6 — captions', () => {
	it('queues at most MAX_CAPTIONS, merges a repeat, expires', () => {
		let list = /** @type {any[]} */ ([]);
		list = pushCaption(list, { text: 'door creaks' }, 0, 1);
		list = pushCaption(list, { text: 'door creaks' }, 1000, 2);
		expect(list.length).toBe(1);
		expect(list[0].until).toBe(4000);
		for (let i = 0; i < 5; i++) list = pushCaption(list, { text: 'line ' + i }, 1500, 10 + i);
		expect(list.length).toBe(MAX_CAPTIONS);
		expect(list[list.length - 1].text).toBe('line 4');
		expect(liveCaptions(list, 10000)).toEqual([]);
		expect(pushCaption([], { text: '   ' }, 0, 1)).toEqual([]);
	});
	it('authored text wins, built-in sounds get a default, "-" silences, frequent sounds stay quiet', () => {
		expect(captionFor('Thunder rolls', 'coin')).toBe('Thunder rolls');
		expect(captionFor('', 'coin')).toBe('[coin]');
		expect(captionFor('', 'step')).toBe('');
		expect(captionFor('-', 'coin')).toBe('');
		expect(captionFor('', undefined)).toBe('');
		expect(cleanCaption('  two\nlines ')).toBe('two lines');
	});
});
