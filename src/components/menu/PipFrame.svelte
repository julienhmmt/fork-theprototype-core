<script>
	// 43 K5 — THE PiP WINDOW, one component for every picture-in-picture (the camera preview, 16-Q4, and
	// the maximized dock's viewport PiP). Chrome only: a frame, a title bar with the caller's buttons, a
	// close button, the dragging and a CORNER resize grip; the picture is drawn into `canvas` by the render
	// loop ($lib/pipViews), so this component never touches WebGL.
	//
	// The grip sits on the TOP-LEFT corner: a PiP parks bottom-right, so the corner that faces the screen
	// is the one a hand reaches for, and the bottom-right corner stays where it is while the box grows.
	// Dragging is the 16-Q4/Q5 contract: the title bar drags with the left button, the body with the
	// RIGHT button (left stays the picture's — an interactive PiP orbits with it), touch HOLDS anywhere
	// on the bar. Positions and sizes are the CALLER's (`rect` in, `onrect` out): the caller clamps and
	// remembers them.
	import Icon from '../ui/Icon.svelte';

	/** @type {{
	 *   id?: string,
	 *   title: string,
	 *   rect: {x: number, y: number, w: number, h: number},
	 *   onrect: (rect: {x: number, y: number, w: number, h: number}, kind: 'move'|'resize', done: boolean) => void,
	 *   onclose?: () => void,
	 *   onreset?: () => void,
	 *   closeTitle?: string,
	 *   aspect?: number,
	 *   minH?: number,
	 *   z?: string,
	 *   hint?: string,
	 *   interactive?: boolean,
	 *   canvas?: HTMLCanvasElement | null,
	 *   buttons?: import('svelte').Snippet,
	 *   children?: import('svelte').Snippet,
	 *   [key: string]: any
	 * }} */
	let {
		id = undefined,
		title,
		rect,
		onrect,
		onclose = undefined,
		onreset = undefined,
		closeTitle = 'Close',
		aspect = 0,
		minH = 90,
		z = 'var(--z-canvas-overlay)',
		hint = '',
		interactive = false,
		canvas = $bindable(null),
		buttons = undefined,
		children = undefined,
		...rest
	} = $props();

	/** @type {null | {kind: 'move'|'resize', x: number, y: number, from: {x: number, y: number, w: number, h: number}, pointer: number}} */
	let gesture = $state(null);
	/** @type {any} */
	let holdTimer = null;

	/** @param {PointerEvent} e */
	function onFramePointerDown(e) {
		const target = /** @type {any} */ (e.target);
		if (target?.closest?.('.pip-btn')) return;
		const onBar = !!target?.closest?.('.pip-bar');
		const onGrip = !!target?.closest?.('.pip-grip');
		const touch = e.pointerType !== 'mouse';
		if (onGrip) return begin(e, 'resize');
		if (touch) {
			// touch: HOLD the title bar to drag, so a tap still reaches the buttons and the picture keeps
			// its own gestures
			if (!onBar) return;
			const ev = e;
			holdTimer = setTimeout(() => begin(ev, 'move'), 350);
			return;
		}
		// (an INTERACTIVE picture keeps its right button: it pans the view inside — move by the bar)
		if ((e.button === 2 && (!interactive || onBar)) || (e.button === 0 && onBar)) begin(e, 'move');
	}

	/** @param {PointerEvent} e @param {'move'|'resize'} kind */
	function begin(e, kind) {
		gesture = { kind, x: e.clientX, y: e.clientY, from: { ...rect }, pointer: e.pointerId };
		e.preventDefault?.();
		e.stopPropagation?.();
		window.addEventListener('pointermove', onMove, true);
		window.addEventListener('pointerup', onUp, true);
		window.addEventListener('pointercancel', onUp, true);
	}

	/** @param {PointerEvent} e */
	function next(e) {
		if (!gesture) return rect;
		const dx = e.clientX - gesture.x;
		const dy = e.clientY - gesture.y;
		const f = gesture.from;
		if (gesture.kind === 'move') return { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h };
		// the top-left grip: the bottom-right corner stays put; an aspect-locked frame takes its height
		// from whichever way the pointer moved further
		let h = Math.max(minH, f.h - dy);
		let w = aspect ? h * aspect : Math.max(minH, f.w - dx);
		if (aspect && Math.abs(dx) > Math.abs(dy) * aspect) {
			w = Math.max(minH * aspect, f.w - dx);
			h = w / aspect;
		}
		return { x: f.x + f.w - w, y: f.y + f.h - h, w: Math.round(w), h: Math.round(h) };
	}

	/** @param {PointerEvent} e */
	function onMove(e) {
		if (!gesture || e.pointerId !== gesture.pointer) return;
		e.preventDefault();
		e.stopPropagation();
		onrect(next(e), gesture.kind, false);
	}

	/** @param {PointerEvent} e */
	function onUp(e) {
		clearTimeout(holdTimer);
		if (!gesture || e.pointerId !== gesture.pointer) return;
		onrect(next(e), gesture.kind, true);
		gesture = null;
		window.removeEventListener('pointermove', onMove, true);
		window.removeEventListener('pointerup', onUp, true);
		window.removeEventListener('pointercancel', onUp, true);
	}

	$effect(() => () => {
		clearTimeout(holdTimer);
		window.removeEventListener('pointermove', onMove, true);
		window.removeEventListener('pointerup', onUp, true);
		window.removeEventListener('pointercancel', onUp, true);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	{id}
	class="pip"
	class:pip-drag={gesture?.kind === 'move'}
	class:pip-sizing={gesture?.kind === 'resize'}
	class:pip-live={interactive}
	style="left: {rect.x}px; top: {rect.y}px; width: {rect.w}px; height: {rect.h}px; z-index: {z};"
	onpointerdown={onFramePointerDown}
	onpointerup={() => clearTimeout(holdTimer)}
	oncontextmenu={(e) => e.preventDefault()}
	{...rest}
>
	<canvas bind:this={canvas} class="pip-canvas"></canvas>
	{@render children?.()}
	<div class="pip-bar">
		<span class="pip-title" {title}>{title}</span>
		{@render buttons?.()}
		{#if onclose}
			<button class="pip-btn pip-close" title={closeTitle} aria-label={closeTitle} onclick={onclose}><Icon name="x" size={16} /></button>
		{/if}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="pip-grip" title="Drag to resize (double-click: default size)" ondblclick={() => onreset?.()}></div>
	{#if hint}<p class="pip-hint">{hint}</p>{/if}
</div>

<style>
	.pip {
		position: fixed;
		border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
		border-radius: 6px;
		box-shadow: var(--shadow-window);
		pointer-events: auto;
		overflow: hidden;
		background: var(--surface-deep);
	}
	.pip-drag {
		border-color: var(--accent);
		cursor: grabbing;
	}
	.pip-sizing {
		border-color: var(--accent);
	}
	.pip-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.pip-live .pip-canvas {
		touch-action: none;
		cursor: grab;
	}
	.pip-bar {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px 2px 18px;
		background: color-mix(in srgb, var(--bg-app) 72%, transparent);
		font-size: 10px;
		color: var(--text);
		cursor: grab;
		touch-action: none;
	}
	.pip-title {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.pip :global(.pip-btn) {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 3px;
		line-height: 1;
		color: var(--text-2);
		background: color-mix(in srgb, var(--text-faint) 20%, transparent);
	}
	.pip :global(.pip-btn:hover) {
		background: color-mix(in srgb, var(--text-faint) 45%, transparent);
		color: var(--text);
	}
	/* the corner grip: a small triangle in the top-left corner, over the bar's padding */
	.pip-grip {
		position: absolute;
		left: 0;
		top: 0;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
		touch-action: none;
		background: linear-gradient(135deg, var(--accent) 0 40%, transparent 41%);
		opacity: 0.75;
	}
	.pip-grip:hover {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.pip-grip {
			width: 24px;
			height: 24px;
		}
		.pip-bar {
			padding-left: 28px;
		}
	}
	.pip-hint {
		position: absolute;
		bottom: 2px;
		right: 5px;
		margin: 0;
		font-size: 9px;
		color: color-mix(in srgb, var(--text) 50%, transparent);
		pointer-events: none;
	}
</style>
