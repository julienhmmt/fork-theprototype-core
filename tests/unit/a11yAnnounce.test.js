// @ts-nocheck — plain object literals stand in for three objects
import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { announce, politeAnnouncement, assertiveAnnouncement, isErrorText, objectTypeLabel, selectionPhrase, REPEAT_GAP_MS } from '../../src/lib/a11y/announce.js';

// 53-reader (A4): what a screen reader hears.

describe('objectTypeLabel', () => {
	it('names primitives from the stamped params, then from three’s geometry type', () => {
		expect(objectTypeLabel({ isMesh: true, userData: { geometryParams: { gtype: 'Box' } } })).toBe('box');
		expect(objectTypeLabel({ isMesh: true, userData: { geometryParams: { gtype: 'RoundedBox' } } })).toBe('rounded box');
		expect(objectTypeLabel({ isMesh: true, userData: {}, geometry: { type: 'SphereGeometry' } })).toBe('sphere');
		expect(objectTypeLabel({ isMesh: true, userData: {}, geometry: { type: 'BufferGeometry' } })).toBe('mesh');
	});
	it('says light, camera, group and the marker kinds', () => {
		expect(objectTypeLabel({ isLight: true, type: 'PointLight', userData: {} })).toBe('point light');
		expect(objectTypeLabel({ isLight: true, type: 'DirectionalLight', userData: {} })).toBe('directional light');
		expect(objectTypeLabel({ isMesh: true, userData: { camera: { kind: 'perspective' } } })).toBe('camera');
		expect(objectTypeLabel({ type: 'Group', userData: {} })).toBe('group');
		expect(objectTypeLabel({ isMesh: true, userData: { terrain: {} } })).toBe('terrain');
		expect(objectTypeLabel({ type: 'Group', userData: { animatedClips: [] } })).toBe('animated model');
		expect(objectTypeLabel(null)).toBe('object');
	});
});

describe('selectionPhrase', () => {
	const box = { name: 'Crate', isMesh: true, userData: { geometryParams: { gtype: 'Box' } } };
	const lamp = { name: '', isLight: true, type: 'SpotLight', userData: {} };
	it('one object = "<name>, <type>"', () => {
		expect(selectionPhrase([box])).toBe('Crate, box');
		expect(selectionPhrase([lamp])).toBe('Unnamed, spot light');
	});
	it('several = a count; emptying = "Nothing selected" (and nothing when it was already empty)', () => {
		expect(selectionPhrase([box, lamp])).toBe('2 objects selected');
		expect(selectionPhrase([], 2)).toBe('Nothing selected');
		expect(selectionPhrase([], 0)).toBe('');
	});
});

describe('isErrorText', () => {
	it('catches the app’s error wording', () => {
		for (const t of ['Could not load the scene', 'Upload failed', 'Something went wrong: x is undefined', "Couldn't reach the server", 'Cannot delete a locked object', 'Permission denied'])
			expect(isErrorText(t), t).toBe(true);
	});
	it('leaves ordinary toasts polite', () => {
		for (const t of ['Saved "Arena".', 'Copied 3 objects', 'Connected to ABC123', 'Shared "Box".']) expect(isErrorText(t), t).toBe(false);
	});
});

describe('announce', () => {
	it('writes the polite or the assertive region', () => {
		announce('Hello  world ');
		expect(get(politeAnnouncement)).toBe('Hello world');
		announce('Boom', { assertive: true });
		expect(get(assertiveAnnouncement)).toBe('Boom');
	});
	it('the same words twice are cleared and re-written, so the second is heard too', () => {
		vi.useFakeTimers();
		announce('Again');
		announce('Again');
		expect(get(politeAnnouncement)).toBe('');
		vi.advanceTimersByTime(REPEAT_GAP_MS);
		expect(get(politeAnnouncement)).toBe('Again');
		vi.useRealTimers();
	});
	it('empty text says nothing', () => {
		announce('Kept');
		announce('   ');
		expect(get(politeAnnouncement)).toBe('Kept');
	});
});
