// 43 J3 — THE FIELD CLIPBOARD CODEC. A LEAF (imports nothing): what a copied value, vector,
// colour, choice or whole section looks like as TEXT, and how lenient text becomes a value
// again. The menu, the keyboard and the clipboard API live in `fieldMenu.js`; this file is
// the part that is easy to get subtly wrong, so it is pure and vitest-covered.
//
// THE FORMATS (decision, USER-PROMPT 43 — Unity's "Copy component values", Blender's Ctrl+C
// over a field, Houdini's parm copy). Copy writes TWO forms:
//   text  the human/code form, what lands in a notepad or a code editor:
//           one value   1.25
//           a vector    position: 1.25, 0, -3
//           a colour    #ff8800
//           a choice    Median point            (the label the panel shows)
//           a section   {"transform":{"position":[1.25,0,-3],"rotation":[0,90,0],"scale":[1,1,1]}}
//   json  the same thing as `{"<name>": value}` — the app's own paste prefers it.
// Numbers are in the units the PANEL SHOWS (degrees for a rotation): the caller converts at
// the edges, this file never knows about metres or radians.
//
// PASTE IS LENIENT: a number, "x, y, z", "x y z", "Vector3(x, y, z)", "new THREE.Vector3(…)",
// "[x,y,z]", "(x, y, z)", "name: x, y, z", "name = …", {"x":…,"y":…,"z":…}, any of the JSON
// forms above, "name: …" lines (several = a section), #hex / rgb() / 0xhex colours, true/false.
// A vector pastes into ANY vector field. A mismatch is REFUSED with a short reason — a paste
// never half-guesses.

/** @typedef {'number'|'vector'|'color'|'enum'|'bool'|'section'} FieldKind */
/** @typedef {{kind: 'number', value: number, raw?: string}
 *   | {kind: 'vector', value: number[], raw?: string[]}
 *   | {kind: 'list', value: number[], raw?: string[]}
 *   | {kind: 'color', value: string}
 *   | {kind: 'bool', value: boolean}
 *   | {kind: 'text', value: string}
 *   | {kind: 'section', value: Record<string, any>}} Parsed */
/** A parsed clipboard: what it holds plus the name it was copied under (or null).
 * @typedef {Parsed & {name: string|null}} Clip */
/** @typedef {{kind: FieldKind, name?: string, label?: string, options?: {value: any, label?: string}[], keys?: Record<string, SectionKey>}} Target */
/** @typedef {{kind: Exclude<FieldKind, 'section'>, label?: string, aliases?: string[], options?: {value: any, label?: string}[]}} SectionKey */

/** A number as text: at most 6 decimals, no trailing zeros, never "-0". @param {number} n */
export function formatNumber(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '0';
	const fixed = Number(v.toFixed(6));
	return String(fixed === 0 ? 0 : fixed);
}

/** "Position" / "Shadow bias" / "transform" -> the JSON key: camelCase, letters and digits. @param {string} name */
export function keyOf(name) {
	const words = String(name ?? '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
	return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

/** The name two spellings of one key share ("Shadow bias", "shadowBias", "shadow_bias"). @param {string} name */
export function normKey(name) {
	return String(name ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

/** @param {any} value */
function jsonValue(value) {
	if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? Number(formatNumber(v)) : v));
	if (typeof value === 'number') return Number(formatNumber(value));
	if (value && typeof value === 'object') {
		/** @type {Record<string, any>} */
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = jsonValue(v);
		return out;
	}
	return value;
}

/**
 * A field's value as the two clipboard forms.
 * @param {{kind: FieldKind, name?: string, value: any, label?: string}} field
 *   `value` in DISPLAY units; a colour as '#rrggbb'; a choice as its value with `label` the
 *   text the panel shows; a section as `{key: value}` (each value formatted the same way).
 * @returns {{text: string, json: string}}
 */
export function formatField(field) {
	const key = field.name ? keyOf(field.name) : '';
	const wrap = (/** @type {any} */ v) => JSON.stringify(key ? { [key]: jsonValue(v) } : jsonValue(v));
	switch (field.kind) {
		case 'number':
			return { text: formatNumber(field.value), json: wrap(Number(field.value)) };
		case 'vector': {
			const list = (field.value ?? []).map(formatNumber).join(', ');
			return { text: key ? `${key}: ${list}` : list, json: wrap(field.value) };
		}
		case 'color': {
			const hex = normalizeHex(String(field.value)) ?? '#000000';
			return { text: hex, json: wrap(hex) };
		}
		case 'bool':
			return { text: field.value ? 'true' : 'false', json: wrap(!!field.value) };
		case 'enum':
			return { text: String(field.label ?? field.value), json: wrap(field.value) };
		case 'section': {
			const json = wrap(field.value ?? {});
			return { text: json, json };
		}
		default:
			return { text: String(field.value ?? ''), json: wrap(field.value) };
	}
}

/** '#f80' / 'f80' / '#ff8800' / '#ff8800ff' / '0xff8800' -> '#ff8800', else null. @param {string} s */
export function normalizeHex(s) {
	const m = /^(?:#|0x)?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(s ?? '').trim());
	if (!m) return null;
	let h = m[1].toLowerCase();
	if (h.length === 3) h = h.replace(/./g, (c) => c + c);
	return '#' + h.slice(0, 6);
}

/** @param {number[]} rgb 0..1 or 0..255 channels -> '#rrggbb', null when out of range */
function rgbToHex(rgb) {
	if (rgb.length !== 3 || rgb.some((v) => !Number.isFinite(v) || v < 0)) return null;
	const unit = rgb.every((v) => v <= 1);
	if (!unit && rgb.some((v) => v > 255)) return null;
	return '#' + rgb.map((v) => Math.round(unit ? v * 255 : v).toString(16).padStart(2, '0')).join('');
}

// a number, optionally followed by a unit suffix (12cm, 90deg, 90°, 1.5rad)
const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:\s*[a-z°'"]+)?$/i;
const ORDER = /^['"]?[xyz]{3}['"]?$/i; // a three.js Euler order trailing the numbers

/** Value text (no name) -> what it holds. @param {string} s @returns {Parsed} */
function classify(s) {
	const t = s.trim();
	const hex = /^#|^0x/i.test(t) ? normalizeHex(t) : null;
	if (hex) return { kind: 'color', value: hex };
	const rgb = /^rgba?\s*\(([^)]*)\)$/i.exec(t);
	if (rgb) {
		const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
		const h = rgbToHex(parts);
		if (h) return { kind: 'color', value: h };
	}
	if (/^(true|false|on|off|yes|no)$/i.test(t)) return { kind: 'bool', value: /^(true|on|yes)$/i.test(t) };
	// a constructor call or a bracketed list: Vector3(1,2,3), new THREE.Vector3(…), vec3(…),
	// Euler(0, 1.57, 0, 'XYZ'), (1, 2, 3), [1, 2, 3], {1, 2, 3}
	const inner =
		/^(?:new\s+)?(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*\s*\(([\s\S]*)\)$/.exec(t)?.[1] ??
		/^[([{]([\s\S]*)[)\]}]$/.exec(t)?.[1] ??
		t;
	const tokens = inner
		.split(/[\s,;]+/)
		.map((x) => x.trim())
		.filter(Boolean);
	if (tokens.length > 1 && ORDER.test(tokens[tokens.length - 1])) tokens.pop();
	if (tokens.length && tokens.every((x) => NUM.test(x))) {
		const value = tokens.map((x) => parseFloat(x));
		if (value.length === 1) return { kind: 'number', value: value[0], raw: tokens[0] };
		return { kind: value.length === 3 ? 'vector' : 'list', value, raw: tokens };
	}
	return { kind: 'text', value: t };
}

/** A JSON value -> what it holds. @param {any} v @returns {Parsed} */
function classifyJson(v) {
	if (typeof v === 'number') return { kind: 'number', value: v };
	if (typeof v === 'boolean') return { kind: 'bool', value: v };
	if (typeof v === 'string') return classify(v);
	if (Array.isArray(v)) {
		if (v.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
			if (v.length === 1) return { kind: 'number', value: v[0] };
			return { kind: v.length === 3 ? 'vector' : 'list', value: v.slice() };
		}
		return { kind: 'text', value: JSON.stringify(v) };
	}
	if (v && typeof v === 'object') {
		const keys = Object.keys(v);
		const lower = keys.map((k) => k.toLowerCase());
		const pick = (/** @type {string[]} */ names) => names.map((n) => v[keys[lower.indexOf(n)]]);
		if (keys.length === 3 && ['x', 'y', 'z'].every((k) => lower.includes(k))) {
			const xyz = pick(['x', 'y', 'z']);
			if (xyz.every((n) => typeof n === 'number')) return { kind: 'vector', value: xyz };
		}
		if (keys.length === 3 && ['r', 'g', 'b'].every((k) => lower.includes(k))) {
			const h = rgbToHex(pick(['r', 'g', 'b']));
			if (h) return { kind: 'color', value: h };
		}
		return { kind: 'section', value: v };
	}
	return { kind: 'text', value: String(v) };
}

/**
 * A `{name: value}` object with ONE key whose value is a field (not an object) is that field
 * under that name — `{"position":[1,2,3]}` IS a named vector. Anything else stays a section.
 * @param {Parsed} p @param {string|null} name @returns {Clip}
 */
function unwrapNamed(p, name) {
	if (p.kind === 'section') {
		const keys = Object.keys(p.value);
		if (keys.length === 1) {
			const inner = p.value[keys[0]];
			const parsed = classifyJson(inner);
			if (parsed.kind !== 'section') return { ...parsed, name: keys[0] };
			// {"transform": {...}} = a section NAMED transform
			return { kind: 'section', value: inner, name: keys[0] };
		}
	}
	return { ...p, name };
}

/**
 * JSON, or the JavaScript object/array literal a code editor holds: unquoted keys, single
 * quotes, trailing commas. undefined when it is neither.
 * @param {string} t
 */
function parseJsonish(t) {
	try {
		return JSON.parse(t);
	} catch {
		try {
			const relaxed = t
				.replace(/'([^'\\]*)'/g, '"$1"')
				.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
				.replace(/,\s*([}\]])/g, '$1');
			return JSON.parse(relaxed);
		} catch {
			return undefined;
		}
	}
}

const NAMED = /^([A-Za-z_][\w .-]*?)\s*[:=]\s*([\s\S]*)$/;

/**
 * Lenient text -> a clip, or a reason it holds nothing usable.
 * @param {string} text @returns {Clip | {error: string}}
 */
export function parseClipboard(text) {
	const t = String(text ?? '').trim();
	if (!t) return { error: 'The clipboard is empty' };
	if (/^[[{"]/.test(t)) {
		const json = parseJsonish(t);
		if (json !== undefined) return unwrapNamed(classifyJson(json), null);
		// not JSON after all — "(1, 2, 3)" style text falls through
	}
	// `x: 1, y: 2, z: 3` / `roughness: 0.5, metalness: 1` on ONE line = an object literal without braces
	if (/^[A-Za-z_$][\w$]*\s*:[^,]+,\s*[A-Za-z_$][\w$]*\s*:/.test(t)) {
		const json = parseJsonish('{' + t + '}');
		if (json !== undefined) return unwrapNamed(classifyJson(json), null);
	}
	const lines = t
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length > 1) {
		// "transform:" + "position: 1, 2, 3" lines = a section; a bare header line names it
		let sectionName = /** @type {string|null} */ (null);
		/** @type {Record<string, any>} */
		const value = {};
		for (const [i, line] of lines.entries()) {
			const m = NAMED.exec(line.replace(/[,;]$/, ''));
			if (!m) return { error: 'One line is not "name: value": ' + line.slice(0, 40) };
			const rest = m[2].trim();
			if (!rest && i === 0) {
				sectionName = m[1].trim();
				continue;
			}
			value[m[1].trim()] = classify(rest.replace(/^["']|["']$/g, '')).value;
		}
		return { kind: 'section', value, name: sectionName };
	}
	const named = NAMED.exec(t);
	if (named && !/^(?:rgb|hsl)a?$/i.test(named[1]) && named[2].trim()) {
		const rest = named[2].trim();
		if (/^[[{"]/.test(rest)) {
			const json = parseJsonish(rest);
			if (json !== undefined) return { ...unwrapNamed(classifyJson(json), named[1].trim()) };
		}
		return { ...classify(rest), name: named[1].trim() };
	}
	return { ...classify(t), name: null };
}

/** @param {Clip} clip */
function holds(clip) {
	switch (clip.kind) {
		case 'number':
			return 'one number';
		case 'vector':
			return 'a vector (x, y, z)';
		case 'list':
			return `${clip.value.length} values`;
		case 'color':
			return 'a colour';
		case 'bool':
			return 'true/false';
		case 'section': {
			const keys = Object.keys(clip.value);
			return `a section (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''})`;
		}
		default:
			return `"${String(clip.value).slice(0, 24)}"`;
	}
}

/** The entry of `obj` whose key reads like `name` (or one of its aliases). @param {Record<string, any>} obj @param {string[]} names */
function entryFor(obj, names) {
	const want = new Set(names.map(normKey).filter(Boolean));
	for (const [k, v] of Object.entries(obj)) if (want.has(normKey(k))) return { key: k, value: v };
	return null;
}

/**
 * A clip -> the value for ONE field, or why not.
 * @param {Clip} clip @param {Target | SectionKey & {name?: string}} target
 * @returns {{ok: true, value: any, raw?: any} | {ok: false, reason: string}}
 */
export function coerce(clip, target) {
	const no = (/** @type {string} */ reason) => /** @type {{ok: false, reason: string}} */ ({ ok: false, reason });
	// a section copied whole still answers a single row whose name it carries
	if (clip.kind === 'section' && target.kind !== 'section') {
		const names = [target.name ?? '', target.label ?? '', ...(/** @type {any} */ (target).aliases ?? [])];
		const hit = entryFor(clip.value, names);
		if (!hit) return no(`The clipboard holds ${holds(clip)} — paste it on a section header`);
		return coerce({ ...classifyJson(hit.value), name: hit.key }, target);
	}
	switch (target.kind) {
		case 'number': {
			if (clip.kind === 'number') return { ok: true, value: clip.value, raw: clip.raw };
			if (clip.kind === 'bool') return { ok: true, value: clip.value ? 1 : 0 };
			return no(`Expected one number — the clipboard holds ${holds(clip)}`);
		}
		case 'vector': {
			if (clip.kind === 'vector') return { ok: true, value: clip.value.slice(0, 3), raw: clip.raw };
			if (clip.kind === 'list') return no(`Expected 3 values (x, y, z), got ${clip.value.length}`);
			return no(`Expected x, y, z — the clipboard holds ${holds(clip)}`);
		}
		case 'color': {
			if (clip.kind === 'color') return { ok: true, value: clip.value };
			if (clip.kind === 'vector') {
				const h = rgbToHex(clip.value);
				if (h) return { ok: true, value: h };
			}
			if (clip.kind === 'text') {
				const h = normalizeHex(clip.value);
				if (h) return { ok: true, value: h };
			}
			return no(`Expected a colour (#rrggbb) — the clipboard holds ${holds(clip)}`);
		}
		case 'bool': {
			if (clip.kind === 'bool') return { ok: true, value: clip.value };
			if (clip.kind === 'number' && (clip.value === 0 || clip.value === 1)) return { ok: true, value: clip.value === 1 };
			return no(`Expected on/off — the clipboard holds ${holds(clip)}`);
		}
		case 'enum': {
			const options = target.options ?? [];
			if (clip.kind === 'section' || clip.kind === 'vector' || clip.kind === 'list')
				return no(`Expected one choice — the clipboard holds ${holds(clip)}`);
			const want = String(clip.value).trim().toLowerCase();
			const hit =
				options.find((o) => String(o.value).toLowerCase() === want) ??
				options.find((o) => String(o.label ?? '').toLowerCase() === want);
			if (hit) return { ok: true, value: hit.value };
			const names = options.map((o) => o.label ?? String(o.value));
			return no(`"${String(clip.value).slice(0, 24)}" is not one of: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}`);
		}
		case 'section':
			return coerceSection(clip, /** @type {Target} */ (target));
		default:
			return no('This field cannot take a paste');
	}
}

/**
 * A clip -> the MATCHING keys of a section, each coerced to its row's kind. Keys the target
 * does not have are skipped (reported), keys that are there but the wrong shape refuse the
 * whole paste: a section paste is one undo step, so it is all or nothing.
 * @param {Clip} clip @param {Target} target
 * @returns {{ok: true, value: Record<string, any>, skipped: string[]} | {ok: false, reason: string}}
 */
export function coerceSection(clip, target) {
	const keys = target.keys ?? {};
	const label = target.label ?? target.name ?? 'this section';
	/** @type {Record<string, any>} */
	let source;
	if (clip.kind === 'section') source = clip.value;
	else if (clip.name) source = { [clip.name]: clip.value };
	else return { ok: false, reason: `The clipboard holds ${holds(clip)} — paste it on a row, not the ${label} header` };
	/** @type {Record<string, any>} */
	const value = {};
	const skipped = [];
	for (const [k, v] of Object.entries(source)) {
		const match = Object.entries(keys).find(([key, spec]) => [key, spec.label ?? '', ...(spec.aliases ?? [])].some((n) => normKey(n) === normKey(k)));
		if (!match) {
			skipped.push(k);
			continue;
		}
		const [key, spec] = match;
		const res = coerce({ ...classifyJson(v), name: k }, { ...spec, name: key });
		if (!res.ok) return { ok: false, reason: `${spec.label ?? key}: ${res.reason}` };
		value[key] = res.value;
	}
	if (!Object.keys(value).length) return { ok: false, reason: `Nothing in the clipboard matches ${label}` };
	return { ok: true, value, skipped };
}

/** Text straight to a field value (parse + coerce). @param {string} text @param {Target} target */
export function parseFor(text, target) {
	const clip = parseClipboard(text);
	if ('error' in clip) return { ok: /** @type {const} */ (false), reason: clip.error };
	return coerce(clip, target);
}

/**
 * One component of a vector clip — "Paste X only". Takes the matching component of a vector
 * (or of a named vector inside a section), or a lone number as it is.
 * @param {string} text @param {number} index 0..2 @param {string} [name] the vector row's name
 */
export function parseComponent(text, index, name) {
	const clip = parseClipboard(text);
	if ('error' in clip) return { ok: /** @type {const} */ (false), reason: clip.error };
	if (clip.kind === 'number') return { ok: /** @type {const} */ (true), value: clip.value, raw: clip.raw };
	const res = coerce(clip, { kind: 'vector', name });
	if (!res.ok) return res;
	return { ok: /** @type {const} */ (true), value: res.value[index], raw: res.raw?.[index] };
}

