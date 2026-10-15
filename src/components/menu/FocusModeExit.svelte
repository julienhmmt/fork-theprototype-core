<script>
	// 42 I14 — the way OUT of focus mode that needs no keyboard (a phone, a pen, a mouse user who
	// does not know the key): one small pill, top centre, over the maximized area. Esc and Ctrl+Space
	// do the same. It also wires the focus-mode module (pointer tracking + the auto-exits) once.
	import { onMount } from 'svelte';
	import Button from '../ui/Button.svelte';
	import { focusMode, exitFocus, startFocusMode } from '$lib/focusMode';
	// 44 M15: the viewport preview's own switch, beside the way out — so a closed preview comes back without
	// leaving focus mode. Shown only while the preview COULD show (a docked window at full size, not the
	// folded phone); open / closed is remembered across focus sessions ($lib/viewportPip, default open).
	import { viewportPipClosed, viewportPipAvailable, toggleViewportPip } from '$lib/viewportPip';

	onMount(() => startFocusMode());

	// 44-int: in a maximized dock the pill rides in the strip row, left of the strip's own buttons. Their
	// count is not fixed (44 M9 added Split; Undock comes and goes) and nor is the pill's width (the Viewport
	// toggle), so both places are READ, once the pill is drawn: `--focus-exit-right` = clear of the visible
	// strip buttons, `--focus-exit-reach` = where the tab row must stop (windows.css). A frame after each
	// change (no ResizeObserver: these move the strip, which observers watch).
	/** @type {HTMLElement | undefined} */
	let pillEl = $state();
	let raf = 0;
	let tries = 0;
	function placeInStrip() {
		raf = 0;
		const root = document.documentElement;
		if ($focusMode !== 'dock' || !pillEl || root.classList.contains('phone-shell')) {
			root.style.removeProperty('--focus-exit-right');
			root.style.removeProperty('--focus-exit-reach');
			return;
		}
		const chrome = [...document.querySelectorAll('.dt-chrome')].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0 && r.top < 40);
		// the dock may still be growing into the top row: look again (capped)
		if (!chrome && tries++ < 30) raf = requestAnimationFrame(placeInStrip);
		const right = chrome ? Math.round(window.innerWidth - chrome.left + 16) : 96;
		root.style.setProperty('--focus-exit-right', right + 'px');
		root.style.setProperty('--focus-exit-reach', Math.round(right + pillEl.offsetWidth + 8) + 'px');
	}
	$effect(() => {
		void $focusMode;
		void $viewportPipAvailable;
		void pillEl;
		tries = 0;
		raf = requestAnimationFrame(placeInStrip);
		const onResize = () => {
			cancelAnimationFrame(raf);
			tries = 0;
			raf = requestAnimationFrame(placeInStrip);
		};
		window.addEventListener('resize', onResize);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

{#if $focusMode}
	<div id="focus-exit" class="focus-exit" data-focus-kind={$focusMode} bind:this={pillEl}>
		{#if $viewportPipAvailable}
			<Button
				id="focus-pip-toggle"
				variant={$viewportPipClosed ? 'outline' : 'secondary'}
				size="sm"
				icon="picture-in-picture-2"
				pressed={!$viewportPipClosed}
				title={$viewportPipClosed ? 'Show the viewport preview' : 'Hide the viewport preview'}
				onclick={toggleViewportPip}>Viewport</Button
			>
		{/if}
		<Button variant="secondary" size="sm" icon="minimize-2" title="Leave focus mode (Esc or Ctrl+Space)" onclick={exitFocus}>Exit focus</Button>
	</div>
{/if}

<style>
	.focus-exit {
		display: flex;
		gap: var(--space-1);
		position: fixed;
		top: var(--space-2);
		left: 50%;
		translate: -50% 0;
		z-index: var(--z-chrome-top);
		opacity: 0.55;
		transition: opacity 160ms ease-out;
	}
	.focus-exit:hover,
	.focus-exit:focus-within {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.focus-exit {
			opacity: 1;
			top: var(--space-1);
		}
	}
	/* 43 K5: a maximized docked window owns the whole window, its tab strip on the top edge — the pill
	   rides IN that strip row, left of the strip's own window buttons (DockTabs' right-hand group),
	   at the strip's height, instead of holding a band of its own above it (44-int: how far left is read) */
	:global(:root:not(.phone-shell)) .focus-exit[data-focus-kind='dock'] {
		top: 0;
		left: auto;
		right: var(--focus-exit-right, 96px);
		translate: none;
	}
	:global(:root:not(.phone-shell)) .focus-exit[data-focus-kind='dock'] :global(.btn) {
		height: 24px;
		min-height: 24px;
		padding-block: 0;
	}
</style>
