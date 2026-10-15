<script module>
	// what the I4 settings search matches this section by, beyond its row names
	export const keywords = ['import', 'optimize', 'optimise', 'lod', 'level of detail', 'ktx2', 'basis', 'compress', 'texture size', 'triangles', 'glb', 'gltf', 'quest', 'performance'];
</script>

<script>
	// 46 P2 — Settings ▸ Import: this device's defaults for NEW imports (LOCAL, safeStorage via
	// $lib/importOptimize). A model over the triangle threshold or with a texture over the texture
	// threshold is optimized as it comes in; a single asset can override these in the Explorer
	// (its Properties ▸ Import settings), Unity's import-inspector shape.
	import SettingRow from '../ui/SettingRow.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import Segmented from '../ui/Segmented.svelte';
	import DragRow from '../ui/DragRow.svelte';
	import Button from '../ui/Button.svelte';
	import { importSettings, setImportSettings, resetImportSettings } from '$lib/importSettings';

	const SIZES = [
		{ value: '512', label: '512' },
		{ value: '1024', label: '1024' },
		{ value: '2048', label: '2048' },
		{ value: '4096', label: '4096' }
	];
	const THRESHOLDS = [
		{ value: '1024', label: '1024' },
		{ value: '2048', label: '2048' },
		{ value: '4096', label: '4096' },
		{ value: '8192', label: '8192' }
	];
	const LEVELS = [
		{ value: '0', label: 'Off' },
		{ value: '2', label: '2' },
		{ value: '3', label: '3' },
		{ value: '4', label: '4' }
	];

	/** @param {number} i @param {number} v */
	function setRatio(i, v) {
		const ratios = [...$importSettings.lodRatios];
		ratios[i] = v / 100;
		setImportSettings({ lodRatios: ratios });
	}
</script>

<div id="import-settings-section" class="contents" data-keywords={keywords.join(' ')}>
	<SettingRow id="row-import-auto" label="Optimize big models automatically" description="Over the thresholds below, an import gets an LOD chain and its textures are resized and GPU-compressed. The original file is always kept in the Library.">
		<Toggle id="import-auto" label="Optimize big models automatically" checked={$importSettings.auto} onchange={(on) => setImportSettings({ auto: on })} />
	</SettingRow>
	<SettingRow id="row-import-triangles" label="Triangle threshold" description="A model with more triangles than this gets its LOD chain.">
		<DragRow id="import-triangles" ariaLabel="Triangle threshold" value={$importSettings.triangleThreshold} min={1000} max={5000000} step={500} snap={10000} decimals={0} onchange={(v) => setImportSettings({ triangleThreshold: Math.round(v) })} />
	</SettingRow>
	<SettingRow id="row-import-texture-threshold" label="Texture threshold" description="A texture larger than this (its long side, in pixels) is resized and compressed." wide>
		<Segmented id="import-texture-threshold" label="Texture threshold" options={THRESHOLDS} value={String($importSettings.textureThreshold)} onchange={(v) => setImportSettings({ textureThreshold: Number(v) })} />
	</SettingRow>
	<SettingRow id="row-import-max-texture" label="Max texture size" description="The long side an optimized texture is resized to." wide>
		<Segmented id="import-max-texture" label="Max texture size" options={SIZES} value={String($importSettings.maxTextureSize)} onchange={(v) => setImportSettings({ maxTextureSize: Number(v) })} />
	</SettingRow>
	<SettingRow id="row-import-compress" label="Compress textures (KTX2)" description="The GPU holds a Basis-compressed copy — about a sixth of the memory. Saves and peers still get an ordinary picture.">
		<Toggle id="import-compress" label="Compress textures (KTX2)" checked={$importSettings.compress} onchange={(on) => setImportSettings({ compress: on })} />
	</SettingRow>
	<SettingRow id="row-import-lod-levels" label="LOD levels" description="How many lighter versions the chain has. Each switches in by screen size; Configure Scene ▸ Level of detail moves them all." wide>
		<Segmented id="import-lod-levels" label="LOD levels" options={LEVELS} value={String($importSettings.lodLevels)} onchange={(v) => setImportSettings({ lodLevels: Number(v) })} />
	</SettingRow>
	{#each $importSettings.lodRatios as ratio, i (i)}
		<SettingRow id="row-import-lod-ratio-{i + 1}" label="LOD {i + 1} keeps" description="Share of the triangles level {i + 1} keeps, in percent.">
			<DragRow id="import-lod-ratio-{i + 1}" ariaLabel="LOD {i + 1} keeps (percent)" value={Math.round(ratio * 1000) / 10} min={2} max={90} step={0.5} snap={5} decimals={1} onchange={(v) => setRatio(i, v)} />
		</SettingRow>
	{/each}
	<SettingRow id="row-import-reset" label="Import defaults" description="Back to 50k triangles / 2048 px, three levels at 50 / 25 / 10 %.">
		<Button id="import-reset" variant="outline" onclick={() => resetImportSettings()}>Reset</Button>
	</SettingRow>
</div>

<style>
	.contents {
		display: contents;
	}
</style>
