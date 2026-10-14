<script>
	// 43 J3: the ONE field menu (copy / paste / reset on a row, a vector or a section). Rows
	// and section headers open it through `fieldMenu` ($lib/fieldMenu); it renders the shared
	// ContextMenu, which portals itself to <body>, clamps to the window and is a bottom sheet
	// on the phone.
	import ContextMenu from '../ContextMenu.svelte';
	import { fieldMenu } from '$lib/fieldMenu';
</script>

{#if $fieldMenu}
	<ContextMenu x={$fieldMenu.x} y={$fieldMenu.y} items={$fieldMenu.items} sizeKey="field" onclose={() => fieldMenu.set(null)} />
{/if}
