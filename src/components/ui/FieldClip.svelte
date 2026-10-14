<script>
	// 43 J3: makes a hand-built Inspector row a clipboard field — copy / paste / reset through
	// the shared field menu ($lib/fieldMenu) — and joins it to its Section's "Copy section".
	// Layout-neutral (`display: contents`): wrap the row's markup, pass what it holds:
	//   <FieldClip clip={{kind: 'color', name: 'Sun color', get, set, reset}}> … </FieldClip>
	// The fields drawn inside (a value box, a select) stop answering on their own.
	import { claimFieldScope, fieldClip, fieldClipScope } from '$lib/fieldMenu';

	/** @type {{clip: any, children?: import('svelte').Snippet}} */
	let { clip, children = undefined } = $props();

	const scope = fieldClipScope();
	const spec = () => clip ?? null;
	$effect(() => scope?.section?.add(spec));
	claimFieldScope();
</script>

<div class="fc" data-field={clip?.name} use:fieldClip={spec}>{@render children?.()}</div>

<style>
	.fc {
		display: contents;
	}
</style>
