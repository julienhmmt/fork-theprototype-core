// 51 E4/E5 — THE ONE PLACE 51-edit touches the scatter SET FORMAT (owner: 51-sources).
//
// Everything that edits instances (scatterEdit.js: picking, the gizmo, box select, the
// rotate/scale/relax/erase brushes, convert both ways) works on plain instance LISTS and
// reads and writes a terrain's scatter through the four functions below, so when
// 51-sources lands params + seed + overrides only this file is re-pointed
// (QUESTIONS-51-edit.md Q1):
//
//   readScatter(object)          -> {bounds, sets: [{id, source, align, collider, list}]}
//   blockOf(sets, bounds)        -> the stored block (null = no scatter)
//   instanceIdOf(set, index)     -> the stable id an override is keyed by
//   newSet(source, list, extra)  -> a fresh set (convert-to-scatter)
//
// TODAY (the 1.38 format): a set's instances are explicit bytes, so an instance's id is its
// index, an edit rewrites the bytes and a delete drops them. That is exactly what overrides
// will express (moved / rotated / scaled / deleted), just stored differently.
import { normalizeScatter, decodeInstances, encodeInstances, sourceKey, MAX_INSTANCES, MAX_SETS, SCATTER_VERSION } from './terrainScatterCore';
import { base64ToBytes, bytesToBase64 } from './terrainPaintCore';
import { terrainBounds } from './terrainSurface';

/** @typedef {import('./scatterEditCore').Instance} Instance */
/** @typedef {{id: string, source: any, align: boolean, collider?: string, list: Instance[]}} EditSet */

export { MAX_INSTANCES, MAX_SETS, sourceKey };

/** A terrain's scatter as editable lists (null when it is not a terrain). @param {any} object
 * @returns {{bounds: {minX: number, minZ: number, sizeX: number, sizeZ: number}, sets: EditSet[]} | null} */
export function readScatter(object) {
	if (!object?.userData?.terrain) return null;
	const bounds = terrainBounds(object);
	if (!bounds) return null;
	const block = normalizeScatter(object.userData.terrainScatter, base64ToBytes);
	const sets = (block?.sets ?? []).map((s) => ({
		id: s.id,
		source: s.source,
		align: s.align,
		...(s.collider ? { collider: s.collider } : {}),
		list: decodeInstances(/** @type {Uint8Array} */ (base64ToBytes(s.data)), bounds)
	}));
	return { bounds, sets };
}

/** Lists back to the stored block. Empty sets are dropped (an erased-out model leaves no
 * row); no sets at all = null, which clears the block. @param {EditSet[]} sets @param {any} bounds */
export function blockOf(sets, bounds) {
	const out = [];
	for (const s of sets) {
		if (!s.list.length) continue;
		out.push({
			id: s.id,
			source: s.source,
			align: !!s.align,
			data: bytesToBase64(encodeInstances(s.list, bounds)),
			count: s.list.length,
			...(s.collider && s.collider !== 'none' ? { collider: s.collider } : {})
		});
	}
	return out.length ? { v: SCATTER_VERSION, sets: out } : null;
}

/** The id an instance's override is keyed by. Today: its index. @param {EditSet} _set @param {number} index */
export function instanceIdOf(_set, index) {
	return index;
}

/** A new set holding `list` (convert-to-scatter). @param {any} source @param {Instance[]} list
 * @param {{align?: boolean, collider?: string}} [extra] @returns {EditSet} */
export function newSet(source, list, extra = {}) {
	return { id: sourceKey(source), source, align: !!extra.align, ...(extra.collider ? { collider: extra.collider } : {}), list };
}

/** Total instances across sets. @param {EditSet[]} sets */
export function totalOf(sets) {
	return sets.reduce((n, s) => n + s.list.length, 0);
}
