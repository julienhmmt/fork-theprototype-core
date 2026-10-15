// 44 M9 — the dock split model ($lib/bottomDock): a pair is ONE strip entry "A / B", both halves
// render while it is the visible tab, its record survives a reload (and a stale one is cleaned), and
// a member leaving the dock ends the pair.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	setDockOccupant,
	dockTabOrder,
	dockOccupants,
	dockSplits,
	dockSplitView,
	dockShownKeys,
	dockPaneOf,
	dockStripTabs,
	splitDock,
	splitWithNext,
	unsplitDock,
	swapSplitSides,
	setSplitPane,
	setSplitRatio,
	resolveSplits,
	forgetDockTab,
	moveDockTab,
	activateDock,
	dockMinimized
} from '../../src/lib/bottomDock.js';

const strip = () => get(dockStripTabs).map((t) => t.title);

describe('dock split', () => {
	beforeEach(() => {
		dockOccupants.set({});
		dockTabOrder.set([]);
		dockSplits.set([]);
		dockMinimized.set(false);
		for (const k of ['flow', 'explorer', 'animation']) setDockOccupant(k, true, 320);
		activateDock('flow');
	});

	it('splits the active tab with the next one: one strip entry, both shown, panes a/b', () => {
		expect(splitWithNext('flow')).toBe(true);
		expect(strip()).toEqual(['Node editor / Explorer', 'Animation']);
		expect(get(dockShownKeys)).toEqual(['flow', 'explorer']);
		expect(get(dockPaneOf)).toEqual({ flow: 'a', explorer: 'b' });
		// focusing the right pane keeps the split on screen
		activateDock('explorer');
		expect(get(dockShownKeys)).toEqual(['flow', 'explorer']);
		// another tab in front: only it renders
		activateDock('animation');
		expect(get(dockShownKeys)).toEqual(['animation']);
		expect(get(dockSplitView)).toBe(null);
	});

	it('the last tab splits with an EMPTY pane', () => {
		splitWithNext('animation');
		expect(get(dockSplits)).toEqual([{ a: 'animation', b: null, r: 0.5 }]);
		expect(get(dockShownKeys)).toEqual(['animation']);
		expect(get(dockSplitView)).toEqual({ a: 'animation', b: null, r: 0.5 });
		expect(strip()).toContain('Animation / Empty');
	});

	it('swap, ratio clamp, unsplit', () => {
		splitDock('flow', 'explorer');
		setSplitRatio('flow', 0.99);
		expect(get(dockSplits)[0].r).toBe(0.85);
		swapSplitSides('explorer');
		expect(get(dockSplits)[0]).toMatchObject({ a: 'explorer', b: 'flow' });
		expect(get(dockSplits)[0].r).toBeCloseTo(0.15);
		unsplitDock('flow');
		expect(get(dockSplits)).toEqual([]);
		expect(strip()).toEqual(['Node editor', 'Explorer', 'Animation']);
	});

	it('a tab dropped onto a pane replaces that half; the replaced one stays a tab', () => {
		splitDock('flow', 'explorer');
		setSplitPane('flow', 'b', 'animation');
		expect(get(dockSplits)).toEqual([{ a: 'flow', b: 'animation', r: 0.5 }]);
		expect(strip()).toEqual(['Node editor / Animation', 'Explorer']);
		// a member dropped on its other pane swaps
		setSplitPane('flow', 'a', 'animation');
		expect(get(dockSplits)[0]).toMatchObject({ a: 'animation', b: 'flow' });
	});

	it('undocking a member ends its pair; a closed member hides the split, the record stays', () => {
		splitDock('flow', 'explorer');
		setDockOccupant('explorer', false); // an app close (Settings hiding panels)
		expect(get(dockSplitView)).toBe(null);
		expect(get(dockShownKeys)).toEqual(['flow']);
		expect(get(dockSplits).length).toBe(1);
		setDockOccupant('explorer', true, 320);
		expect(get(dockShownKeys)).toEqual(['flow', 'explorer']);
		forgetDockTab('explorer');
		expect(get(dockSplits)).toEqual([]);
	});

	it('a pair moves as one strip entry', () => {
		splitDock('flow', 'explorer');
		moveDockTab('flow', 'right');
		expect(strip()).toEqual(['Animation', 'Node editor / Explorer']);
	});

	it('minimized shows nothing', () => {
		splitDock('flow', 'explorer');
		dockMinimized.set(true);
		expect(get(dockShownKeys)).toEqual([]);
	});

	it('a stale / hand-edited record is cleaned (unknown keys, duplicates, bad ratio, pre-44 shapes)', () => {
		expect(resolveSplits(null)).toEqual([]);
		expect(resolveSplits({ a: 'flow' })).toEqual([]);
		expect(
			resolveSplits([
				{ a: 'flow', b: 'explorer', r: 'x' },
				{ a: 'explorer', b: 'uv' },
				{ a: 'nope', b: 'uv' },
				{ a: 'uv', b: 'uv' },
				{ a: 'animation', r: 2 }
			])
		).toEqual([
			{ a: 'flow', b: 'explorer', r: 0.5 },
			{ a: 'animation', b: null, r: 0.85 }
		]);
	});


	it('a stored record is READ BACK on boot (a fresh module instance over a seeded localStorage)', async () => {
		const mem = new Map([['bottomDockSplits', JSON.stringify([{ a: 'flow', b: 'explorer', r: 0.4 }])]]);
		vi.stubGlobal('localStorage', { getItem: (/** @type {string} */ k) => mem.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => mem.set(k, String(v)), removeItem: (/** @type {string} */ k) => mem.delete(k) });
		vi.resetModules();
		try {
			const fresh = await import('../../src/lib/bottomDock.js');
			expect(get(fresh.dockSplits)).toEqual([{ a: 'flow', b: 'explorer', r: 0.4 }]);
			expect(mem.get('bottomDockSplits')).toBe(JSON.stringify([{ a: 'flow', b: 'explorer', r: 0.4 }]));
		} finally {
			vi.unstubAllGlobals();
			vi.resetModules();
		}
	});
});
