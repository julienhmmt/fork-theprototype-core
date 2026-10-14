<script>
	// 42 I14 — the way OUT of focus mode that needs no keyboard (a phone, a pen, a mouse user who
	// does not know the key): one small pill, top centre, over the maximized area. Esc and Ctrl+Space
	// do the same. It also wires the focus-mode module (pointer tracking + the auto-exits) once.
	import { onMount } from 'svelte';
	import Button from '../ui/Button.svelte';
	import { focusMode, exitFocus, startFocusMode } from '$lib/focusMode';

	onMount(() => startFocusMode());
</script>

{#if $focusMode}
	<div id="focus-exit" class="focus-exit" data-focus-kind={$focusMode}>
		<Button variant="secondary" size="sm" icon="minimize-2" title="Leave focus mode (Esc or Ctrl+Space)" onclick={exitFocus}>Exit focus</Button>
	</div>
{/if}

<style>
	.focus-exit {
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
	   at the strip's height, instead of holding a band of its own above it */
	:global(:root:not(.phone-shell)) .focus-exit[data-focus-kind='dock'] {
		top: 0;
		left: auto;
		right: 96px;
		translate: none;
	}
	:global(:root:not(.phone-shell)) .focus-exit[data-focus-kind='dock'] :global(.btn) {
		height: 24px;
		min-height: 24px;
		padding-block: 0;
	}
</style>
