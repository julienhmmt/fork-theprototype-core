<script>
	// 47 T2 — Inspector ▸ Scatter: the sets a scatter brush (or a fill) made on this object —
	// count, align to slope, collider, remove. 51-surface moved it out of TerrainPaintSection
	// VERBATIM so ANY mesh can carry a Scatter section (the "Add scatter" row); the terrain
	// renders it in the same place it always did.
	// Every edit is ONE undo entry + ONE message (terrainPaint.editScatterSet).
	import Section from '../../ui/Section.svelte';
	import UiButton from '../../ui/Button.svelte';
	import Checkbox from '../../ui/Checkbox.svelte';
	import { sceneRevision } from '../../../stores/sceneStore';
	import { editScatterSet, addScatterSet, scatterSource } from '$lib/terrainPaint';
	import { base64ToBytes } from '$lib/terrainPaintCore';
	import { normalizeScatter, scatterColliderOf, sourceOf, MAX_INSTANCES } from '$lib/terrainScatterCore';
	import { scatterCounts } from '$lib/terrainSurface';
	import ThemedSelect from '../../ui/ThemedSelect.svelte';
	import ScatterFillRows from './ScatterFillRows.svelte'; // 51-surface E3

	/** @type {{ object: any }} */
	let { object } = $props();

	const uuid = $derived(object?.uuid ?? '');
	// re-read on every scene change: a peer's edit, an undo, a brush stroke
	const scatter = $derived.by(() => {
		void $sceneRevision;
		return normalizeScatter(object?.userData?.terrainScatter, base64ToBytes)?.sets ?? [];
	});
	// 51-surface: what each set DRAWS (painted + its fill after masks/spacing), from the last layout
	const drawn = $derived.by(() => {
		void $sceneRevision;
		return scatterCounts(object);
	});
	const countOf = (/** @type {any} */ s) => drawn[s.id] ?? s.count;
	const total = $derived(scatter.reduce((sum, s) => sum + countOf(s), 0));
	const terrain = $derived(!!object?.userData?.terrain);

	async function openScatter() {
		const ts = await import('$lib/terrainSculpt');
		// 51-surface: on a plain mesh a scatter-only session (the geometry is left untouched)
		if (ts.enterSculpt(uuid, { scatter: !terrain })) ts.sculptOp.set('scatter');
	}
	/** 51-surface: a new FILL set — the brush's current source over the whole surface */
	function addFill() {
		const source = sourceOf($scatterSource) ?? { kind: 'primitive', type: 'Cone' };
		addScatterSet(uuid, { source, gen: { count: 200, scaleMin: 0.8, scaleMax: 1.2, rot: true } });
	}
	const COLLIDER_ITEMS = [
		{ value: 'none', name: 'None' },
		{ value: 'box', name: 'Box' },
		{ value: 'sphere', name: 'Sphere' },
		{ value: 'hull', name: 'Mesh hull' }
	];
	/** @param {any} s */
	const setName = (s) => (s.source.kind === 'primitive' ? s.source.type : s.source.name || 'Library model');
</script>

<Section variant="panel" label="Scatter" aliases={['Foliage', 'Instances', 'Trees']}>
	{#if scatter.length}
		<div id="terrain-scatter-sets" class="flex flex-col gap-1">
			{#each scatter as s (s.id)}
				<div class="flex flex-col gap-1 text-xs" data-scatter-set={s.id}>
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate" title={setName(s)}>{setName(s)}</span>
						<span class="text-text-muted" data-scatter-count={countOf(s)}>{countOf(s)}</span>
						<label class="flex items-center gap-1">
							<Checkbox label={terrain ? 'Align to slope' : 'Align to surface'} checked={s.align} onchange={(/** @type {boolean} */ v) => editScatterSet(uuid, s.id, { align: !!v })} />
							Align
						</label>
						<button class="ui-button-quiet" title="Remove every instance of this model" onclick={() => editScatterSet(uuid, s.id, null)}>Remove</button>
					</div>
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
					<ScatterFillRows {object} set={s} />
				</div>
			{/each}
		</div>
		<p id="terrain-scatter-total" class="text-[length:var(--fs-badge)] text-text-muted">{total} of {MAX_INSTANCES} instances</p>
	{:else}
		<p class="text-[length:var(--fs-badge)] text-text-muted">
			{terrain ? 'No scattered models yet.' : 'Scatter models over this object’s surface — they move, turn and scale with it.'}
		</p>
	{/if}
	<div class="flex flex-wrap gap-2">
		<!-- 51-surface E2: the "Add scatter" row (any mesh — the Water section's Add bubble / pour
		     emitter rows sit just above it); it adds a FILL over the whole surface -->
		<UiButton id="scatter-add" size="sm" variant="outline" onclick={addFill}>{scatter.length ? 'Add fill' : 'Add scatter'}</UiButton>
		<UiButton id="terrain-scatter-open" size="sm" variant="outline" onclick={openScatter}>{terrain ? 'Scatter…' : 'Paint scatter…'}</UiButton>
	</div>
</Section>
