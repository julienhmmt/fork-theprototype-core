import { describe, it, expect } from 'vitest';
import { boxAt, fractionsOf, clampBox, snapBox, nudgeFree, overlaps, MARGIN, GAP } from '../../src/lib/clusterPlace.js';
import { normalizeClusters, anchorOf, normalizeLayout, defaultLayout, placements, fromPlacements } from '../../src/lib/toolbarLayout.js';

const area = { left: 0, top: 0, right: 1440, bottom: 900 };
const size = { w: 100, h: 50 };

describe('clusterPlace — fractions', () => {
	it('0 / 1 hug the edges at the margin, 0.5 centres', () => {
		expect(boxAt({ x: 0, y: 0 }, size, area)).toEqual({ left: MARGIN, top: MARGIN, right: MARGIN + 100, bottom: MARGIN + 50 });
		const br = boxAt({ x: 1, y: 1 }, size, area);
		expect(br.right).toBe(1440 - MARGIN);
		expect(br.bottom).toBe(900 - MARGIN);
		const c = boxAt({ x: 0.5, y: 0.5 }, size, area);
		expect((c.left + c.right) / 2).toBe(720);
	});
	it('round-trips through fractionsOf', () => {
		const f = { x: 0.3, y: 0.7 };
		const back = fractionsOf(boxAt(f, size, area), area);
		expect(back.x).toBeCloseTo(0.3, 6);
		expect(back.y).toBeCloseTo(0.7, 6);
	});
	it('keeps the RELATIVE place on another window (fold / unfold) and an edge-glued one on its edge', () => {
		const f = fractionsOf({ left: 400, top: 300, right: 500, bottom: 350 }, area);
		const small = { left: 0, top: 0, right: 770, bottom: 850 };
		const b = boxAt(f, size, small);
		expect(fractionsOf(b, small).x).toBeCloseTo(f.x, 6);
		const glued = boxAt({ x: 1, y: 1 }, size, small);
		expect(glued.right).toBe(770 - MARGIN);
	});
	it('a pinned sidebar narrows the area and the cluster stays inside it', () => {
		const withSidebar = { left: 0, top: 0, right: 1440 - 360, bottom: 900 };
		const b = boxAt({ x: 1, y: 0.5 }, size, withSidebar);
		expect(b.right).toBe(1080 - MARGIN);
	});
	it('clampBox keeps a box on screen', () => {
		expect(clampBox({ left: -50, top: 2000, right: 50, bottom: 2050 }, area)).toEqual({ left: MARGIN, top: 900 - MARGIN - 50, right: MARGIN + 100, bottom: 900 - MARGIN });
	});
});

describe('clusterPlace — snapping', () => {
	it('snaps to an edge within the threshold and reports the guide', () => {
		const r = snapBox({ left: 22, top: 400, right: 122, bottom: 450 }, area, []);
		expect(r.box.left).toBe(MARGIN);
		expect(r.guides).toContainEqual({ axis: 'x', at: MARGIN });
	});
	it('snaps to the centre line', () => {
		const r = snapBox({ left: 675, top: 400, right: 775, bottom: 450 }, area, []);
		expect((r.box.left + r.box.right) / 2).toBe(720);
	});
	it('snaps beside another cluster at GAP, and into line with its top', () => {
		const other = { left: 500, top: 300, right: 600, bottom: 340 };
		const r = snapBox({ left: 612, top: 303, right: 712, bottom: 353 }, area, [other]);
		expect(r.box.left).toBe(600 + GAP);
		expect(r.box.top).toBe(300);
		expect(r.guides.length).toBe(2);
	});
	it('does not snap from far away', () => {
		const r = snapBox({ left: 300, top: 400, right: 400, bottom: 450 }, area, []);
		expect(r.box.left).toBe(300);
		expect(r.guides.length).toBe(0);
	});
});

describe('clusterPlace — no overlaps', () => {
	it('a free box stays', () => {
		const b = { left: 300, top: 300, right: 400, bottom: 350 };
		expect(nudgeFree(b, area, [{ left: 600, top: 600, right: 700, bottom: 700 }])).toEqual(b);
	});
	it('an overlapping box moves to the NEAREST free spot beside the obstacle', () => {
		const ob = { left: 300, top: 300, right: 500, bottom: 400 };
		const b = { left: 480, top: 320, right: 580, bottom: 370 };
		const n = nudgeFree(b, area, [ob]);
		expect(overlaps(n, ob)).toBe(false);
		expect(n.left).toBe(500 + GAP); // 28 px right beats every other way out
		expect(n.top).toBe(320);
	});
	it('settles against two obstacles and stays inside the area', () => {
		const obs = [
			{ left: 0, top: 800, right: 200, bottom: 900 },
			{ left: 210, top: 780, right: 400, bottom: 900 }
		];
		const n = nudgeFree({ left: 150, top: 820, right: 250, bottom: 870 }, area, obs);
		expect(obs.every((o) => !overlaps(n, o))).toBe(true);
		expect(n.left >= MARGIN && n.right <= 1440 - MARGIN && n.top >= MARGIN && n.bottom <= 900 - MARGIN).toBe(true);
	});
	it('is deterministic', () => {
		const ob = [{ left: 300, top: 300, right: 500, bottom: 400 }];
		const b = { left: 350, top: 330, right: 450, bottom: 380 };
		expect(nudgeFree(b, area, ob)).toEqual(nudgeFree(b, area, ob));
	});
});

describe('toolbarLayout — clusters in the record', () => {
	const cfg = { order: ['a', 'b'], spacer: 1, left: ['c'], right: ['d'], isKnown: (/** @type {string} */ id) => ['a', 'b', 'c', 'd'].includes(id) };
	it('normalizes: unknown ids, bad numbers and illegal flags dropped, fractions clamped, anchor derived', () => {
		const n = normalizeClusters({ bar: { x: 2, y: 0.9, hidden: true, rotated: true }, connect: { rotated: true, x: 0.5, y: 0 }, nope: { x: 0, y: 0 }, left: { x: 'a', y: 0 }, top: {} });
		expect(n.bar).toEqual({ x: 1, y: 0.9, a: 'bottom-right', rotated: true });
		expect(n.connect).toEqual({ x: 0.5, y: 0, a: 'top-center' });
		expect(n.left).toBeUndefined();
		expect(n.top).toBeUndefined();
		expect(Object.keys(n)).not.toContain('nope');
	});
	it('anchorOf picks the nearest of nine', () => {
		expect(anchorOf(0, 0)).toBe('top-left');
		expect(anchorOf(0.5, 0.5)).toBe('middle-center');
		expect(anchorOf(0.9, 0.2)).toBe('top-right');
	});
	it('rides normalizeLayout and placements / fromPlacements; absent = {}', () => {
		expect(defaultLayout(cfg).clusters).toEqual({});
		const l = normalizeLayout({ order: ['a', 'b'], clusters: { right: { x: 1, y: 0.4, rotated: true } } }, cfg);
		expect(l.clusters?.right).toEqual({ x: 1, y: 0.4, a: 'middle-right', rotated: true });
		expect(normalizeLayout(normalizeLayout(l, cfg), cfg)).toEqual(normalizeLayout(l, cfg));
		const p = placements(l);
		const back = fromPlacements(l, { ...p, clusters: { ...p.clusters, left: { x: 0, y: 0 } } });
		expect(back.clusters?.left).toEqual({ x: 0, y: 0, a: 'top-left' });
		expect(back.clusters?.right?.rotated).toBe(true);
	});
});
