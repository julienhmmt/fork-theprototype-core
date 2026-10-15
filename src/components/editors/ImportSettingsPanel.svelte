<script>
	// 46 P2 — Explorer item Properties ▸ IMPORT SETTINGS: the per-asset override, Unity's import
	// inspector. It lives on the ORIGINAL file's Library record (`importSettings`, LOCAL like the
	// record) and wins over Settings ▸ Import for that file only: Optimize auto / always / never,
	// LOD levels, max texture size, compression. REIMPORT runs the original again under it and
	// swaps every placed copy (one undo step each). An OPTIMIZED copy shows where it came from and
	// what the optimizer saved, with a way to its original. Renders nothing for other kinds.
	import Segmented from '../ui/Segmented.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import { explorerItems, hiddenItems, revealItem } from '$lib/explorer';
	import { importSettings, effectiveSettings, setAssetOverride, reimportAsset } from '$lib/importOptimize';
	import { shortBytes, percentChange } from '$lib/gltfOptimize/presets.js';

	let { item = null } = $props();
	/** @param {any} r */
	const onSelect = (r) => revealItem(r.id);

	/** the live record (the prop may be a snapshot) */
	const record = $derived(item ? ([...$explorerItems, ...$hiddenItems].find((r) => r.id === item.id) ?? item) : null);
	const isModel = $derived(!!record && record.kind === 'object' && !item?.packEntry && !item?.remoteItem);
	const source = $derived(record?.optimizedFrom ? [...$explorerItems, ...$hiddenItems].find((r) => r.hash === record.optimizedFrom) ?? null : null);
	const copy = $derived(record?.optimizedHash ? [...$explorerItems, ...$hiddenItems].find((r) => r.hash === record.optimizedHash) ?? null : null);
	const gltf = $derived(/\.(glb|gltf)$/i.test(record?.name ?? ''));
	// re-read when the device defaults move ($importSettings is passed to make the derived depend on it)
	const eff = $derived(record ? effectiveOf($importSettings, record.importSettings) : null);
	/** @param {any} _defaults @param {any} override */
	function effectiveOf(_defaults, override) {
		return effectiveSettings(override);
	}
	let busy = $state(false);

	const MODES = [
		{ value: 'auto', label: 'Auto', title: 'Optimize when it crosses the Settings ▸ Import thresholds' },
		{ value: 'always', label: 'Always' },
		{ value: 'never', label: 'Never' }
	];
	const LEVELS = [
		{ value: '0', label: 'Off' },
		{ value: '2', label: '2' },
		{ value: '3', label: '3' },
		{ value: '4', label: '4' }
	];
	const SIZES = [
		{ value: '512', label: '512' },
		{ value: '1024', label: '1024' },
		{ value: '2048', label: '2048' },
		{ value: '4096', label: '4096' }
	];

	/** @param {Record<string, any>} patch */
	function edit(patch) {
		if (!record) return;
		setAssetOverride(record.id, { ...(record.importSettings ?? {}), ...patch });
	}

	async function reimport() {
		if (!record || busy) return;
		busy = true;
		try {
			await reimportAsset(record.hash);
		} finally {
			busy = false;
		}
	}
</script>

{#if isModel && record}
	<div id="import-settings-panel" class="isp mt-2 flex flex-col gap-1.5 text-[11px]">
		{#if source || record.optimizedFrom}
			<div class="font-semibold text-text-2">Optimized copy</div>
			<p class="text-text-muted">
				Made by the import optimizer from <button id="isp-open-original" class="isp-link" disabled={!source} onclick={() => source && onSelect(source)}>{source?.name ?? 'an original no longer in the Library'}</button>.
			</p>
			{#if record.optimizeReport}
				{@const r = record.optimizeReport}
				<div id="isp-report" class="flex flex-col gap-0.5 text-text-2">
					<span>File {shortBytes(r.bytesBefore)} → {shortBytes(r.bytesAfter)} ({percentChange(r.bytesBefore, r.bytesAfter)})</span>
					{#if r.gpuBefore}<span>Texture memory {shortBytes(r.gpuBefore)} → {shortBytes(r.gpuAfter)} ({percentChange(r.gpuBefore, r.gpuAfter)})</span>{/if}
				</div>
			{/if}
		{:else if eff}
			<div class="flex items-center gap-2">
				<span class="font-semibold text-text-2">Import settings</span>
				{#if record.importSettings}
					<button id="isp-use-defaults" class="isp-link ml-auto" title="Forget this file's override and follow Settings ▸ Import" onclick={() => setAssetOverride(record.id, null)}>Use defaults</button>
				{:else}
					<span class="ml-auto text-text-faint">Settings ▸ Import</span>
				{/if}
			</div>
			<div class="isp-row"><span class="isp-label">Optimize</span><Segmented id="isp-mode" label="Optimize" options={MODES} value={eff.mode} onchange={(v) => edit({ mode: v })} /></div>
			<div class="isp-row"><span class="isp-label">LOD levels</span><Segmented id="isp-lod-levels" label="LOD levels" options={LEVELS} value={String(eff.settings.lodLevels)} onchange={(v) => edit({ lodLevels: Number(v) })} /></div>
			{#if gltf}
				<div class="isp-row"><span class="isp-label">Max texture</span><Segmented id="isp-max-texture" label="Max texture size" options={SIZES} value={String(eff.settings.maxTextureSize)} onchange={(v) => edit({ maxTextureSize: Number(v) })} /></div>
				<div class="isp-row"><span class="isp-label">Compress (KTX2)</span><Toggle id="isp-compress" label="Compress textures (KTX2)" checked={eff.settings.compress} onchange={(on) => edit({ compress: on })} /></div>
			{:else}
				<p class="text-text-faint">Texture resize and compression need a .glb / .gltf; this file gets the LOD chain only.</p>
			{/if}
			<div class="mt-1 flex items-center gap-2">
				<button id="isp-reimport" class="ui-button-quiet" disabled={busy} onclick={reimport}>{busy ? 'Reimporting…' : 'Reimport'}</button>
				{#if copy}
					<button id="isp-open-copy" class="isp-link" onclick={() => onSelect(copy)}>Optimized copy: {copy.name}</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.isp-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.isp-label {
		width: 6.5rem;
		flex-shrink: 0;
		color: var(--text-faint);
	}
	.isp-link {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.isp-link:disabled {
		color: var(--text-faint);
		text-decoration: none;
	}
</style>
