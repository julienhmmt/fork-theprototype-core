import { describe, it, expect } from 'vitest';
import { resolveTheme, matchRoot } from './helpers/cssTokens.js';
import { contrast, minPairDistance, parseColor, simulate, distance, VISIONS, toHex } from '../../src/lib/ui/colorMath.js';

// 53 A2 — THE TOKEN-CONTRAST GATE. Resolves every theme's tokens straight from theme.css +
// tokens.css (the cascade, specificity included — helpers/cssTokens.js) and measures them:
//  - High contrast: text AAA (7:1) on every surface, every UI part 3:1, every "ink on fill" pair
//    AAA except the two destructive / live fills (AA — they also carry a word).
//  - EVERY theme: the status trio (fine / careful / over) as TEXT reaches AA on every surface,
//    as a FILL reaches 3:1, and stays apart under protanopia, deuteranopia and tritanopia.
// A token edit that breaks any of this fails here, with the pair and the number in the message.

const THEMES = ['dark', 'light', 'green', 'bit8', 'contrast'];
const SURFACES = ['--bg-app', '--surface-1', '--surface-2', '--surface-inset'];
/** how far apart (OKLab) the status trio must stay under every vision — 0.02 is one just-noticeable step */
const FILL_APART = 0.12;
const INK_APART = 0.09;

/** @param {ReturnType<typeof resolveTheme>} T @param {string} fg @param {string[]} on */
function worst(T, fg, on) {
	let min = Infinity;
	let at = '';
	for (const s of on) {
		const r = contrast(T.opaque(fg, s), T.opaque(s));
		if (r < min) {
			min = r;
			at = s;
		}
	}
	return { min, at };
}

describe('the token resolver', () => {
	it('matches :root selectors the way the cascade does, with specificity', () => {
		expect(matchRoot(':root', 'dark')).toBe(1);
		expect(matchRoot(":root[data-theme='light']", 'light')).toBe(2);
		expect(matchRoot(":root[data-theme='light']", 'dark')).toBe(-1);
		expect(matchRoot(":root[data-theme]:not([data-theme='dark']):not([data-theme='light'])", 'contrast')).toBe(4);
		expect(matchRoot(":root[data-theme]:not([data-theme='dark']):not([data-theme='light'])", 'light')).toBe(-1);
		expect(matchRoot(":root:not([data-theme='light'])", 'dark')).toBe(2);
		expect(matchRoot(":root[data-theme^='custom-']", 'custom-1')).toBe(2);
		expect(matchRoot(':root .bg-gray-900', 'dark')).toBe(-1);
	});
	it('resolves var() chains and color-mix the way the browser paints them', () => {
		const T = resolveTheme('contrast');
		// --border-strong = color-mix(in srgb, #fff 70%, #fff)
		expect(toHex(T.opaque('--border-strong'))).toBe('#ffffff');
		// --accent-soft = color-mix(in srgb, #ffd400 24%, #000)
		expect(toHex(T.opaque('--accent-soft'))).toBe('#3d3300');
		// the High contrast block outranks the derived block for a derived name
		expect(toHex(T.opaque('--control-off'))).toBe('#8a8a8a');
		const D = resolveTheme('dark');
		expect(toHex(D.opaque('--status-warn'))).toBe(toHex(D.opaque('--ink-warn')));
	});
});

describe('High contrast theme (53 A2)', () => {
	const T = resolveTheme('contrast');
	const ALL_SURFACES = [...SURFACES, '--surface', '--surface-3', '--field', '--dropdown-bg'];
	const TEXT = ['--text', '--text-2', '--text-muted', '--text-faint', '--accent-text', '--warn-text', '--ink-good', '--ink-warn', '--ink-bad', '--badge-text', '--dropdown-text'];
	for (const fg of TEXT)
		it(`${fg} is AAA (7:1) on every surface`, () => {
			const w = worst(T, fg, ALL_SURFACES);
			expect(w.min, `${fg} on ${w.at}: ${w.min.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
		});
	const PAIRS = /** @type {[string, string, number][]} */ ([
		['--on-accent', '--accent-fill', 7],
		['--accent-soft-text', '--accent-soft', 7],
		['--accent-soft-text', '--accent-muted', 7],
		['--accent-soft-text', '--segment-on', 7],
		['--badge-text', '--badge-bg', 7],
		['--text', '--surface-hover', 7],
		['--text', '--surface-active', 7],
		['--dropdown-text', '--dropdown-hover', 7],
		['--on-danger', '--danger', 7],
		['--on-live', '--live', 7],
		['--code-comment', '--code-bg', 7],
		['--code-text', '--code-bg', 7]
	]);
	for (const [fg, bg, need] of PAIRS)
		it(`${fg} on ${bg} reaches ${need}:1`, () => {
			const r = contrast(T.opaque(fg, bg), T.opaque(bg));
			expect(r, `${fg} on ${bg}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(need);
		});
	const UI = ['--border', '--border-strong', '--border-input', '--accent', '--control-off', '--status-good', '--status-warn', '--status-bad', '--scrollbar-thumb'];
	for (const part of UI)
		it(`${part} (a UI part) is 3:1 on every surface`, () => {
			const w = worst(T, part, ALL_SURFACES);
			expect(w.min, `${part} on ${w.at}: ${w.min.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
		});
	it('the toggle knob reads on both of its tracks', () => {
		expect(contrast(T.opaque('--knob'), T.opaque('--control-off'))).toBeGreaterThanOrEqual(3);
		expect(contrast(T.opaque('--knob'), T.opaque('--accent'))).toBeGreaterThanOrEqual(3);
	});
	it('the 3D view marks read on a black sky and a white wall', () => {
		for (const t of ['--viewport-outline', '--viewport-outline-locked', '--axis-x', '--axis-y', '--axis-z']) {
			expect(contrast(T.opaque(t), [0, 0, 0]), t + ' on black').toBeGreaterThanOrEqual(4.5);
		}
		// the selection edge must also survive a light scene (a white box)
		expect(contrast(T.opaque('--viewport-outline'), [40, 40, 40])).toBeGreaterThanOrEqual(7);
	});
});

describe('colour-blind safe status colours, every theme (53 A2)', () => {
	for (const theme of THEMES) {
		const T = resolveTheme(theme);
		const inks = ['--ink-good', '--ink-warn', '--ink-bad'];
		const fills = ['--status-good', '--status-warn', '--status-bad'];
		for (const ink of inks)
			it(`${theme}: ${ink} is AA text on every surface`, () => {
				const w = worst(T, ink, SURFACES);
				expect(w.min, `${ink} on ${w.at}: ${w.min.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
			});
		for (const fill of fills)
			it(`${theme}: ${fill} is a 3:1 mark on every surface`, () => {
				const w = worst(T, fill, SURFACES);
				expect(w.min, `${fill} on ${w.at}: ${w.min.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
			});
		for (const vision of VISIONS) {
			it(`${theme}: the status fills stay apart for ${vision} vision`, () => {
				const set = fills.map((f) => T.opaque(f));
				const r = minPairDistance(set, vision);
				expect(r.min, `${fills[r.pair[0]]} vs ${fills[r.pair[1]]}: ${r.min.toFixed(3)}`).toBeGreaterThanOrEqual(FILL_APART);
			});
			it(`${theme}: the status inks stay apart for ${vision} vision`, () => {
				const set = inks.map((f) => T.opaque(f));
				const r = minPairDistance(set, vision);
				expect(r.min, `${inks[r.pair[0]]} vs ${inks[r.pair[1]]}: ${r.min.toFixed(3)}`).toBeGreaterThanOrEqual(INK_APART);
			});
		}
	}
	it('the shapes are tokens, and the three status shapes differ', () => {
		const raw = resolveTheme('dark').raw;
		const shapes = ['--shape-ok', '--shape-warn', '--shape-bad'].map((n) => raw.get(n));
		expect(shapes.every(Boolean)).toBe(true);
		expect(new Set(shapes).size).toBe(3);
	});
});

describe('node-editor sockets (53 A2)', () => {
	const TYPES = ['number', 'vector3', 'boolean', 'color', 'object', 'event', 'effect', 'any'];
	for (const theme of THEMES) {
		const T = resolveTheme(theme);
		it(`${theme}: every socket hue is a 3:1 mark on the node card and the pane`, () => {
			for (const t of TYPES) {
				const w = worst(T, '--socket-' + t, ['--surface-2', '--bg-app']);
				expect(w.min, `--socket-${t} on ${w.at}: ${w.min.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
			}
		});
	}
	it('every socket type has its own shape', () => {
		const raw = resolveTheme('dark').raw;
		const shapes = TYPES.map((t) => raw.get('--socket-shape-' + t));
		expect(shapes.every(Boolean)).toBe(true);
		expect(new Set(shapes).size).toBe(TYPES.length);
	});
});

describe('the colour maths', () => {
	it('contrast matches WCAG reference values', () => {
		expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
		expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
		// #767676 on white is the classic 4.54:1 AA threshold grey
		expect(contrast(/** @type {any} */ (parseColor('#767676')), [255, 255, 255])).toBeCloseTo(4.54, 2);
	});
	it('a deuteranope sees red and green as nearly one colour (the reason this lane exists)', () => {
		const red = /** @type {any} */ (parseColor('#d62728'));
		const green = /** @type {any} */ (parseColor('#2ca02c'));
		expect(distance(red, green)).toBeGreaterThan(0.25);
		expect(distance(simulate(red, 'deutan'), simulate(green, 'deutan'))).toBeLessThan(0.12);
		// greys are untouched by every simulation
		for (const v of VISIONS) expect(toHex(simulate([128, 128, 128], v))).toBe('#808080');
	});
	it('the OLD status trios fail the gate this lane holds (the counterfactual)', () => {
		const old = { dark: ['#34d399', '#fbbf24', '#f87171'], light: ['#047857', '#92400e', '#b91c1c'] };
		for (const set of Object.values(old)) {
			const cols = set.map((c) => /** @type {any} */ (parseColor(c)));
			const worstVision = Math.min(...VISIONS.map((v) => minPairDistance(cols, v).min));
			expect(worstVision).toBeLessThan(INK_APART);
		}
	});
});
