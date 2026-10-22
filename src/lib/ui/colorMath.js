// 53 A2 — COLOUR MATHS for the accessibility checks (a LEAF: imports nothing).
//
// Three questions the High contrast theme and the colour-blind safe status set are judged by,
// asked of plain sRGB colours so a unit test can answer them with no browser:
//  - contrast(a, b): the WCAG 2.x ratio (1..21). AA = 4.5 for text, 3 for UI parts and large text;
//    AAA = 7 for text.
//  - simulate(c, kind): what a person with protanopia / deuteranopia / tritanopia sees — the
//    Machado, Oliveira & Fernandes 2009 matrices at severity 1.0, applied in LINEAR light (the
//    paper's space; applying them to gamma-encoded bytes darkens every result).
//  - distance(a, b): the Euclidean distance in OKLab (0..~1). ~0.02 is a just-noticeable step;
//    the status set asks for far more than that between every pair, under every vision.
// The same matrices drive the A/B screenshots' simulated views, so the test and the pictures
// agree on what "a deuteranope sees" means.

/** @typedef {[number, number, number]} RGB 0..255 sRGB */
/** @typedef {'normal' | 'protan' | 'deutan' | 'tritan'} Vision */

/** @type {Vision[]} */
export const VISIONS = ['normal', 'protan', 'deutan', 'tritan'];

/** Machado 2009, severity 1.0 — row-major 3x3, linear RGB in, linear RGB out */
export const CVD_MATRICES = {
	protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
	deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
	tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039]
};

/**
 * Parse '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(r g b)' / 'rgb(r, g, b)' (alpha ignored here — see
 * parseColorAlpha). Returns null for anything else.
 * @param {string} css @returns {RGB | null}
 */
export function parseColor(css) {
	const c = parseColorAlpha(css);
	return c ? [c[0], c[1], c[2]] : null;
}

/** @param {string} css @returns {[number, number, number, number] | null} r g b 0..255, a 0..1 */
export function parseColorAlpha(css) {
	if (typeof css !== 'string') return null;
	const s = css.trim().toLowerCase();
	let m = s.match(/^#([0-9a-f]{3,8})$/);
	if (m) {
		let h = m[1];
		if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
		if (h.length !== 6 && h.length !== 8) return null;
		const n = (/** @type {number} */ i) => parseInt(h.slice(i, i + 2), 16);
		return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
	}
	m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
	if (m) {
		let a = 1;
		if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		return [+m[1], +m[2], +m[3], a];
	}
	if (s === 'white') return [255, 255, 255, 1];
	if (s === 'black') return [0, 0, 0, 1];
	if (s === 'transparent') return [0, 0, 0, 0];
	return null;
}

/** @param {RGB} c @returns {string} */
export function toHex(c) {
	return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** @param {number} v 0..255 @returns {number} 0..1 linear */
function toLinear(v) {
	const x = v / 255;
	return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
/** @param {number} x 0..1 linear @returns {number} 0..255 */
function fromLinear(x) {
	const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
	return Math.max(0, Math.min(255, v * 255));
}

/** WCAG relative luminance @param {RGB} c */
export function luminance(c) {
	return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}

/** WCAG 2.x contrast ratio @param {RGB} a @param {RGB} b */
export function contrast(a, b) {
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Paint `top` (alpha a) over an opaque `bottom` @param {[number, number, number, number]} top @param {RGB} bottom @returns {RGB} */
export function over(top, bottom) {
	const a = top[3];
	return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a)];
}

/** color-mix(in srgb, a p, b) — p = the share of a, 0..1 @param {RGB} a @param {RGB} b @param {number} p @returns {RGB} */
export function mixSrgb(a, b, p) {
	return [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)];
}

/** @param {RGB} c @param {Vision} kind @returns {RGB} */
export function simulate(c, kind) {
	if (kind === 'normal') return [c[0], c[1], c[2]];
	const m = CVD_MATRICES[kind];
	const l = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
	return [
		fromLinear(m[0] * l[0] + m[1] * l[1] + m[2] * l[2]),
		fromLinear(m[3] * l[0] + m[4] * l[1] + m[5] * l[2]),
		fromLinear(m[6] * l[0] + m[7] * l[1] + m[8] * l[2])
	];
}

/** sRGB -> OKLab (Ottosson) @param {RGB} c @returns {[number, number, number]} */
export function oklab(c) {
	const r = toLinear(c[0]);
	const g = toLinear(c[1]);
	const b = toLinear(c[2]);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

/** OKLab Euclidean distance @param {RGB} a @param {RGB} b */
export function distance(a, b) {
	const p = oklab(a);
	const q = oklab(b);
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * The smallest OKLab distance between any two colours of a set, under one vision.
 * @param {RGB[]} colors @param {Vision} kind
 * @returns {{min: number, pair: [number, number]}}
 */
export function minPairDistance(colors, kind) {
	let min = Infinity;
	/** @type {[number, number]} */
	let pair = [0, 0];
	const sim = colors.map((c) => simulate(c, kind));
	for (let i = 0; i < sim.length; i++)
		for (let j = i + 1; j < sim.length; j++) {
			const d = distance(sim[i], sim[j]);
			if (d < min) {
				min = d;
				pair = [i, j];
			}
		}
	return { min, pair };
}
