<script>
	// 44 M3 — the floating-window menu (right-click / long press on a window header or a group tab):
	// $lib/windowMenu builds the rows and decides when it opens; this only renders it.
	import { onMount } from 'svelte';
	import ContextMenu from '../ContextMenu.svelte';
	import { windowMenu, windowMenuItems, installWindowMenu } from '$lib/windowMenu';

	onMount(() => installWindowMenu());
</script>

{#if $windowMenu}
	<ContextMenu x={$windowMenu.x} y={$windowMenu.y} items={windowMenuItems($windowMenu)} sizeKey="window" onclose={() => windowMenu.set(null)} />
{/if}
