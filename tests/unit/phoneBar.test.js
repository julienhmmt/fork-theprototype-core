import { describe, it, expect } from 'vitest';
import { normalizeBar, toggleSlot, splitAroundPlay, playIndex, movePlay, DEFAULT_BAR, MAX_SLOTS } from '../../src/lib/ui/phoneBar.js';

// 38 R9 / NOTES-38 #7: the phone bar's four slots around Play. 41b H6: More may leave the bar
// (a long press on any item, Play included, reaches Edit bar) and Play moves along it.
describe('phoneBar', () => {
	it('defaults to Add, Objects, Explorer, More', () => {
		expect(DEFAULT_BAR).toEqual(['add', 'objects', 'explorer', 'more']);
		expect(normalizeBar(null)).toEqual(DEFAULT_BAR);
		expect(normalizeBar('nope')).toEqual(DEFAULT_BAR);
	});

	it('drops unknown keys and repeats, caps at four', () => {
		expect(normalizeBar(['add', 'bogus', 'add', 'chat', 'more'])).toEqual(['add', 'chat', 'more']);
		expect(normalizeBar(['add', 'objects', 'explorer', 'chat', 'flow', 'more']).length).toBe(MAX_SLOTS);
	});

	it('More can leave the bar and comes back at the end (41b H6)', () => {
		expect(normalizeBar(['add', 'chat'])).toEqual(['add', 'chat']);
		expect(normalizeBar(['add', 'chat', 'flow', 'objects'])).toEqual(['add', 'chat', 'flow', 'objects']);
		expect(normalizeBar([])).toEqual([]);
		const noMore = toggleSlot(DEFAULT_BAR, 'more');
		expect(noMore).toEqual(['add', 'objects', 'explorer']);
		expect(toggleSlot(noMore, 'chat')).toEqual(['add', 'objects', 'explorer', 'chat']);
		expect(toggleSlot(['add'], 'more')).toEqual(['add', 'more']);
		// a full bar refuses More like any other fifth
		expect(toggleSlot(['add', 'objects', 'explorer', 'chat'], 'more')).toEqual(['add', 'objects', 'explorer', 'chat']);
	});

	it('a tap removes a slot, or adds one before More while there is room', () => {
		const three = toggleSlot(DEFAULT_BAR, 'explorer');
		expect(three).toEqual(['add', 'objects', 'more']);
		expect(toggleSlot(three, 'chat')).toEqual(['add', 'objects', 'chat', 'more']);
		// a full bar refuses a fifth
		expect(toggleSlot(DEFAULT_BAR, 'chat')).toEqual(DEFAULT_BAR);
		// an unknown key changes nothing
		expect(toggleSlot(DEFAULT_BAR, 'bogus')).toEqual(DEFAULT_BAR);
	});

	it('Play sits in the middle; the left half takes the odd one', () => {
		expect(splitAroundPlay(DEFAULT_BAR)).toEqual({ left: ['add', 'objects'], right: ['explorer', 'more'] });
		expect(splitAroundPlay(['add', 'chat', 'more'])).toEqual({ left: ['add', 'chat'], right: ['more'] });
		expect(splitAroundPlay(['more'])).toEqual({ left: ['more'], right: [] });
		expect(splitAroundPlay([])).toEqual({ left: [], right: [] });
	});

	it('Play moves along the bar and forgets the middle (41b H6)', () => {
		expect(splitAroundPlay(DEFAULT_BAR, 0)).toEqual({ left: [], right: DEFAULT_BAR });
		expect(splitAroundPlay(DEFAULT_BAR, 4)).toEqual({ left: DEFAULT_BAR, right: [] });
		// a remembered place past a shrunk bar clamps to its end
		expect(playIndex(2, 4)).toBe(2);
		// from the middle (2 of 4): left to 1, right to 3; back to the middle reads null
		expect(movePlay(4, null, -1)).toBe(1);
		expect(movePlay(4, null, 1)).toBe(3);
		expect(movePlay(4, 1, 1)).toBe(null);
		expect(movePlay(4, 3, -1)).toBe(null);
		// at an end nothing changes
		expect(movePlay(4, 0, -1)).toBe(0);
		expect(movePlay(4, 4, 1)).toBe(4);
	});
});
