<script>
	import { measureLabelViews } from '$lib/measure';

	// 47 M1: the dimension labels of every measure chain, as SCREEN-SPACE DOM pills (the
	// AnnotationMarkers precedent: crisp at any zoom, never cut by geometry, readable in every
	// theme). Presentation only — positions arrive on `measureLabelViews`, published from the
	// render stage by MeasureOverlay. Pointer-transparent: the viewport keeps every click.
</script>

{#if $measureLabelViews.length}
	<div class="measure-layer" id="measure-labels">
		{#each $measureLabelViews as label (label.key)}
			<span
				class="measure-label is-{label.kind}"
				class:is-pinned={label.pinned}
				data-key={label.key}
				data-kind={label.kind}
				data-pinned={label.pinned ? '1' : '0'}
				style="left: {label.x}px; top: {label.y}px;">{label.text}</span
			>
		{/each}
	</div>
{/if}

<style>
	.measure-layer {
		position: fixed;
		inset: 0;
		pointer-events: none;
		/* above the viewport, below every panel / drawer / menu tier (the note markers' tier) */
		z-index: calc(var(--z-chrome) - 2);
	}
	.measure-label {
		position: fixed;
		transform: translate(-50%, -130%);
		padding: 1px 6px;
		border-radius: var(--radius-input);
		background: color-mix(in srgb, var(--bg-app) 82%, transparent);
		border: 1px solid var(--accent);
		color: var(--text);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.measure-label.is-pinned {
		border-color: var(--border-strong);
	}
	.measure-label.is-angle {
		transform: translate(-50%, 35%);
		font-weight: 500;
		color: var(--text-muted);
	}
	.measure-label.is-total {
		transform: translate(12px, -50%);
		background: var(--accent-fill);
		border-color: var(--accent-fill);
		color: var(--on-accent);
	}
</style>
