<script>
	// 47 T1/T2 — Inspector ▸ Terrain paint + Scatter, for a selected Terrain. The four layers
	// (colour, texture, tiling) the Paint brush blends between, and the scatter sets the
	// Scatter brush made (count, align to slope, remove). Painting itself happens in the
	// Sculpt toolbox; "Paint…" opens it on this terrain with the Paint brush armed.
	// Every edit is ONE undo entry + ONE message (terrainPaint.setTerrainLayers /
	// editScatterSet); a tiling scrub or a colour drag previews locally and commits on release.
	import Section from '../../ui/Section.svelte';
	import DragRow from '../../ui/DragRow.svelte';
	import UiButton from '../../ui/Button.svelte';
	import Checkbox from '../../ui/Checkbox.svelte';
	import ShaderTexturePicker from '../../editors/nodes/ShaderTexturePicker.svelte';
	import { sceneRevision } from '../../../stores/sceneStore';
	import {
		layersOf,
		setTerrainLayers,
		clearTerrainPaint,
		editScatterSet,
		rerollScatterSet,
		addScatterSource,
		removeScatterSource,
		setScatterSourceWeight,
		scatterBlockNow,
		scatterSource
	} from '$lib/terrainPaint';
	import { layerCoverage, base64ToBytes, decodeSplatBlock } from '$lib/terrainPaintCore';
	import { normalizeScatter, scatterColliderOf, instancesOf, sourceKey, MAX_INSTANCES } from '$lib/terrainScatterCore';
	import { terrainBounds } from '$lib/terrainSurface';
	import { sourceChoices, resolveSourceChoice, sourceLabel, packChoiceList, loadPackChoices } from '$lib/scatterSources';
	import { explorerItems } from '$lib/explorer';
	import { prefabs } from '$lib/prefabs';
	import ThemedSelect from '../../ui/ThemedSelect.svelte';

	/** @type {{ object: any }} */
	let { object } = $props();

	const uuid = $derived(object?.uuid ?? '');
	// re-read on every scene change: a peer's edit, an undo, a brush stroke
	const layers = $derived.by(() => {
		void $sceneRevision;
		return uuid ? layersOf(uuid) : [];
	});
	const coverage = $derived.by(() => {
		void $sceneRevision;
		const d = decodeSplatBlock(object?.userData?.terrainSplat);
		return d ? [0, 1, 2, 3].map((i) => Math.round(layerCoverage(d.bytes, i) * 100)) : null;
	});
	const scatter = $derived.by(() => {
		void $sceneRevision;
		return normalizeScatter(object?.userData?.terrainScatter, base64ToBytes)?.sets ?? [];
	});
	// 51: what each set DRAWS (generated slots with their edits + painted records)
	const drawn = $derived.by(() => {
		void $sceneRevision;
		const b = object ? terrainBounds(object) : null;
		return b ? scatter.map((s) => instancesOf(s, b, base64ToBytes).length) : scatter.map((s) => s.count);
	});
	const total = $derived(drawn.reduce((sum, n) => sum + n, 0));
	$effect(() => {
		if (scatter.length) loadPackChoices();
	});
	const addItems = $derived(
		sourceChoices({ library: $explorerItems, packs: $packChoiceList, prefabs: $prefabs, current: [$scatterSource] })
	);
	let preparing = $state('');
	/** 51 E1: add a model to a set — it becomes a weighted mix @param {any} s @param {string} key */
	async function addModel(s, key) {
		preparing = s.id;
		try {
			const source = await resolveSourceChoice(key, $explorerItems);
			if (source) addScatterSource(uuid, s.id, source, 1);
		} finally {
			preparing = '';
		}
	}
	/** the block a scrub started from (null = no gesture) @type {any} */
	let setBefore = null;
	/** @type {any} */
	let lastPatch = null;
	/** a set-field scrub: preview locally, ONE entry + message on release
	 * @param {any} s @param {Record<string, any>} patch */
	function setField(s, patch) {
		if (setBefore !== null) {
			lastPatch = { id: s.id, patch };
			editScatterSet(uuid, s.id, patch, { record: false, send: false });
		} else editScatterSet(uuid, s.id, patch);
	}
	function endField() {
		const before = setBefore;
		setBefore = null;
		if (lastPatch) editScatterSet(uuid, lastPatch.id, lastPatch.patch, { before });
		lastPatch = null;
	}
	/** @param {any} s @param {number} i @param {number} w */
	function setWeight(s, i, w) {
		if (setBefore !== null) {
			setScatterSourceWeight(uuid, s.id, i, w, { record: false, send: false });
			lastPatch = { weight: [s.id, i, w] };
		} else setScatterSourceWeight(uuid, s.id, i, w);
	}
	function endWeight() {
		const before = setBefore;
		setBefore = null;
		if (lastPatch?.weight) setScatterSourceWeight(uuid, lastPatch.weight[0], lastPatch.weight[1], lastPatch.weight[2], { before });
		lastPatch = null;
	}
	/** the add-a-model choices a set does not already draw @param {any} s */
	const notInSet = (s) => {
		const keys = new Set(sourcesOfSet(s).map((/** @type {any} */ e) => sourceKey(e.source)));
		return addItems.filter((c) => !keys.has(c.value));
	};
	/** @param {any} s */
	const sourcesOfSet = (s) => s.sources ?? [{ source: s.source, w: 1 }];
	const materialColor = $derived.by(() => {
		void $sceneRevision;
		const m = Array.isArray(object?.material) ? object.material[0] : object?.material;
		return m?.color ? '#' + m.color.getHexString() : '#808080'; // tokens-ok: a material colour fallback (data, not UI)
	});

	const WHITE = '#ffffff'; // tokens-ok: a layer colour default (data, not UI)

	/** the layers an in-flight gesture started from (null = no gesture) */
	/** @type {any} */
	let gestureBefore = null;

	/** @param {number} i @param {Record<string, any>} patch @param {'preview'|'commit'|'now'} mode */
	function edit(i, patch, mode) {
		const next = layers.map((l, k) => (k === i ? { ...l, ...patch } : l));
		if (mode === 'preview') {
			if (gestureBefore === null) gestureBefore = object.userData.terrainLayers ?? null;
			setTerrainLayers(uuid, next, { record: false, send: false });
			return;
		}
		const before = gestureBefore ?? undefined;
		gestureBefore = null;
		setTerrainLayers(uuid, next, before === undefined ? {} : { before });
	}

	async function openPaint() {
		const ts = await import('$lib/terrainSculpt');
		if (ts.enterSculpt(uuid)) ts.sculptOp.set('paint');
	}
	async function openScatter() {
		const ts = await import('$lib/terrainSculpt');
		if (ts.enterSculpt(uuid)) ts.sculptOp.set('scatter');
	}
	const COLLIDER_ITEMS = [
		{ value: 'none', name: 'None' },
		{ value: 'box', name: 'Box' },
		{ value: 'sphere', name: 'Sphere' },
		{ value: 'hull', name: 'Mesh hull' }
	];
	/** @param {any} s */
	const setName = (s) => (s.sources ? 'Mix of ' + s.sources.length + ' models' : sourceLabel(s.source));
</script>

<Section variant="panel" label="Terrain paint" aliases={['Splat', 'Terrain layers', 'Texture layers']}>
	<div id="terrain-paint-layers" class="flex flex-col gap-1.5">
		{#each layers as layer, i (i)}
			<div class="flex items-center gap-2 text-xs" id={`terrain-layer-${i}`}>
				<span class="w-12 shrink-0 text-text-muted">Layer {i + 1}</span>
				<input
					id={`terrain-layer-${i}-color`}
					type="color"
					class="h-6 w-8 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0"
					title={i === 0 && !layer.color ? 'The material colour — pick one to override it' : 'Layer colour (multiplies the texture)'}
					value={i === 0 && !layer.color ? materialColor : layer.color || WHITE}
					oninput={(e) => edit(i, { color: e.currentTarget.value }, 'preview')}
					onchange={(e) => edit(i, { color: e.currentTarget.value }, 'commit')}
				/>
				<ShaderTexturePicker
					compact
					hash={layer.texture}
					onpick={(/** @type {string} */ hash) => edit(i, { texture: hash || '' }, 'now')}
				/>
				<div class="min-w-0 flex-1">
					<DragRow
						id={`terrain-layer-${i}-tiling`}
						label="×"
						title="Tiling — how many times the texture repeats across the terrain"
						value={layer.tiling}
						min={0.1}
						max={200}
						step={0.05}
						snap={1}
						decimals={1}
						onscrubstart={() => (gestureBefore = object.userData.terrainLayers ?? null)}
						onchange={(/** @type {number} */ v) => edit(i, { tiling: v }, gestureBefore !== null ? 'preview' : 'now')}
						onscrubend={() => edit(i, {}, 'commit')}
					/>
				</div>
			</div>
			{#if i === 0 && (layer.color || layer.texture)}
				<button
					id="terrain-layer-0-material"
					class="ui-button-quiet self-start text-[length:var(--fs-badge)]"
					onclick={() => edit(0, { color: '', texture: '' }, 'now')}>Use the material for layer 1</button
				>
			{/if}
		{/each}
	</div>
	{#if coverage}
		<p id="terrain-paint-coverage" class="text-[length:var(--fs-badge)] text-text-muted">
			Painted: {coverage.map((c, i) => `${i + 1}: ${c}%`).join(' · ')}
		</p>
	{/if}
	<div class="flex flex-wrap gap-2">
		<UiButton id="terrain-paint-open" size="sm" variant="outline" onclick={openPaint}>Paint…</UiButton>
		{#if coverage}
			<UiButton id="terrain-paint-clear" size="sm" variant="outline" onclick={() => clearTerrainPaint(uuid)}>Clear paint</UiButton>
		{/if}
	</div>
</Section>

<Section variant="panel" label="Scatter" aliases={['Foliage', 'Instances', 'Trees']}>
	{#if scatter.length}
		<div id="terrain-scatter-sets" class="flex flex-col gap-1">
			{#each scatter as s, si (s.id)}
				<div class="flex flex-col gap-1 text-xs" data-scatter-set={s.id}>
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate" title={setName(s)}>{setName(s)}</span>
						<span class="text-text-muted" title="Instances this set draws">{drawn[si]}</span>
						<label class="flex items-center gap-1">
							<Checkbox label="Align to slope" checked={s.align} onchange={(/** @type {boolean} */ v) => editScatterSet(uuid, s.id, { align: !!v })} />
							Align
						</label>
						<button class="ui-button-quiet" title="Remove every instance of this set" onclick={() => editScatterSet(uuid, s.id, null)}>Remove</button>
					</div>
					<!-- 51 E1: the models a set draws — one, or a weighted mix (3 rocks 50/30/20) -->
					<ul class="flex flex-col gap-0.5" aria-label={`Models in ${setName(s)}`} data-scatter-sources={s.id}>
						{#each sourcesOfSet(s) as e, i (i)}
							<li class="flex flex-col" data-scatter-source={i}>
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 truncate" title={sourceLabel(e.source)}>{sourceLabel(e.source)}</span>
									{#if s.sources}
										<div class="w-20 shrink-0">
											<DragRow
												id={`terrain-scatter-weight-${s.id}-${i}`}
												label="w"
												ariaLabel={`Weight of ${sourceLabel(e.source)}`}
												title="How often this model is picked, against the others in the set"
												value={e.w}
												min={0.01}
												max={1000}
												step={0.05}
												decimals={1}
												onscrubstart={() => (setBefore = scatterBlockNow(uuid))}
												onchange={(/** @type {number} */ v) => setWeight(s, i, v)}
												onscrubend={endWeight}
											/>
										</div>
										<button class="ui-button-quiet" aria-label={`Remove ${sourceLabel(e.source)} from this set`} title="Remove this model (and the instances painted with it)" onclick={() => removeScatterSource(uuid, s.id, i)}>✕</button>
									{/if}
								</div>
								{#if e.source.note}
									<span class="text-[length:var(--fs-badge)] text-text-muted" data-scatter-note>{e.source.note}</span>
								{/if}
							</li>
						{/each}
					</ul>
					<ThemedSelect
						id={`terrain-scatter-add-${s.id}`}
						class="min-w-0"
						title="Mix another model into this set — a primitive, a Library model, a pack item, a prefab (its look) or the brush's current source"
						placeholder={preparing === s.id ? 'Preparing…' : 'Add a model to the mix…'}
						clip={false}
						items={notInSet(s)}
						value={undefined}
						onchange={(/** @type {string} */ v) => addModel(s, String(v))}
					/>
					<!-- 51 E1: per-instance colour variation, and how deep each instance sits in the ground -->
					<div class="flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<DragRow
								id={`terrain-scatter-tint-${s.id}`}
								label="Tint"
								title="Colour variation between instances (0 = all alike)"
								value={s.tint ?? 0}
								min={0}
								max={1}
								step={0.005}
								decimals={2}
								onscrubstart={() => (setBefore = scatterBlockNow(uuid))}
								onchange={(/** @type {number} */ v) => setField(s, { tint: v })}
								onscrubend={endField}
							/>
						</div>
						<div class="min-w-0 flex-1">
							<DragRow
								id={`terrain-scatter-sink-${s.id}`}
								label="Sink"
								title="Push each instance into the ground by this much (metres at scale 1; negative lifts it)"
								value={s.sink ?? 0}
								min={-2}
								max={5}
								step={0.005}
								decimals={2}
								unit="length"
								onscrubstart={() => (setBefore = scatterBlockNow(uuid))}
								onchange={(/** @type {number} */ v) => setField(s, { sink: v })}
								onscrubend={endField}
							/>
						</div>
					</div>
					{#if s.gen}
						<div class="flex items-center gap-2">
							<span class="min-w-0 flex-1 text-text-muted">Generated from seed {s.seed}</span>
							<button
								id={`terrain-scatter-reroll-${s.id}`}
								class="ui-button-quiet"
								title="A new random layout — instances you moved, turned, scaled or deleted keep your edits"
								onclick={() => rerollScatterSet(uuid, s.id)}>Re-roll</button
							>
						</div>
					{/if}
					<!-- 48 B1: what a simulation gives each instance (static, built on every peer from this field) -->
					<div class="flex items-center gap-2">
						<span class="w-14 shrink-0 text-text-muted">Collider</span>
						<ThemedSelect
							id={`terrain-scatter-collider-${s.id}`}
							class="min-w-0 flex-1"
							title="The static collider every instance of this model gets while a simulation runs"
							items={COLLIDER_ITEMS}
							value={scatterColliderOf(s.collider)}
							onchange={(/** @type {string} */ v) => editScatterSet(uuid, s.id, { collider: v })}
						/>
					</div>
				</div>
			{/each}
		</div>
		<p id="terrain-scatter-total" class="text-[length:var(--fs-badge)] text-text-muted">{total} of {MAX_INSTANCES} instances</p>
	{:else}
		<p class="text-[length:var(--fs-badge)] text-text-muted">No scattered models yet.</p>
	{/if}
	<UiButton id="terrain-scatter-open" size="sm" variant="outline" onclick={openScatter}>Scatter…</UiButton>
</Section>
