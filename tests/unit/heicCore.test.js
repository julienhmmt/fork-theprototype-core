// 46-media H1 — HEIC detection and naming (the pure half), against the committed fixture.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isHeicFileLike, sniffHeic, decodedName, extOf, fitWithin, HEIC_MAX_SIDE } from '../../src/lib/heicCore.js';

const FIXTURE = path.resolve(__dirname, '../fixtures/heic/quadrants.heic');

/** an ftyp box: major brand + compatible brands @param {string} major @param {string[]} compat */
function ftyp(major, compat) {
	const brands = [major, '\0\0\0\0', ...compat].join('');
	const size = 8 + brands.length;
	const b = new Uint8Array(size + 8);
	b.set([0, 0, 0, size], 0);
	b.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
	b.set([...brands].map((c) => c.charCodeAt(0)), 8);
	return b;
}

describe('heicCore', () => {
	it('knows a HEIC by name or type, case-insensitively', () => {
		expect(isHeicFileLike({ name: 'IMG_0042.HEIC', type: '' })).toBe(true);
		expect(isHeicFileLike({ name: 'x.heif' })).toBe(true);
		expect(isHeicFileLike({ name: 'canon.HIF' })).toBe(true);
		expect(isHeicFileLike({ name: 'photo', type: 'image/heic' })).toBe(true);
		expect(isHeicFileLike({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
		expect(isHeicFileLike({ name: 'a.avif', type: 'image/avif' })).toBe(false);
	});
	it('sniffs the committed fixture, and HEVC brands but not AVIF', () => {
		const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
		expect(bytes.length).toBeLessThan(4096); // "small, committed"
		expect(sniffHeic(bytes)).toBe(true);
		expect(sniffHeic(ftyp('heic', ['mif1']))).toBe(true);
		expect(sniffHeic(ftyp('mif1', ['heic']))).toBe(true);
		expect(sniffHeic(ftyp('mif1', ['avif', 'miaf']))).toBe(false);
		expect(sniffHeic(ftyp('avif', ['mif1']))).toBe(false);
		expect(sniffHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
		expect(sniffHeic(new Uint8Array(4))).toBe(false);
	});
	it('names the decoded photo .jpg', () => {
		expect(decodedName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
		expect(decodedName('trip.photo.heif')).toBe('trip.photo.jpg');
		expect(decodedName('noext')).toBe('noext.jpg');
		expect(decodedName('')).toBe('photo.jpg');
		expect(extOf('a/b.c/IMG.HeIc')).toBe('heic');
	});
	it('fits a huge photo inside the cap and never scales up', () => {
		expect(fitWithin(12000, 9000)).toEqual({ width: HEIC_MAX_SIDE, height: 6144, scale: HEIC_MAX_SIDE / 12000 });
		expect(fitWithin(96, 64)).toEqual({ width: 96, height: 64, scale: 1 });
	});
});
