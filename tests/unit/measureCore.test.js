import { describe, it, expect } from 'vitest';
import { chainStats, jointAngle, formatLength, formatAngle, chainLabels, segmentDelta } from '../../src/lib/measureCore.js';

// 47 M1: the Measure tool's arithmetic — chain lengths, the angle between segments, the labels.

describe('chainStats', () => {
	it('sums the segments of a chain and reads the turn at each joint', () => {
		// three corners of a 2 x 1 rectangle: 2 m along x, then 1 m along z — a right angle
		const s = chainStats([
			[0, 0, 0],
			[2, 0, 0],
			[2, 0, 1]
		]);
		expect(s.segments).toEqual([2, 1]);
		expect(s.total).toBe(3);
		expect(s.angles).toHaveLength(1);
		expect(s.angles[0]).toBeCloseTo(90, 9);
	});
	it('has no segment or angle for one point, and no angle for two', () => {
		expect(chainStats([[1, 2, 3]])).toEqual({ segments: [], total: 0, angles: [] });
		const two = chainStats([
			[0, 0, 0],
			[0, 3, 4]
		]);
		expect(two.segments).toEqual([5]);
		expect(two.angles).toEqual([]);
	});
	it('a straight run reads 180 degrees and a fold-back reads 0', () => {
		expect(jointAngle([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeCloseTo(180, 9);
		expect(jointAngle([0, 0, 0], [1, 0, 0], [0.5, 0, 0])).toBeCloseTo(0, 6);
		expect(jointAngle([1, 0, 0], [0, 0, 0], [1, 1, 0])).toBeCloseTo(45, 9);
	});
	it('a zero-length segment (a double click on one spot) has no angle, never NaN', () => {
		expect(jointAngle([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();
		const s = chainStats([
			[0, 0, 0],
			[1, 0, 0],
			[1, 0, 0]
		]);
		expect(s.angles).toEqual([null]);
		expect(formatAngle(s.angles[0])).toBe('—');
	});
});

describe('formatting', () => {
	it('metres to the millimetre under 10 m, centimetres above', () => {
		expect(formatLength(1)).toBe('1.000 m');
		expect(formatLength(0.0254)).toBe('0.025 m');
		expect(formatLength(12.345)).toBe('12.35 m');
		expect(formatLength(NaN)).toBe('—');
	});
	it('degrees to one decimal', () => {
		expect(formatAngle(90)).toBe('90.0°');
		expect(formatAngle(null)).toBe('—');
	});
	it('segmentDelta is b minus a per axis', () => {
		expect(segmentDelta([1, 2, 3], [2, 2, 1])).toEqual([1, 0, -2]);
	});
});

describe('chainLabels', () => {
	const chain = [
		[0, 0, 0],
		[2, 0, 0],
		[2, 0, 1],
		[0, 0, 1]
	];
	it('labels every segment at its midpoint, every joint with its angle, and the total at the end', () => {
		const labels = chainLabels(chain, 'c');
		const segments = labels.filter((l) => l.kind === 'segment');
		const angles = labels.filter((l) => l.kind === 'angle');
		const totals = labels.filter((l) => l.kind === 'total');
		expect(segments.map((l) => l.text)).toEqual(['2.000 m', '1.000 m', '2.000 m']);
		expect(segments[0].point).toEqual([1, 0, 0]);
		expect(angles.map((l) => l.text)).toEqual(['90.0°', '90.0°']);
		expect(angles[0].point).toEqual([2, 0, 0]);
		expect(totals).toHaveLength(1);
		expect(totals[0].text).toBe('Total 5.000 m');
		expect(totals[0].point).toEqual([0, 0, 1]);
	});
	it('a single segment has no total; keys are stable per chain and index', () => {
		const labels = chainLabels(chain.slice(0, 2), 'p1');
		expect(labels.map((l) => l.key)).toEqual(['p1:s0']);
		expect(chainLabels(chain, 'p1').map((l) => l.key)).toEqual(['p1:s0', 'p1:s1', 'p1:s2', 'p1:a0', 'p1:a1', 'p1:t']);
	});
});
