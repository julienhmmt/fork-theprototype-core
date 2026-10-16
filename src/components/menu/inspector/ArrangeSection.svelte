<script>
	// 47 M2: the multi-select Inspector's Arrange section — Align (min / centre / max per axis, to
	// the selection bounds or to the ACTIVE object), Distribute (even centres / even gaps, 3+) and
	// Drop to ground. Every button is ONE undo step and replicates through the move path (align.js);
	// the object menu's Transform ▸ rows call the same functions.
	import Section from '../../ui/Section.svelte';
	import PropRow from '../../ui/PropRow.svelte';
	import Segmented from '../../ui/Segmented.svelte';
	import UiButton from '../../ui/Button.svelte';
	import { alignSelection, distributeSelection, dropSelection } from '$lib/align';

	/** @type {{count: number}} */
	let { count } = $props();

	/** where Align lines things up: the selection's bounds, or the active (last picked) object */
	let alignTo = $state('selection');
	const AXES = /** @type {const} */ (['x', 'y', 'z']);
	const EDGES = /** @type {const} */ ([
		{ edge: 'min', text: 'Min', title: 'lowest edge' },
		{ edge: 'center', text: 'Centre', title: 'centre' },
		{ edge: 'max', text: 'Max', title: 'highest edge' }
	]);
</script>

<Section variant="panel" label="Arrange">
	<div id="arrange-section" class="flex flex-col gap-1">
		<PropRow label="Align to" valueBox={false}>
			{#snippet control()}
				<Segmented
					id="arrange-align-to"
					label="Align to"
					options={[
						{ value: 'selection', label: 'Selection', title: 'Line the objects up with the bounds of the whole selection' },
						{ value: 'active', label: 'Active', title: 'Line the objects up with the active (last picked) object, which stays put' }
					]}
					bind:value={alignTo}
				/>
			{/snippet}
		</PropRow>
		{#each AXES as axis (axis)}
			<PropRow label={`Align ${axis.toUpperCase()}`} valueBox={false}>
				{#snippet control()}
					<div class="flex gap-1">
						{#each EDGES as e (e.edge)}
							<UiButton
								id={`arrange-align-${axis}-${e.edge}`}
								size="sm"
								variant="outline"
								text={e.text}
								title={`Move every object so its ${e.title} on ${axis.toUpperCase()} matches the ${alignTo === 'active' ? 'active object' : 'selection'} (one undo)`}
								onclick={() => alignSelection(axis, e.edge, { to: alignTo === 'active' ? 'active' : 'selection' })}
							/>
						{/each}
					</div>
				{/snippet}
			</PropRow>
		{/each}
		{#each AXES as axis (axis)}
			<PropRow label={`Distribute ${axis.toUpperCase()}`} valueBox={false}>
				{#snippet control()}
					<div class="flex gap-1">
						<UiButton
							id={`arrange-dist-${axis}-centers`}
							size="sm"
							variant="outline"
							text="Centres"
							disabled={count < 3}
							title={count < 3 ? 'Select three or more objects to distribute' : `Space the centres evenly on ${axis.toUpperCase()}; the two outermost stay (one undo)`}
							onclick={() => distributeSelection(axis, 'centers')}
						/>
						<UiButton
							id={`arrange-dist-${axis}-gaps`}
							size="sm"
							variant="outline"
							text="Gaps"
							disabled={count < 3}
							title={count < 3 ? 'Select three or more objects to distribute' : `Make the empty space between neighbours equal on ${axis.toUpperCase()}; the two outermost stay (one undo)`}
							onclick={() => distributeSelection(axis, 'gaps')}
						/>
					</div>
				{/snippet}
			</PropRow>
		{/each}
		<div class="flex justify-end">
			<UiButton
				id="arrange-drop"
				size="sm"
				variant="outline"
				icon="arrow-down-to-line"
				text="Drop to ground"
				title="Rest each object on the surface below it, or on the ground (one undo)"
				onclick={() => dropSelection()}
			/>
		</div>
	</div>
</Section>
