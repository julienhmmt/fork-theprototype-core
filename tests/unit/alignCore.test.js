// @ts-nocheck — fixture arithmetic over plain box literals; the module itself is fully typed
import { describe, it, expect } from 'vitest';
import { alignDeltas, distributeDeltas, unionBox, edgeOf, axisIndex } from '../../src/lib/alignCore.js';

// 47 M2: align / distribute as deltas over world boxes.

/** a box of `size` centred on x = cx (y, z unit) */
const bx = (cx, size = 1) => ({ min: [cx - size / 2, 0, 0], max: [cx + size / 2, 1, 1] });
const apply = (boxes, deltas, axis = 0) => boxes.map((b, i) => ({ min: b.min.map((v, a) => (a === axis ? v + deltas[i] : v)), max: b.max.map((v, a) => (a === axis ? v + deltas[i] : v)) }));

describe('alignDeltas', () => {
	const boxes = [bx(0, 1), bx(3, 2), bx(-2, 0.5)]; // x spans [-0.5,0.5] [2,4] [-2.25,-1.75]
	it('min aligns every box to the selection bounds min', () => {
		const after = apply(boxes, alignDeltas(boxes, 0, 'min'));
		expect(after.map((b) => b.min[0])).toEqual([-2.25, -2.25, -2.25]);
	});
	it('max aligns to the selection bounds max', () => {
		const after = apply(boxes, alignDeltas(boxes, 0, 'max'));
		expect(after.map((b) => b.max[0])).toEqual([4, 4, 4]);
	});
	it('center aligns the centres to the bounds centre', () => {
		const after = apply(boxes, alignDeltas(boxes, 0, 'center'));
		const c = (-2.25 + 4) / 2;
		after.forEach((b) => expect(edgeOf(b, 0, 'center')).toBeCloseTo(c, 12));
	});
	it('to the ACTIVE object: it stays, the others line up with it', () => {
		const d = alignDeltas(boxes, 0, 'min', 1);
		expect(d[1]).toBe(0);
		expect(apply(boxes, d).map((b) => b.min[0])).toEqual([2, 2, 2]);
	});
	it('works on any axis and leaves the others alone', () => {
		const tall = [
			{ min: [0, 0, 0], max: [1, 1, 1] },
			{ min: [5, 2, 0], max: [6, 4, 1] }
		];
		const d = alignDeltas(tall, 1, 'min');
		expect(d).toEqual([0, -2]);
		expect(axisIndex('y')).toBe(1);
		expect(axisIndex('z')).toBe(2);
		expect(axisIndex('x')).toBe(0);
	});
	it('unionBox spans all', () => {
		expect(unionBox(boxes)).toEqual({ min: [-2.25, 0, 0], max: [4, 1, 1] });
	});
});

describe('distributeDeltas', () => {
	it('even centres keep the outermost two and space the rest evenly (any input order)', () => {
		const boxes = [bx(10, 1), bx(0, 1), bx(7, 3), bx(2, 1)];
		const after = apply(boxes, distributeDeltas(boxes, 0, 'centers'));
		const centres = after.map((b) => edgeOf(b, 0, 'center'));
		expect(centres[1]).toBe(0);
		expect(centres[0]).toBe(10);
		// order by centre: 0 (i1), 2 (i3), 7 (i2), 10 (i0) -> 0, 3.333, 6.667, 10
		expect(centres[3]).toBeCloseTo(10 / 3, 12);
		expect(centres[2]).toBeCloseTo(20 / 3, 12);
	});
	it('even gaps make every empty space between neighbours equal', () => {
		const boxes = [bx(0, 1), bx(1.5, 2), bx(10, 1)]; // spans [-0.5,0.5] [0.5,2.5] [9.5,10.5]
		const after = apply(boxes, distributeDeltas(boxes, 0, 'gaps'));
		const g1 = after[1].min[0] - after[0].max[0];
		const g2 = after[2].min[0] - after[1].max[0];
		expect(g1).toBeCloseTo(g2, 12);
		expect(g1).toBeCloseTo((11 - 4) / 2, 12);
		expect(after[0].min[0]).toBe(-0.5);
		expect(after[2].max[0]).toBe(10.5);
	});
	it('fewer than three boxes: nothing to distribute', () => {
		expect(distributeDeltas([bx(0), bx(5)], 0, 'centers')).toEqual([0, 0]);
	});
	it('equal centres keep a stable order (ties break by input index)', () => {
		const boxes = [bx(0), bx(0), bx(0), bx(9)];
		const d = distributeDeltas(boxes, 0, 'centers');
		expect(d).toEqual([0, 3, 6, 0]);
	});
});
