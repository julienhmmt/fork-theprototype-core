// @ts-nocheck — hand-made fake DOM elements
// 53 A3: which key presses belong to the 3D view. Tab is Edit Mesh ONLY there; on any control it
// is the browser's focus navigation (a fresh load used to trap Tab on <body> forever).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isViewportTarget, tabEditsMesh } from '../../src/lib/keyboardNav.js';

const body = { tagName: 'BODY', closest: () => null };
const html = { tagName: 'HTML', closest: () => null };
const viewport = { tagName: 'DIV', id: 'viewport', closest: () => null };
/** an element whose ancestor chain is `chain` (ids) */
const inside = (tag, chainIds) => ({ tagName: tag, id: '', closest: (sel) => (sel === '#viewport' && chainIds.includes('viewport') ? viewport : null) });

let saved;
beforeAll(() => {
	saved = globalThis.document;
	globalThis.document = { body, documentElement: html };
});
afterAll(() => {
	globalThis.document = saved;
});

describe('isViewportTarget', () => {
	it('body, the document element and the viewport itself are the view', () => {
		expect(isViewportTarget(body)).toBe(true);
		expect(isViewportTarget(html)).toBe(true);
		expect(isViewportTarget(viewport)).toBe(true);
	});
	it('the canvas inside the viewport is the view', () => {
		expect(isViewportTarget(inside('CANVAS', ['viewport']))).toBe(true);
	});
	it('a canvas anywhere else (a preview, the UV editor) is not', () => {
		expect(isViewportTarget(inside('CANVAS', []))).toBe(false);
	});
	it('a focused control is never the view', () => {
		expect(isViewportTarget(inside('BUTTON', []))).toBe(false);
		expect(isViewportTarget(inside('P', []))).toBe(false);
		expect(isViewportTarget(inside('A', []))).toBe(false);
	});
	it('a synthetic dispatch on window / document (no element) reads as the view, as before', () => {
		expect(isViewportTarget(null)).toBe(true);
		expect(isViewportTarget({})).toBe(true);
	});
});

describe('tabEditsMesh', () => {
	it('<body> (a press on the canvas, a blur) keeps Tab as Edit Mesh until a Tab wraps past the last control', () => {
		expect(tabEditsMesh(body)).toBe(true);
	});
	it('the focused viewport, its canvas and a synthetic window dispatch keep Tab as Edit Mesh', () => {
		expect(tabEditsMesh(viewport)).toBe(true);
		expect(tabEditsMesh(inside('CANVAS', ['viewport']))).toBe(true);
		expect(tabEditsMesh(null)).toBe(true);
	});
	it('a control never edits', () => {
		expect(tabEditsMesh(inside('BUTTON', []))).toBe(false);
	});
});
