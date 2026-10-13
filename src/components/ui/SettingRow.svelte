<script>
	// 38 R3 — one setting (SPEC §2 SettingRow, §3): label + optional one-line description LEFT,
	// control RIGHT. Replaces menu/SettingRow.svelte's 3-column grid (name | control |
	// description) and its centred mobile stack.
	//   children   the control (Toggle, Segmented, Button pair, Slider, select …)
	//   desc       rich description (a link inside it); else `description` text
	//   extra      full-width content under the row (a provider list, a form)
	//   badge      scope text ("This device" / "Shared") — a Badge, never prose
	//   wide       a WIDE control (segmented 3+, slider, button pair, text field, list): it
	//              drops to a full-width line under the label on mobile (< 640px)
	//   stack      …and on desktop too (a control wider than ~260px)
	// 41 G19 -> 41b H12/H13: the row reflows by ITS OWN width, never the viewport, and by REAL FIT
	// ($lib/ui/rowFit.js): the control's max-content against the row, leaving the label a text column of
	// at least rowFit.TEXT_MIN (no one-word-per-line columns). A compact control (switch, swatch, key box,
	// short dropdown, single button, number, a segmented control that fits) stays on the label's row;
	// one that cannot fit drops under it (`sr-fit-stack`) — segmented, slider and text fields at full
	// width, the rest at their own width. A stacked segmented control wider than the row wraps to two
	// columns (`sr-seg-wrap`). `wide` = stretch the control when it stacks; `stack` = always stack.
	// SEARCH: the root keeps `.setting-row` and the label `.sr-name`, the two hooks Settings'
	// filter reads (Settings.svelte "apply"), so a migrated row is still found by its name.
	// `id` names the row; the description gets `${id}-desc` for the control's describedby.
	import Badge from './Badge.svelte';
	import { rowFit } from '$lib/ui/rowFit.js';

	/** @type {{label?: string, description?: string, badge?: string, labelFor?: string, id?: string, wide?: boolean, stack?: boolean, disabled?: boolean, keywords?: string, desc?: import('svelte').Snippet, extra?: import('svelte').Snippet, children?: import('svelte').Snippet} & Record<string, any>} */
	let {
		label = '',
		description = '',
		badge = '',
		labelFor = undefined,
		id = undefined,
		wide = false,
		stack = false,
		disabled = false,
		keywords = undefined,
		desc = undefined,
		extra = undefined,
		children = undefined,
		...rest
	} = $props();

	const descId = $derived(id ? `${id}-desc` : undefined);
</script>

<div
	{id}
	class="tp-ui sr setting-row"
	class:sr-wide={wide}
	class:sr-stack={stack}
	class:sr-disabled={disabled}
	class:sr-no-control={!children}
	data-keywords={keywords}
	use:rowFit
	{...rest}
>
	<div class="sr-body">
	<div class="sr-text">
		<div class="sr-head">
			{#if labelFor}
				<label class="sr-name" for={labelFor}>{label}</label>
			{:else}
				<span class="sr-name">{label}</span>
			{/if}
			{#if badge}<Badge tone="scope" text={badge} />{/if}
		</div>
		{#if desc}
			<p class="sr-desc" id={descId}>{@render desc()}</p>
		{:else if description}
			<p class="sr-desc" id={descId}>{description}</p>
		{/if}
	</div>
	{#if children}
		<div class="sr-control">{@render children()}</div>
	{/if}
	{#if extra}
		<div class="sr-extra">{@render extra()}</div>
	{/if}
	</div>
</div>

<style>
	/* the row; its body is the grid (41b: no container query any more — rowFit measures the fit) */
	.sr {
		padding: var(--setting-row-pad-y) 18px;
		color: var(--text);
		font-size: var(--fs-body);
	}
	/* grid, not flex: legacy ui.css flips `.setting-row` to a flex COLUMN under 600px — that now
	   reaches only the root, whose one child is this grid */
	.sr-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'text control' 'extra extra';
		align-items: center;
		column-gap: var(--space-6);
		row-gap: 0;
		min-width: 0;
		/* the containing block of rowFit's absolutely-positioned measuring probe */
		position: relative;
	}
	.sr-text {
		grid-area: text;
		min-width: 0;
		width: auto;
	}
	.sr-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.sr-name {
		font-size: var(--fs-body);
		font-weight: 500;
		line-height: 1.35;
		color: var(--text);
	}
	.sr-desc {
		margin: 4px 0 0;
		font-size: var(--fs-desc);
		line-height: 1.45;
		color: var(--text-muted);
	}
	.sr-desc :global(a) {
		color: var(--accent-text);
	}
	.sr-control {
		grid-area: control;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
	}
	.sr-extra {
		grid-area: extra;
		min-width: 0;
		margin-top: var(--space-3);
	}
	.sr-no-control .sr-body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'text' 'extra';
	}
	/* a WIDE control on its own full-width line under the label (any width) */
	.sr-stack .sr-body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'text' 'control' 'extra';
		row-gap: var(--space-3);
	}
	.sr-stack .sr-control {
		justify-content: stretch;
	}
	.sr-stack .sr-control > :global(*) {
		flex: 1 1 auto;
	}
	.sr-disabled .sr-text {
		opacity: 0.55;
	}
	@media (max-width: 639.98px) {
		.sr {
			padding: var(--setting-row-pad-y) var(--space-4);
		}
		.sr-body {
			column-gap: var(--space-4);
		}
		.sr-desc {
			line-height: 1.4;
		}
	}
	/* 41b H12/H13: the measured verdict (rowFit.js) — a control that cannot fit beside the label goes
	   under it. A segmented control, a slider, a text field or a `wide` row stretches across; anything
	   else (a select, a button, a number with its unit, a select + preview pair) keeps its own width. */
	.sr:global(.sr-fit-stack) > .sr-body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'text' 'control' 'extra';
		row-gap: var(--space-3);
	}
	.sr:global(.sr-fit-stack) > .sr-body > .sr-control {
		justify-content: flex-start;
	}
	.sr:global(.sr-fit-stack):is(.sr-wide, :has(> .sr-body > .sr-control :global(:is(.seg, .sl, .settings-text, textarea)))) > .sr-body > .sr-control {
		justify-content: stretch;
	}
	.sr:global(.sr-fit-stack):is(.sr-wide, :has(> .sr-body > .sr-control :global(:is(.seg, .sl, .settings-text, textarea)))) > .sr-body > .sr-control > :global(*) {
		flex: 1 1 auto;
	}
	/* a stacked segmented control shares the row between its options (Shadow quality in 1.31) */
	.sr:global(.sr-fit-stack) > .sr-body > .sr-control :global(.seg > .seg-opt) {
		flex: 1 1 0;
	}
	/* a segmented control too wide even for the whole row: its options in two columns, never one
	   word spilling out of its slot (the phone's "Double-click action") */
	.sr:global(.sr-seg-wrap) > .sr-body > .sr-control:not(:global(.sr-probe)) :global(.seg) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		width: 100%;
	}
	/* an `extra` snippet that rendered nothing (a shortcut row with no conflict) takes no room */
	.sr-extra:not(:has(*)) {
		display: none;
	}
</style>
