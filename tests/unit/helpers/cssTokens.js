// 53 A2 — resolve the THEME TOKENS from the stylesheets that define them, with no browser.
//
// `resolveTheme(id)` answers "what colour is --x in theme id" the way the cascade does: every
// rule whose selector is a bare :root form (`:root`, `:root[data-theme='light']`,
// `:root[data-theme]:not([data-theme='dark'])…`) is matched against <html data-theme="id">,
// declarations are ordered by SPECIFICITY then source order (theme.css before tokens.css, the
// app.css import order — both sit in one layer), and the winner is resolved through var(),
// var() fallbacks and color-mix(in srgb, …). Specificity matters here: tokens.css's derived
// block for the exotic themes is (0,4,0), so a plain `:root[data-theme='contrast']` (0,2,0)
// value for the same token LOSES to it — exactly what the browser does.
// @media blocks are skipped (the only ones in these files are size/density, never colour).

import fs from 'node:fs';
import path from 'node:path';
import { parseColorAlpha, mixSrgb, over } from '../../../src/lib/ui/colorMath.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
export const TOKEN_FILES = ['src/styles/theme.css', 'src/styles/tokens.css'];

/** @typedef {{name: string, value: string, spec: number, order: number, sel: string}} Decl */

/** @param {string} css */
function stripComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** top-level `selector { body }` blocks; nested @media blocks are skipped whole
 * @param {string} css @returns {{sel: string, body: string}[]} */
function topRules(css) {
	/** @type {{sel: string, body: string}[]} */
	const out = [];
	let i = 0;
	while (i < css.length) {
		const open = css.indexOf('{', i);
		if (open < 0) break;
		const sel = css.slice(i, open).trim();
		let depth = 1;
		let j = open + 1;
		while (j < css.length && depth > 0) {
			if (css[j] === '{') depth++;
			else if (css[j] === '}') depth--;
			j++;
		}
		const body = css.slice(open + 1, j - 1);
		// the last statement before the selector may be an @font-face/@import; keep the selector tail
		const tail = sel.split(';').pop()?.trim() ?? '';
		if (!tail.startsWith('@')) out.push({ sel: tail, body });
		i = j;
	}
	return out;
}

/**
 * Does one selector (a bare :root form) match <html data-theme=theme>? Returns its specificity
 * (attribute selectors + pseudo-classes, :not counting its argument) or -1.
 * @param {string} sel @param {string} theme @returns {number}
 */
export function matchRoot(sel, theme) {
	const s = sel.replace(/\s+/g, '');
	if (!/^:root(?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*$/.test(s)) return -1;
	let spec = 1;
	const attrs = [...s.matchAll(/(:not\()?\[([^\]]+)\]/g)];
	for (const m of attrs) {
		spec++;
		const neg = !!m[1];
		const body = m[2];
		let ok;
		const am = body.match(/^([\w-]+)(?:([\^$*]?=)['"]?([^'"]*)['"]?)?$/);
		if (!am) return -1;
		const [, attr, op, val] = am;
		if (attr !== 'data-theme') ok = false; // data-density etc.: not modelled — treat as absent
		else if (!op) ok = true;
		else if (op === '=') ok = theme === val;
		else if (op === '^=') ok = theme.startsWith(val);
		else ok = false;
		if (neg ? ok : !ok) return -1;
	}
	return spec;
}

/** @returns {{decls: Decl[]}} every custom-property declaration on a bare :root rule */
function loadDecls() {
	/** @type {Decl[]} */
	const decls = [];
	let order = 0;
	for (const f of TOKEN_FILES) {
		const css = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
		for (const rule of topRules(css)) {
			const sels = rule.sel.split(',').map((x) => x.trim());
			if (!sels.every((x) => x.startsWith(':root'))) continue;
			for (const m of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
				order++;
				for (const sel of sels) decls.push({ name: m[1], value: m[2].trim(), spec: 0, order, sel });
			}
		}
	}
	return { decls };
}

let cache = /** @type {{decls: Decl[]} | null} */ (null);

/** The raw (unresolved) winning value of every token in a theme @param {string} theme @returns {Map<string, string>} */
export function rawTheme(theme) {
	cache ??= loadDecls();
	/** @type {Map<string, {value: string, spec: number, order: number}>} */
	const win = new Map();
	for (const d of cache.decls) {
		const spec = matchRoot(d.sel, theme);
		if (spec < 0) continue;
		const prev = win.get(d.name);
		if (!prev || spec > prev.spec || (spec === prev.spec && d.order >= prev.order)) win.set(d.name, { value: d.value, spec, order: d.order });
	}
	return new Map([...win].map(([k, v]) => [k, v.value]));
}

/** split a function's argument list at top-level commas @param {string} s @returns {string[]} */
function splitArgs(s) {
	/** @type {string[]} */
	const out = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	out.push(cur.trim());
	return out;
}

/**
 * Resolve a value to an RGBA colour (alpha kept), or null when it is not a colour.
 * @param {string} value @param {Map<string, string>} raw @param {number} [depth]
 * @returns {[number, number, number, number] | null}
 */
export function resolveValue(value, raw, depth = 0) {
	if (depth > 20) return null;
	const v = value.trim();
	const fn = v.match(/^([\w-]+)\((.*)\)$/s);
	if (fn && fn[1] === 'var') {
		const [name, ...rest] = splitArgs(fn[2]);
		const own = raw.get(name);
		if (own !== undefined) return resolveValue(own, raw, depth + 1);
		return rest.length ? resolveValue(rest.join(','), raw, depth + 1) : null;
	}
	if (fn && fn[1] === 'color-mix') {
		const [space, a, b] = splitArgs(fn[2]);
		if (!/in srgb/.test(space)) return null;
		/** @param {string} part */
		const parse = (part) => {
			const pm = part.match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
			return { color: resolveValue(pm?.[1] ?? part, raw, depth + 1), pct: pm?.[2] !== undefined ? +pm[2] / 100 : null };
		};
		const pa = parse(a);
		const pb = parse(b);
		if (!pa.color || !pb.color) return null;
		const p = pa.pct ?? (pb.pct !== null ? 1 - pb.pct : 0.5);
		// premultiplied mix of alpha too (transparent mixes come out translucent)
		const alpha = pa.color[3] * p + pb.color[3] * (1 - p);
		const rgb = mixSrgb([pa.color[0], pa.color[1], pa.color[2]], [pb.color[0], pb.color[1], pb.color[2]], p);
		return [rgb[0], rgb[1], rgb[2], alpha];
	}
	return parseColorAlpha(v);
}

/**
 * Every colour token of a theme, resolved. Translucent tokens keep their alpha; `opaque(name, on)`
 * paints one over a surface.
 * @param {string} theme
 */
export function resolveTheme(theme) {
	const raw = rawTheme(theme);
	/** @type {Map<string, [number, number, number, number]>} */
	const colors = new Map();
	for (const [name, value] of raw) {
		const c = resolveValue(value, raw);
		if (c) colors.set(name, c);
	}
	/** @param {string} name @returns {[number, number, number, number]} */
	const get = (name) => {
		const c = colors.get(name);
		if (!c) throw new Error(`${theme}: ${name} does not resolve to a colour (raw: ${raw.get(name)})`);
		return c;
	};
	/** the token as an opaque colour, painted over `on` (another token) when translucent
	 * @param {string} name @param {string} [on] @returns {[number, number, number]} */
	const opaque = (name, on = '--surface-1') => {
		const c = get(name);
		if (c[3] >= 0.999) return [c[0], c[1], c[2]];
		const base = opaque(on, '--bg-app');
		return over(c, base);
	};
	return { raw, colors, get, opaque };
}
