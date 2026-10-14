<script lang="ts">
	// 42 I2/I3 — the HEADER of each side's sidebar column ($lib/sidebars): one tab per panel docked
	// to that side (the Inspector, the Objects list, a docked Node editor / Explorer), the Full-height
	// pin at its far end, and the column's resize grip on its inner edge.
	//
	// A tab is the panel's handle (the Unity / Unreal docked-tab model): a press brings it to the
	// front, a DRAG moves the panel to the other side of the screen — the target column lights up
	// while the pointer is over that half, the drop docks it there. The header is drawn even for a
	// single tab, so the pin and the drag handle are always where the user expects them.
	import { onMount } from 'svelte';
	import Icon from '../ui/Icon.svelte';
	import {
		SIDES,
		startSidebars,
		sidebarTabs,
		sidebarShown,
		sidebarFull,
		sidebarsWide,
		activateSidebarTab,
		moveSidebarTab,
		toggleSidebarFull,
		setSidebarWidth,
		sidebarWidth,
		inspectorTabTitle
	} from '$lib/sidebars';
	import { inspectorKind } from '../../stores/appStore.js';
	import { DOCK_TITLES, DOCK_ICONS } from '$lib/bottomDock';

	onMount(() => startSidebars());

	type Side = 'left' | 'right';

	function titleOf(key: string, insTitle: string) {
		if (key === 'inspector') return insTitle;
		return DOCK_TITLES[key] ?? key;
	}
	function iconOf(key: string, kind: string) {
		if (key === 'inspector') return kind === 'scene' ? 'sun' : kind === 'file' ? 'file-text' : 'sliders-horizontal';
		return DOCK_ICONS[key] ?? 'app-window';
	}

	// ---- the tab drag: move a panel to the other side ----
	let drag = $state<{ key: string; from: Side; x: number; y: number; target: Side | null } | null>(null);
	let press: { key: string; from: Side; x0: number; y0: number; id: number } | null = null;
	let suppressClick = false;
	const DRAG_SLOP = 6;

	function onTabDown(e: PointerEvent, key: string, side: Side) {
		if (e.button !== 0) return;
		// a drag whose tab MOVED to the other strip never gets its click, so the flag is cleared here
		suppressClick = false;
		press = { key, from: side, x0: e.clientX, y0: e.clientY, id: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function onTabMove(e: PointerEvent) {
		if (!press || e.pointerId !== press.id) return;
		if (!drag && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < DRAG_SLOP) return;
		const half: Side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
		drag = { key: press.key, from: press.from, x: e.clientX, y: e.clientY, target: half === press.from ? null : half };
	}
	function onTabUp(e: PointerEvent) {
		if (!press || e.pointerId !== press.id) return;
		const d = drag;
		press = null;
		drag = null;
		if (!d) return;
		suppressClick = true; // the click that ends a drag is not a tab press
		if (d.target) moveSidebarTab(d.key, d.target);
	}
	function onTabClick(key: string) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		activateSidebarTab(key);
	}
	function onTabKey(e: KeyboardEvent, side: Side, key: string) {
		const tabs = $sidebarTabs[side];
		const i = tabs.indexOf(key);
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
			e.preventDefault();
			const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
			activateSidebarTab(next);
			(document.querySelector(`#sidebar-strip-${side} [data-sidebar-tab="${next}"]`) as HTMLElement | null)?.focus();
		}
	}

	// ---- the column's resize grip ----
	let sizing: { side: Side; x0: number; w0: number; id: number } | null = null;
	function onGripDown(e: PointerEvent, side: Side) {
		if (e.button !== 0) return;
		e.preventDefault();
		sizing = { side, x0: e.clientX, w0: $sidebarWidth[side], id: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function onGripMove(e: PointerEvent) {
		if (!sizing || e.pointerId !== sizing.id) return;
		const delta = sizing.side === 'left' ? e.clientX - sizing.x0 : sizing.x0 - e.clientX;
		setSidebarWidth(sizing.side, sizing.w0 + delta, false);
	}
	function onGripUp(e: PointerEvent) {
		if (!sizing || e.pointerId !== sizing.id) return;
		setSidebarWidth(sizing.side, $sidebarWidth[sizing.side], true);
		sizing = null;
	}
	/** double-click forgets the width (back to the default) */
	function onGripReset(side: Side) {
		setSidebarWidth(side, 320, true);
	}
</script>

{#if $sidebarsWide}
	{#each SIDES as side (side)}
		{#if $sidebarTabs[side].length}
			<div
				id="sidebar-strip-{side}"
				class="sb-strip tp-ui"
				class:sb-full={$sidebarFull[side]}
				data-side={side}
				role="tablist"
				aria-label="{side === 'left' ? 'Left' : 'Right'} sidebar"
				style="top: var(--sb-{side}-top); width: var(--sb-{side}-w); {side === 'left' ? 'left: var(--sb-left-x, 0px)' : 'right: 0px'}"
			>
				<div class="sb-tabs">
					{#each $sidebarTabs[side] as key (key)}
						<button
							class="sb-tab"
							class:on={$sidebarShown[side] === key}
							class:dragging={drag?.key === key}
							role="tab"
							aria-selected={$sidebarShown[side] === key}
							tabindex={$sidebarShown[side] === key ? 0 : -1}
							data-sidebar-tab={key}
							title="{titleOf(key, $inspectorTabTitle)} — drag to the other side of the screen to move it there"
							onpointerdown={(e) => onTabDown(e, key, side)}
							onpointermove={onTabMove}
							onpointerup={onTabUp}
							onpointercancel={() => {
								press = null;
								drag = null;
							}}
							onclick={() => onTabClick(key)}
							onkeydown={(e) => onTabKey(e, side, key)}
						>
							<Icon name={iconOf(key, $inspectorKind)} size={16} aria-hidden="true" />
							<span class="sb-tab-label">{titleOf(key, $inspectorTabTitle)}</span>
						</button>
					{/each}
				</div>
				<button
					id="sidebar-full-{side}"
					class="sb-pin"
					class:on={$sidebarFull[side]}
					aria-pressed={$sidebarFull[side]}
					aria-label="Full height"
					title={$sidebarFull[side]
						? 'Full height is on — this sidebar runs from the top edge to the bottom edge. Click to fit it under the top buttons again'
						: 'Full height — run this sidebar from the top edge to the bottom edge (the corner buttons move inward, the dock gets narrower)'}
					onclick={() => toggleSidebarFull(side)}
				>
					<Icon name="unfold-vertical" size={16} aria-hidden="true" />
				</button>
			</div>
			<!-- the column's width belongs to the SIDE: one grip on its inner edge resizes every tab -->
			<div
				id="sidebar-grip-{side}"
				class="sb-grip resize-cue"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize the {side} sidebar"
				title="Drag to resize · double-click to reset"
				style="top: var(--sb-{side}-top); bottom: var(--sb-{side}-bottom); {side === 'left'
					? 'left: calc(var(--sb-left-x, 0px) + var(--sb-left-w) - 3px)'
					: 'right: calc(var(--sb-right-w) - 3px)'}"
				onpointerdown={(e) => onGripDown(e, side)}
				onpointermove={onGripMove}
				onpointerup={onGripUp}
				ondblclick={() => onGripReset(side)}
			></div>
		{/if}
	{/each}

	{#if drag}
		<!-- the drop highlight: the column the panel will land in -->
		{#if drag.target}
			<div
				id="sidebar-drop-zone"
				class="sb-drop-zone"
				data-side={drag.target}
				style="top: var(--sb-{drag.target}-top); bottom: var(--sb-{drag.target}-bottom); width: var(--sb-{drag.target}-w); {drag.target === 'left'
					? 'left: var(--sb-left-x, 0px)'
					: 'right: 0px'}"
			>
				Move to the {drag.target} side
			</div>
		{/if}
		<div class="sb-ghost tp-ui" style="left: {drag.x + 12}px; top: {drag.y + 8}px">
			<Icon name={iconOf(drag.key, $inspectorKind)} size={16} aria-hidden="true" />
			{titleOf(drag.key, $inspectorTabTitle)}
		</div>
	{/if}
{/if}

<style>
	.sb-strip {
		position: fixed;
		z-index: calc(var(--z-dock) - 1);
		height: var(--sb-strip-h, 30px);
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding: 0 4px;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-bottom: 0;
		box-sizing: border-box;
	}
	.sb-strip[data-side='right'] {
		border-right: 0;
		border-top-left-radius: var(--radius-window);
	}
	.sb-strip[data-side='left'] {
		border-left: 0;
		border-top-right-radius: var(--radius-window);
	}
	.sb-strip.sb-full {
		border-radius: 0;
		border-top: 0;
	}
	:global(:root.connect-docked) .sb-strip {
		z-index: calc(var(--z-chrome-top) + 1);
	}
	.sb-tabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
	}
	.sb-tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 0 1 auto;
		padding: 0 10px;
		margin-top: 3px;
		border-radius: var(--radius-input) var(--radius-input) 0 0;
		font-size: var(--fs-desc);
		color: var(--text-muted);
		cursor: grab;
		touch-action: none;
		user-select: none;
		white-space: nowrap;
	}
	.sb-tab:hover {
		color: var(--text);
		background: var(--surface-hover);
	}
	.sb-tab.on {
		color: var(--text);
		background: var(--surface-2);
		box-shadow: inset 0 2px 0 var(--accent);
	}
	.sb-tab.dragging {
		opacity: 0.5;
	}
	.sb-tab-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sb-pin {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		margin: 3px 0;
		border-radius: var(--radius-input);
		color: var(--text-muted);
	}
	.sb-pin:hover {
		color: var(--text);
		background: var(--surface-hover);
	}
	.sb-pin.on {
		color: var(--accent-text);
		background: var(--accent-soft);
	}
	.sb-grip {
		position: fixed;
		z-index: var(--z-dock);
		width: 6px;
		cursor: ew-resize;
		touch-action: none;
	}
	.sb-ghost {
		position: fixed;
		z-index: var(--z-portal);
		pointer-events: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: var(--radius-input);
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow-window);
		font-size: var(--fs-desc);
		color: var(--text);
	}
</style>
