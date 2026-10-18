// 48 D1 — the node graph debugger's pure rules (src/lib/flowDebugCore.js).
import { describe, it, expect } from 'vitest';
import {
	breakpointReach,
	breakpointHit,
	chooseStep,
	enqueue,
	formatValue,
	formatPulse,
	normalizeWatches,
	normalizeBreakpoints,
	watchKey
} from '../../src/lib/flowDebugCore.js';

const edges = [
	{ source: 'click', target: 'counter', targetHandle: 'pulse' },
	{ source: 'seq', sourceHandle: 'step2', target: 'counter', targetHandle: 'reset' },
	{ source: 'seq', sourceHandle: 'step1', target: 'other' },
	{ source: 'counter', target: 'hud', targetHandle: 'value' }
];

describe('breakpoint reach', () => {
	it('is empty with no breakpoints (the idle case costs nothing)', () => {
		expect(breakpointReach([], edges).size).toBe(0);
	});
	it('maps each source to the breakpoints its edges end at, per handle', () => {
		const reach = breakpointReach(['counter'], edges);
		expect([...reach.keys()].sort()).toEqual(['click', 'seq']);
		expect(reach.get('seq')).toEqual([{ handle: 'step2', bp: 'counter' }]);
	});
	it('hits the node that fires, or the end of an edge on the firing handle', () => {
		const bps = new Set(['counter']);
		const reach = breakpointReach(bps, edges);
		expect(breakpointHit(bps, reach, 'counter', null)).toBe('counter'); // the node itself fires
		expect(breakpointHit(bps, reach, 'click', null)).toBe('counter');
		expect(breakpointHit(bps, reach, 'seq', 'step2')).toBe('counter');
		// counterfactual: step1 of the same Sequence goes elsewhere and must not pause
		expect(breakpointHit(bps, reach, 'seq', 'step1')).toBe(null);
		// a null handle walks every output (applyNodeTrigger's own rule)
		expect(breakpointHit(bps, reach, 'seq', null)).toBe('counter');
		expect(breakpointHit(bps, reach, 'hud', null)).toBe(null);
	});
});

describe('step choice', () => {
	it('takes queued events in arrival order', () => {
		expect(chooseStep([{ t: 5 }, { t: 4 }], null)).toEqual({ kind: 'event' });
	});
	it('runs a scheduled moment first when it falls before the next event', () => {
		expect(chooseStep([{ t: 5 }], 4.5)).toEqual({ kind: 'moment', at: 4.5 });
		expect(chooseStep([{ t: 5 }], 6)).toEqual({ kind: 'event' });
		expect(chooseStep([], 6)).toEqual({ kind: 'moment', at: 6 });
	});
	it('waits when there is nothing to step', () => {
		expect(chooseStep([], null)).toEqual({ kind: 'wait' });
	});
	it('caps the queue and reports what it dropped', () => {
		/** @type {{t: number}[]} */
		const q = [];
		let dropped = 0;
		for (let i = 0; i < 7; i++) dropped += enqueue(q, { t: i }, 5);
		expect(q.map((e) => e.t)).toEqual([2, 3, 4, 5, 6]);
		expect(dropped).toBe(2);
	});
});

describe('value formatting', () => {
	it('reads numbers, booleans, vectors and colours in one short line', () => {
		expect(formatValue(3)).toBe('3');
		expect(formatValue(2.456)).toBe('2.46');
		expect(formatValue(0.000123)).toBe('0.00012');
		expect(formatValue(true)).toBe('true');
		expect(formatValue([1, 2.5, 3])).toBe('(1, 2.5, 3)');
		expect(formatValue({ x: 1, y: 0, z: -2 })).toBe('(1, 0, -2)');
		expect(formatValue({ r: 1, g: 0, b: 0.5 })).toBe('rgb(255, 0, 128)');
		expect(formatValue(undefined)).toBe('—');
		expect(formatValue({ __handles: { a: 1, b: 2 } })).toBe('{2 outputs}');
	});
	it('names an object instead of printing its uuid', () => {
		const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
		expect(formatValue(uuid, (u) => (u === uuid ? 'Door' : null))).toBe('Door');
		expect(formatValue('a long string that keeps going and going')).toMatch(/…"$/);
	});
	it('reads an event wire as its pulse at the debug clock', () => {
		expect(formatPulse(null, 10)).toEqual({ fired: false, high: false, text: 'never' });
		expect(formatPulse(10, 10.1).high).toBe(true);
		expect(formatPulse(10, 12.5).text).toBe('2.5 s ago');
		// a stamp past the paused clock has not happened in the paused view
		expect(formatPulse(11, 10).text).toBe('queued');
		// the clock wraps at midnight: a stamp at 23:59:59 read at 00:00:01 is 2 s old
		expect(formatPulse(86399, 1).text).toBe('2 s ago');
	});
});

describe('persisted lists', () => {
	it('keeps known watch kinds, drops junk and duplicates', () => {
		const list = normalizeWatches([
			{ kind: 'var', key: ' score ' },
			{ kind: 'var', key: 'score' },
			{ kind: 'node', key: 'n1', handle: 'value' },
			{ kind: 'bogus', key: 'x' },
			{ kind: 'player', key: '' },
			null,
			'str'
		]);
		expect(list).toEqual([
			{ kind: 'var', key: 'score' },
			{ kind: 'node', key: 'n1', handle: 'value' }
		]);
		expect(watchKey(list[1])).toBe('node:n1#value');
		expect(normalizeWatches('nope')).toEqual([]);
	});
	it('keeps breakpoint ids unique and capped', () => {
		expect(normalizeBreakpoints(['a', 'a', 3, '', 'b'])).toEqual(['a', 'b']);
		expect(normalizeBreakpoints(Array.from({ length: 150 }, (_, i) => 'n' + i))).toHaveLength(100);
	});
});
