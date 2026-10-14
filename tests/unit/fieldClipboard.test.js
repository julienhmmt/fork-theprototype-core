// 43 J3 — the field clipboard codec: every text form a paste accepts, and every refusal.
import { describe, expect, it } from 'vitest';
import {
	coerce,
	coerceSection,
	formatField,
	formatNumber,
	keyOf,
	normalizeHex,
	parseClipboard,
	parseComponent,
	parseFor
} from '../../src/lib/fieldClipboard.js';

const VEC = { kind: /** @type {const} */ ('vector'), name: 'Position' };
const NUM = { kind: /** @type {const} */ ('number'), name: 'Roughness' };
const TRANSFORM = {
	kind: /** @type {const} */ ('section'),
	label: 'Transform',
	keys: {
		position: { kind: /** @type {const} */ ('vector'), label: 'Position' },
		rotation: { kind: /** @type {const} */ ('vector'), label: 'Rotation' },
		scale: { kind: /** @type {const} */ ('vector'), label: 'Scale' }
	}
};

describe('format', () => {
	it('numbers: 6 decimals at most, no trailing zeros, never -0', () => {
		expect(formatNumber(1.25)).toBe('1.25');
		expect(formatNumber(90.00000000000001)).toBe('90');
		expect(formatNumber(-0)).toBe('0');
		expect(formatNumber(-0.0000001)).toBe('0');
		expect(formatNumber(1 / 3)).toBe('0.333333');
		expect(formatNumber(NaN)).toBe('0');
	});
	it('names become camelCase JSON keys', () => {
		expect(keyOf('Position')).toBe('position');
		expect(keyOf('Shadow bias')).toBe('shadowBias');
		expect(keyOf('shadowBias')).toBe('shadowBias');
		expect(keyOf('Sky / ground')).toBe('skyGround');
	});
	it('a value, a vector, a colour, a choice, a toggle and a section (the decision forms)', () => {
		expect(formatField({ kind: 'number', name: 'Roughness', value: 1.25 })).toEqual({ text: '1.25', json: '{"roughness":1.25}' });
		expect(formatField({ kind: 'vector', name: 'Position', value: [1.25, 0, -3] })).toEqual({
			text: 'position: 1.25, 0, -3',
			json: '{"position":[1.25,0,-3]}'
		});
		expect(formatField({ kind: 'vector', value: [1, 2, 3] }).text).toBe('1, 2, 3');
		expect(formatField({ kind: 'color', name: 'Color', value: '#FF8800' })).toEqual({ text: '#ff8800', json: '{"color":"#ff8800"}' });
		expect(formatField({ kind: 'enum', name: 'Pivot', value: 'median', label: 'Median point' })).toEqual({
			text: 'Median point',
			json: '{"pivot":"median"}'
		});
		expect(formatField({ kind: 'bool', name: 'Cast shadow', value: true }).json).toBe('{"castShadow":true}');
		const section = formatField({
			kind: 'section',
			name: 'Transform',
			value: { position: [1.25, 0, -3], rotation: [0, 90.00000000001, 0], scale: [1, 1, 1] }
		});
		expect(section.text).toBe('{"transform":{"position":[1.25,0,-3],"rotation":[0,90,0],"scale":[1,1,1]}}');
		expect(section.json).toBe(section.text);
	});
	it('every copy form parses back to the same value', () => {
		const v = formatField({ kind: 'vector', name: 'Position', value: [1.25, 0, -3] });
		expect(parseFor(v.text, VEC)).toMatchObject({ ok: true, value: [1.25, 0, -3] });
		expect(parseFor(v.json, VEC)).toMatchObject({ ok: true, value: [1.25, 0, -3] });
		const s = formatField({ kind: 'section', name: 'Transform', value: { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] } });
		expect(coerceSection(/** @type {any} */ (parseClipboard(s.text)), TRANSFORM)).toMatchObject({
			ok: true,
			value: { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] }
		});
	});
});

describe('paste — every accepted vector form', () => {
	const forms = [
		'1, 2, 3',
		'1,2,3',
		'1 2 3',
		'1; 2; 3',
		'Vector3(1, 2, 3)',
		'Vector3(1,2,3)',
		'new THREE.Vector3(1, 2, 3)',
		'new Vector3(1, 2, 3)',
		'vec3(1, 2, 3)',
		'float3(1, 2, 3)',
		'(1, 2, 3)',
		'[1, 2, 3]',
		'[1,2,3]',
		'{1, 2, 3}',
		'position: 1, 2, 3',
		'Position: 1, 2, 3',
		'scale = 1, 2, 3',
		'position: [1, 2, 3]',
		'position: Vector3(1, 2, 3)',
		'{"position":[1,2,3]}',
		'{"x":1,"y":2,"z":3}',
		'{ x: 1, y: 2, z: 3 }',
		'x: 1, y: 2, z: 3',
		"Euler(1, 2, 3, 'XYZ')",
		'  1, 2, 3  \n'
	];
	for (const text of forms)
		it(JSON.stringify(text), () => {
			expect(parseFor(text, VEC)).toMatchObject({ ok: true, value: [1, 2, 3] });
		});
	it('a vector copied from ANY vector row pastes into another (rotation -> position)', () => {
		expect(parseFor('rotation: 0, 90, 0', VEC)).toMatchObject({ ok: true, value: [0, 90, 0] });
	});
	it('negatives, decimals and exponents', () => {
		expect(parseFor('-1.5, .25, 1e-3', VEC)).toMatchObject({ ok: true, value: [-1.5, 0.25, 0.001] });
	});
	it('unit suffixes keep their raw token for the caller', () => {
		const res = /** @type {any} */ (parseFor('12cm, 0, 4in', VEC));
		expect(res.ok).toBe(true);
		expect(res.raw).toEqual(['12cm', '0', '4in']);
	});
	it('a whole section answers a vector row by its name', () => {
		const s = '{"transform":{"position":[1,2,3],"rotation":[0,90,0],"scale":[1,1,1]}}';
		expect(parseFor(s, VEC)).toMatchObject({ ok: true, value: [1, 2, 3] });
		expect(parseFor(s, { kind: 'vector', name: 'Rotation' })).toMatchObject({ ok: true, value: [0, 90, 0] });
	});
});

describe('paste — numbers, colours, choices, toggles', () => {
	it('numbers', () => {
		expect(parseFor('1.25', NUM)).toMatchObject({ ok: true, value: 1.25 });
		expect(parseFor('roughness: 0.4', NUM)).toMatchObject({ ok: true, value: 0.4 });
		expect(parseFor('{"roughness":0.4}', NUM)).toMatchObject({ ok: true, value: 0.4 });
		expect(parseFor('[7]', NUM)).toMatchObject({ ok: true, value: 7 });
		expect(parseFor('90°', NUM)).toMatchObject({ ok: true, value: 90, raw: '90°' });
		expect(parseFor('true', NUM)).toMatchObject({ ok: true, value: 1 });
	});
	it('colours: #hex, short hex, 0x, rgb(), [r,g,b] 0..1 and 0..255, {r,g,b}', () => {
		const C = { kind: /** @type {const} */ ('color'), name: 'Color' };
		for (const t of ['#ff8000', '#FF8000', '#f80', '0xff8000', 'color: #ff8000', '{"color":"#ff8000"}', 'rgb(255, 128, 0)', '[1, 0.50196, 0]', '255, 128, 0', '{"r":255,"g":128,"b":0}', '#ff8000ff'])
			expect(parseFor(t, C), t).toMatchObject({ ok: true, value: t === '#f80' ? '#ff8800' : '#ff8000' });
		expect(normalizeHex('abc')).toBe('#aabbcc');
		expect(normalizeHex('nope')).toBe(null);
	});
	it('choices match the value or the label, any case', () => {
		const E = { kind: /** @type {const} */ ('enum'), name: 'Pivot', options: [{ value: 'median', label: 'Median point' }, { value: 'active', label: 'Active object' }] };
		expect(parseFor('median', E)).toMatchObject({ ok: true, value: 'median' });
		expect(parseFor('Active Object', E)).toMatchObject({ ok: true, value: 'active' });
		expect(parseFor('{"pivot":"active"}', E)).toMatchObject({ ok: true, value: 'active' });
		expect(parseFor('pivot: median', E)).toMatchObject({ ok: true, value: 'median' });
		const N = { kind: /** @type {const} */ ('enum'), options: [{ value: 512 }, { value: 1024 }] };
		expect(parseFor('1024', N)).toMatchObject({ ok: true, value: 1024 });
	});
	it('toggles', () => {
		const B = { kind: /** @type {const} */ ('bool'), name: 'Cast shadow' };
		for (const [t, v] of /** @type {[string, boolean][]} */ ([['true', true], ['off', false], ['YES', true], ['1', true], ['0', false], ['{"castShadow":false}', false]]))
			expect(parseFor(t, B), t).toMatchObject({ ok: true, value: v });
	});
});

describe('paste — sections', () => {
	it('the JSON block, with or without its wrapper', () => {
		const wrapped = '{"transform":{"position":[1,2,3],"rotation":[0,90,0],"scale":[2,2,2]}}';
		const bare = '{"position":[1,2,3],"scale":[2,2,2]}';
		expect(parseFor(wrapped, TRANSFORM)).toMatchObject({ ok: true, value: { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] } });
		expect(parseFor(bare, TRANSFORM)).toMatchObject({ ok: true, value: { position: [1, 2, 3], scale: [2, 2, 2] } });
	});
	it('"name: value" lines, with an optional header line', () => {
		const lines = 'transform:\nposition: 1, 2, 3\nrotation: Vector3(0, 90, 0)\nscale: [2, 2, 2]';
		expect(parseClipboard(lines)).toMatchObject({ kind: 'section', name: 'transform' });
		expect(parseFor(lines, TRANSFORM)).toMatchObject({ ok: true, value: { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] } });
		expect(parseFor('Position: 1,2,3\r\nScale: 1,1,1', TRANSFORM)).toMatchObject({ ok: true, value: { position: [1, 2, 3], scale: [1, 1, 1] } });
	});
	it('a JS object literal from a code editor', () => {
		expect(parseFor("{ position: [1, 2, 3], scale: [1, 1, 1], }", TRANSFORM)).toMatchObject({ ok: true, value: { position: [1, 2, 3] } });
	});
	it('only matching keys apply; the others are reported', () => {
		const res = /** @type {any} */ (parseFor('{"position":[1,2,3],"roughness":0.5}', TRANSFORM));
		expect(res).toMatchObject({ ok: true, value: { position: [1, 2, 3] } });
		expect(res.skipped).toEqual(['roughness']);
	});
	it('one named row pastes on the header as a one-key section', () => {
		expect(parseFor('scale: 2, 2, 2', TRANSFORM)).toMatchObject({ ok: true, value: { scale: [2, 2, 2] } });
	});
	it('aliases and spellings: Location / pos / SCALE', () => {
		const T = { ...TRANSFORM, keys: { ...TRANSFORM.keys, position: { kind: /** @type {const} */ ('vector'), label: 'Position', aliases: ['location', 'pos'] } } };
		expect(parseFor('{"Location":[1,2,3],"SCALE":[1,1,1]}', T)).toMatchObject({ ok: true, value: { position: [1, 2, 3], scale: [1, 1, 1] } });
	});
	it('mixed kinds in one section', () => {
		const MAT = {
			kind: /** @type {const} */ ('section'),
			label: 'Material',
			keys: {
				color: { kind: /** @type {const} */ ('color'), label: 'Color' },
				roughness: { kind: /** @type {const} */ ('number'), label: 'Roughness' },
				side: { kind: /** @type {const} */ ('enum'), label: 'Side', options: [{ value: 0, label: 'Front' }, { value: 2, label: 'Double' }] },
				wireframe: { kind: /** @type {const} */ ('bool'), label: 'Wireframe' }
			}
		};
		expect(parseFor('{"material":{"color":"#ff0000","roughness":0.3,"side":"Double","wireframe":true}}', MAT)).toMatchObject({
			ok: true,
			value: { color: '#ff0000', roughness: 0.3, side: 2, wireframe: true }
		});
	});
});

describe('paste X / Y / Z only', () => {
	it('takes one component of a vector, or a lone number as it is', () => {
		expect(parseComponent('1, 2, 3', 1)).toMatchObject({ ok: true, value: 2 });
		expect(parseComponent('Vector3(4,5,6)', 2)).toMatchObject({ ok: true, value: 6 });
		expect(parseComponent('7', 0)).toMatchObject({ ok: true, value: 7 });
		expect(parseComponent('{"transform":{"position":[1,2,3],"scale":[4,5,6]}}', 0, 'Scale')).toMatchObject({ ok: true, value: 4 });
		expect(parseComponent('#ff0000', 0)).toMatchObject({ ok: false });
	});
});

describe('refusals (a short reason, never a half-guess)', () => {
	const refuse = (/** @type {string} */ text, /** @type {any} */ target, /** @type {RegExp} */ reason) => {
		const res = /** @type {any} */ (parseFor(text, target));
		expect(res.ok, text).toBe(false);
		expect(res.reason, text).toMatch(reason);
	};
	it('empty', () => refuse('   ', VEC, /empty/));
	it('a vector into a number', () => refuse('1, 2, 3', NUM, /one number.*vector/));
	it('one number into a vector', () => refuse('5', VEC, /x, y, z.*one number/));
	it('two or four values into a vector', () => {
		refuse('1, 2', VEC, /3 values.*got 2/);
		refuse('[1,2,3,4]', VEC, /3 values.*got 4/);
	});
	it('words into a number / vector', () => {
		refuse('hello', NUM, /one number/);
		refuse('hello world', VEC, /x, y, z/);
	});
	it('a colour into a vector', () => refuse('#ff0000', VEC, /colour/));
	it('not a colour', () => {
		refuse('1, 2', { kind: 'color' }, /colour/);
		refuse('2, 300, 4', { kind: 'color' }, /colour/);
	});
	it('a choice that does not exist names the choices', () =>
		refuse('sideways', { kind: 'enum', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }, /"sideways" is not one of: Alpha, Beta/));
	it('a section into a row whose name it does not carry', () => refuse('{"roughness":0.5,"metalness":1}', VEC, /section.*header/));
	it('a section into a section with nothing in common', () => refuse('{"roughness":0.5,"metalness":1}', TRANSFORM, /Nothing in the clipboard matches Transform/));
	it('an unnamed vector on a section header', () => refuse('1, 2, 3', TRANSFORM, /paste it on a row/));
	it('a matching key of the wrong shape refuses the whole section', () => refuse('{"position":[1,2],"scale":[1,1,1]}', TRANSFORM, /Position: Expected 3 values/));
	it('a toggle from a number that is not 0/1', () => refuse('5', { kind: 'bool' }, /on\/off/));
	it('a line that is not "name: value" in a multi-line paste', () => {
		const res = /** @type {any} */ (parseClipboard('position: 1,2,3\nthis is prose'));
		expect(res.error).toMatch(/not "name: value"/);
	});
	it('a JSON list of words', () => refuse('["a","b","c"]', VEC, /x, y, z/));
	it('coerce on a field kind that does not exist', () => {
		expect(coerce({ kind: 'number', value: 1, name: null }, /** @type {any} */ ({ kind: 'mesh' }))).toMatchObject({ ok: false });
	});
});
