<script>
	// 44 M9 — THE DOCK SPLIT's own chrome ($lib/bottomDock dockSplits): the draggable vertical
	// divider between the two panes and, when the right pane has no window yet, that EMPTY pane
	// with its own "+" and helper line. The two views themselves are the ordinary docked panels
	// (and hosted windows), each placed in its pane by windows.css from `data-dock-pane` and the
	// root's `--dock-split-r`; this component draws only what belongs to the split itself.
	//
	// Divider: drag (mouse, pen or touch) moves it, the arrow keys nudge it (Shift = 10 %), a
	// double-click puts it back in the middle — the Blender / VS Code split-editor conventions.
	// The fraction is remembered with the pair.
	//
	// A press inside either pane brings that half to the front (`bottomDockActive`), so the strip's
	// pair tab, the undock button and the tab menu act on the half you are working in.
	import { onMount } from 'svelte';
	import { dockSplitView, dockHeight, setSplitRatio, activateDock, visibleDockKey, SPLIT_MIN } from '$lib/bottomDock';
	import { dockAddMenuAt } from '$lib/dockMenu';
	import Icon from './ui/Icon.svelte';
	import { cssPx } from '$lib/uiScale'; // 53 A1: a px token may read back as calc(...)

	const split = $derived($dockSplitView);

	/** the dock's usable span in viewport px (the sidebars' pinned columns excluded) */
	function span() {
		const css = getComputedStyle(document.documentElement);
		const left = cssPx(css.getPropertyValue('--sb-dock-left')) || 0;
		const right = cssPx(css.getPropertyValue('--sb-dock-right')) || 0;
		return { left, width: Math.max(1, window.innerWidth - left - right) };
	}

	let dragging = $state(false);
	/** @param {PointerEvent} e */
	function down(e) {
		if (!split || (e.pointerType === 'mouse' && e.button !== 0)) return;
		dragging = true;
		/** @type {HTMLElement} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
		e.preventDefault();
	}
	/** @param {PointerEvent} e */
	function move(e) {
		if (!dragging || !split) return;
		const s = span();
		setSplitRatio(split.a, (e.clientX - s.left) / s.width);
	}
	/** @param {PointerEvent} e */
	function up(e) {
		if (!dragging) return;
		dragging = false;
		/** @type {HTMLElement} */ (e.currentTarget).releasePointerCapture?.(e.pointerId);
	}
	/** @param {KeyboardEvent} e */
	function key(e) {
		if (!split) return;
		const step = e.shiftKey ? 0.1 : 0.02;
		let next = null;
		if (e.key === 'ArrowLeft') next = split.r - step;
		else if (e.key === 'ArrowRight') next = split.r + step;
		else if (e.key === 'Home') next = SPLIT_MIN;
		else if (e.key === 'End') next = 1 - SPLIT_MIN;
		if (next === null) return;
		e.preventDefault();
		e.stopPropagation();
		setSplitRatio(split.a, next);
	}

	/** the empty pane's "+": the dock's own menu, aimed at this pane @param {MouseEvent} e */
	function addHere(e) {
		if (!split) return;
		const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
		dockAddMenuAt.set({ x: r.left, y: r.bottom + 4, pane: split.a });
	}

	// a press in a pane fronts that half (capture: panel chrome swallows bubbling presses)
	onMount(() => {
		/** @param {PointerEvent} e */
		const press = (e) => {
			const sp = $dockSplitView;
			if (!sp) return;
			const el = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target)?.closest?.('[data-dock-pane], [data-pd-host-pane]'));
			if (!el || el.id === 'dock-split-empty' || el.closest('.dt-row, .dt-chrome')) return;
			const pane = el.getAttribute('data-dock-pane') || el.getAttribute('data-pd-host-pane');
			const keyOf = pane === 'a' ? sp.a : pane === 'b' ? sp.b : null;
			if (keyOf && keyOf !== $visibleDockKey) activateDock(keyOf);
		};
		window.addEventListener('pointerdown', press, true);
		return () => window.removeEventListener('pointerdown', press, true);
	});
</script>

{#if split}
	<!-- a focusable separator IS the ARIA window-splitter pattern (arrow keys move it) -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		id="dock-split-divider"
		class="dock-split-divider"
		class:dsd-drag={dragging}
		style="height: {$dockHeight}px"
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize the split"
		aria-valuemin={Math.round(SPLIT_MIN * 100)}
		aria-valuemax={Math.round((1 - SPLIT_MIN) * 100)}
		aria-valuenow={Math.round(split.r * 100)}
		tabindex="0"
		title="Drag to resize the split — double-click to centre it"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={key}
		ondblclick={() => split && setSplitRatio(split.a, 0.5)}
	></div>
	{#if !split.b}
		<div
			id="dock-split-empty"
			class="tp-themed tp-ui tp-dock-panel dock-split-empty"
			data-dock-pane="b"
			style="z-index: var(--z-dock); height: {$dockHeight}px"
			role="region"
			aria-label="Empty split pane"
		>
			<button id="dock-split-empty-add" class="tp-dtab tp-dtab-icon dse-add" title="Add a view to this pane" aria-label="Add a view to this pane" onclick={addHere}
				><Icon name="plus" size={20} aria-hidden="true" /></button
			>
			<div class="dse-hint">Press + or drag a tab here</div>
		</div>
	{/if}
{/if}

<style>
	.dock-split-divider {
		position: fixed;
		bottom: 0;
		left: calc(var(--dock-split-x) - 4px);
		width: 8px;
		z-index: calc(var(--z-dock) + 2);
		cursor: col-resize;
		touch-action: none;
		outline: none;
	}
	/* the visible line: one hairline, the accent while hovered / dragged / focused */
	.dock-split-divider::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 3px;
		width: 2px;
		background: var(--border);
	}
	.dock-split-divider:hover::after,
	.dock-split-divider:focus-visible::after,
	.dsd-drag::after {
		background: var(--accent);
	}
	.dock-split-empty {
		position: fixed;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
	}
	.dse-hint {
		color: var(--text-faint);
		font-size: var(--fs-desc);
		user-select: none;
	}
</style>
