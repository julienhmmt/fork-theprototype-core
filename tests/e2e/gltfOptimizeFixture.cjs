// 46 — the optimizer fixtures for the e2e suites, built in NODE with the real engine
// (src/lib/gltfOptimize/core.js) and the unit suite's fixture builder (sharp + the Basis
// encoder's node build), so a suite starts from exactly the bytes the worker would produce.
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const esm = (p) => import(pathToFileURL(path.join(root, p)).href);

/**
 * @param {{segments?: number[], placements?: number, texture?: number[], normalMap?: boolean}} [shape]
 * @returns {Promise<{plain: number[], twin: number[], quest: number[], reports: any}>}
 */
async function buildOptimizeFixtures(shape = {}) {
	const fx = await esm('tests/fixtures/gltfOptimizeFixtures.js');
	const core = await esm('src/lib/gltfOptimize/core.js');
	const presets = await esm('src/lib/gltfOptimize/presets.js');
	const plain = await fx.buildFixture({ segments: [96, 48], placements: 1, texture: [512, 512], normalMap: true, duplicateMaterial: false, ...shape });
	const twin = await core.optimizeGltfBytes(plain, { maxTextureSize: 512, textures: 'ktx2+fallback' }, fx.nodeEnv());
	const quest = await core.optimizeGltfBytes(plain, presets.EXPORT_PRESETS.quest.options, fx.nodeEnv());
	return {
		plain: Array.from(plain),
		twin: Array.from(twin.bytes),
		quest: Array.from(quest.bytes),
		reports: { twin: twin.report, quest: quest.report }
	};
}

module.exports = { buildOptimizeFixtures, esm };
