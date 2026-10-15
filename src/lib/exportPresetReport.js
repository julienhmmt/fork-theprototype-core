// 46 P3 — the sentence a "For Quest / web" export ends with. PURE (presets' formatters only), so
// the GLTF and the .tpscene path word their numbers alike.
import { shortBytes, percentChange } from './gltfOptimize/presets.js';

/**
 * @param {'gltf' | 'tpscene'} kind @param {any} report the engine's (GLTF) or sceneOptimize's (.tpscene)
 * @param {number} bytesOut the file written
 */
export function presetSummary(kind, report, bytesOut) {
	/** @type {string[]} */
	const bits = [];
	if (kind === 'gltf') {
		bits.push(shortBytes(report.bytesBefore) + ' → ' + shortBytes(bytesOut) + ' (' + percentChange(report.bytesBefore, bytesOut) + ')');
		if (report.gpuBytesBefore) bits.push('texture memory ' + shortBytes(report.gpuBytesBefore) + ' → ' + shortBytes(report.gpuBytesAfter));
		if (report.lods?.length) bits.push('LOD chain ' + report.lods.map((/** @type {any} */ l) => Math.round(l.ratio * 100) + '%').join(' / '));
		return 'Exported for Quest / web: ' + bits.join(', ') + '.';
	}
	if (report.images) bits.push(report.images + ' texture' + (report.images === 1 ? '' : 's') + (report.resized ? ' (' + report.resized + ' resized)' : '') + ' with KTX2 twins');
	if (report.gpuBefore) bits.push('texture memory ' + shortBytes(report.gpuBefore) + ' → ' + shortBytes(report.gpuAfter) + ' (' + percentChange(report.gpuBefore, report.gpuAfter) + ')');
	if (report.lodStamped) bits.push(report.lodStamped + ' object' + (report.lodStamped === 1 ? '' : 's') + ' got an LOD chain');
	return 'Saved for Quest / web (' + shortBytes(bytesOut) + '): ' + (bits.join(', ') || 'nothing needed changing') + '.';
}
