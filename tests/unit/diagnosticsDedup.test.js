// 44 L4 — the diagnostics ring folds a REPEAT of the line before it into that line with a count. The
// user's 1.34 bundle was 199 lines, 180 of them one svelte-put/shortcut warning: the flood pushed the
// lines that explain a failure out of a 300-line ring. A repeat is the SAME level, scope, message and
// data as the entry before it (the browser console's rule); anything in between starts a new line.
import { describe, it, expect, beforeEach } from 'vitest';
import { log, lines, clearDiagnostics, bundle } from '$lib/diagnostics.js';

const WARN = '[svelte-put/shortcut] Trigger should have either `key` or `code`, a trigger missing both was detected! Check your configuration';

describe('diagnostics: repeated identical lines', () => {
	beforeEach(() => clearDiagnostics());

	it('folds a run of identical warnings into ONE line with a count', () => {
		for (let i = 0; i < 180; i++) log('warn', 'console', WARN);
		const out = lines();
		expect(out).toHaveLength(1);
		expect(out[0]).toContain(WARN);
		expect(out[0]).toMatch(/×180\b/);
	});

	it('keeps the lines around a flood readable, in order', () => {
		log('info', 'app', 'started');
		for (let i = 0; i < 50; i++) log('warn', 'console', WARN);
		log('error', 'window', 'boom');
		for (let i = 0; i < 3; i++) log('warn', 'console', WARN);
		const out = lines();
		expect(out).toHaveLength(4);
		expect(out[0]).toContain('started');
		expect(out[1]).toMatch(/×50\b/);
		expect(out[2]).toContain('boom');
		expect(out[3]).toMatch(/×3\b/);
	});

	it('a single line carries no count, and a different level / scope / data is a new line', () => {
		log('warn', 'console', WARN);
		log('error', 'console', WARN);
		log('error', 'peer', WARN);
		log('error', 'peer', WARN, { a: 1 });
		log('error', 'peer', WARN, { a: 2 });
		const out = lines();
		expect(out).toHaveLength(5);
		expect(out.some((l) => /×\d/.test(l))).toBe(false);
	});

	it('a flood no longer evicts the ring (the 300-line cap)', () => {
		log('error', 'window', 'the failure that matters');
		for (let i = 0; i < 1000; i++) log('warn', 'console', WARN);
		const out = bundle().lines;
		expect(out[0]).toContain('the failure that matters');
		expect(out).toHaveLength(2);
	});
});
