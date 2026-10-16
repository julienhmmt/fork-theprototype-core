import { writable, get } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { patchRecord } from './explorer';
import { IMPORT_DEFAULTS, normalizeImportSettings } from './gltfOptimize/presets.js';

// 46 P2 — THE IMPORT SETTINGS, a leaf: Settings ▸ Import's store (LOCAL, this device) and a file's
// per-asset override (on its Library record). importOptimize.js does the work and is loaded only
// when an import or a Reimport needs it.

const KEY = 'import:settings';

/** Settings ▸ Import — this device's defaults for new imports.
 * @type {import('svelte/store').Writable<import('./gltfOptimize/presets.js').ImportSettings>} */
export const importSettings = writable(read());

function read() {
	try {
		const raw = typeof localStorage === 'undefined' ? null : safeStorage.getItem(KEY);
		return normalizeImportSettings(raw ? JSON.parse(raw) : IMPORT_DEFAULTS);
	} catch {
		return normalizeImportSettings(IMPORT_DEFAULTS);
	}
}

/** @param {Partial<import('./gltfOptimize/presets.js').ImportSettings>} patch */
export function setImportSettings(patch) {
	const next = normalizeImportSettings({ ...get(importSettings), ...patch });
	safeStorage.setItem(KEY, JSON.stringify(next));
	importSettings.set(next);
	return next;
}

/** Back to the shipped defaults. */
export function resetImportSettings() {
	return setImportSettings(normalizeImportSettings(IMPORT_DEFAULTS));
}

/**
 * @typedef {{mode?: 'auto' | 'always' | 'never', lodLevels?: number, lodRatios?: number[],
 *   maxTextureSize?: number, compress?: boolean}} AssetOverride
 */

/** An asset override, normalised: unknown keys dropped, `mode` one of three. @param {any} raw
 * @returns {AssetOverride} */
export function normalizeOverride(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	/** @type {AssetOverride} */
	const out = { mode: r.mode === 'always' || r.mode === 'never' ? r.mode : 'auto' };
	if (Number.isFinite(Number(r.lodLevels))) out.lodLevels = Number(r.lodLevels);
	if (Array.isArray(r.lodRatios)) out.lodRatios = r.lodRatios.map(Number);
	if (Number.isFinite(Number(r.maxTextureSize))) out.maxTextureSize = Number(r.maxTextureSize);
	if (typeof r.compress === 'boolean') out.compress = r.compress;
	return out;
}

/** The settings an import of this asset runs under: the device defaults with the override on top.
 * @param {AssetOverride | null | undefined} override */
export function effectiveSettings(override) {
	const o = normalizeOverride(override);
	const { mode, ...rest } = o;
	return { mode, settings: normalizeImportSettings({ ...get(importSettings), ...rest }) };
}

/** Set (or clear, with null) an asset's import override on its Library record. @param {string} itemId
 * @param {AssetOverride | null} override */
export function setAssetOverride(itemId, override) {
	return patchRecord(itemId, {
		importSettings: override ? normalizeOverride(override) : undefined
	});
}
