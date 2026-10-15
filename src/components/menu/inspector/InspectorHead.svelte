<script>
	// 38 R5 — the Inspector's sticky top: WindowChrome `panel` (icon · title · kind badge ·
	// pin · close) and, below it, the property filter in the one SearchField style. Chrome
	// only: pin/close/filter are the Inspector's own stores, unchanged (SPEC §0) — `#drawer-label`
	// (the sticky block Section deep links measure), `#inspector-pin` and `#inspector-search`
	// keep their ids for every caller and suite.
	// 42 I1: `panel` ('scene' | 'properties') gives the header its LOCK button — the header sticks
	// (the default) or scrolls away with the properties, remembered per panel ($lib/panelHeaderPrefs,
	// Settings ▸ Interface ▸ "Sticky panel headers"). One component, so the phone's sheet / dock tab
	// and the desktop sidebars all get it. `#inspector-sticky-head` is the button's id.
	// 43 J6: on a wider screen the lock belongs to the SIDEBAR — it sits in the sidebar's header strip
	// beside "Full height" (SidebarStrips.svelte, same id, same store); the phone keeps it here.
	import WindowChrome from '../../ui/WindowChrome.svelte';
	import SearchField from '../../ui/SearchField.svelte';
	import Badge from '../../ui/Badge.svelte';
	import Icon from '../../ui/Icon.svelte';
	import { inspectorFilter } from '../../../stores/appStore';
	import { stickyPanelHeads, toggleStickyHead } from '$lib/panelHeaderPrefs';
	import { sidebarsWide } from '$lib/sidebars';

	/** @type {{title?: string, badge?: string, icon?: string, pinned?: boolean, onpin?: (() => void) | null, onclose?: (() => void) | null, filter?: boolean, panel?: 'scene'|'properties'|''}} */
	let { title = '', badge = '', icon = '', pinned = false, onpin = null, onclose = null, filter = false, panel = '' } = $props();

	/** 42 I1: does this panel's header stick (the default) or scroll away with the content */
	const sticky = $derived(!panel || $stickyPanelHeads[panel] !== false);
	const panelName = $derived(panel === 'scene' ? 'Configure Scene' : 'Properties');
</script>

<div id="drawer-label" class="tp-ui ins-head" class:ins-head-flow={!sticky} data-sticky={sticky ? 'true' : 'false'}>
	<WindowChrome
		size="panel"
		{title}
		{icon}
		body={false}
		{pinned}
		{onpin}
		pinAttrs={{
			id: 'inspector-pin',
			title: pinned
				? 'Unpin — properties then open on double-click or via the context menu'
				: 'Pin — keep this panel open and follow the selection',
			'aria-label': pinned ? 'Unpin the properties panel' : 'Pin the properties panel'
		}}
		{onclose}
		closeLabel="Close the properties panel"
		style="border: 0; border-radius: 0; background: transparent; overflow: visible"
	>
		{#snippet actions()}
			{#if badge}<Badge tone="neutral" text={badge} data-inspector-badge />{/if}
			{#if panel && !$sidebarsWide}
				<button
					type="button"
					id="inspector-sticky-head"
					class="wc-act ins-sticky-btn"
					aria-pressed={sticky}
					aria-label={sticky ? `Let the ${panelName} header scroll away` : `Keep the ${panelName} header on top`}
					title={sticky
						? 'Header stays on top — click to let it scroll away with the properties'
						: 'Header scrolls away — click to keep it on top while you scroll'}
					onclick={() => toggleStickyHead(/** @type {'scene'|'properties'} */ (panel))}
				>
					<Icon name={sticky ? 'lock' : 'lock-open'} size={20} />
				</button>
			{/if}
		{/snippet}
	</WindowChrome>
	{#if filter}
		<div class="ins-filter">
			<!-- PFX-C follow-up: property search — Sections filter by rendered text -->
			<SearchField
				id="inspector-search"
				size="sm"
				placeholder="Filter properties"
				value={$inspectorFilter}
				oninput={(v) => inspectorFilter.set(v)}
				onkeydown={(/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && inspectorFilter.set('')}
			/>
		</div>
	{/if}
</div>

<style>
	/* sticky over the Inspector's scroller, full bleed across its 14px side padding */
	.ins-head {
		position: sticky;
		top: 0;
		z-index: 10;
		margin: 0 -14px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	/* 42 I1: unstuck — the header is the first thing in the scroller and scrolls away with it */
	.ins-head-flow {
		position: relative;
	}
	/* the lock's state is its glyph (lock / lock-open); ON is the default, so no pressed tint */
	.ins-head :global(.wc-head .ins-sticky-btn[aria-pressed='true']) {
		background: transparent;
		color: var(--text-muted);
	}
	.ins-head :global(.wc-head .ins-sticky-btn[aria-pressed='true']:hover) {
		background: var(--surface-hover);
		color: var(--text);
	}
	.ins-head :global(.wc-head) {
		border-bottom: 0;
	}
	.ins-filter {
		padding: 0 14px 10px;
	}
</style>
