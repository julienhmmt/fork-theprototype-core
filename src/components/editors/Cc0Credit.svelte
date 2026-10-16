<script>
	// 47-cc0 (C2) — where a CC0 asset came from, in Properties: the Explorer's pane for a Library
	// item, the Inspector for a placed object or a CC0 material. Renders nothing for anything else.
	import { normalizeSource, CC0_SITES } from '$lib/cc0/cc0Core.js';

	/** @type {{source?: any, id?: string}} */
	let { source = null, id = undefined } = $props();
	const s = $derived(normalizeSource(source));
</script>

{#if s}
	<div class="cc0-credit" {id} data-cc0-site={s.site} data-cc0-id={s.id}>
		<span class="cc0-k">Source</span>
		<span class="cc0-v">
			{#if s.url}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>{:else}{s.name}{/if}
			{#if s.authors.length}<span class="cc0-by"> by {s.authors.join(', ')}</span>{/if}
			<span class="cc0-lic"> · {CC0_SITES[/** @type {'polyhaven'|'ambientcg'} */ (s.site)].label} · {s.license}</span>
		</span>
	</div>
{/if}

<style>
	.cc0-credit {
		display: flex;
		gap: 8px;
		font-size: 11px;
		line-height: 1.35;
	}
	.cc0-k {
		width: 3.5rem;
		flex-shrink: 0;
		color: var(--text-faint, var(--text-muted));
	}
	.cc0-v {
		min-width: 0;
		color: var(--text-2, var(--text));
		overflow-wrap: anywhere;
	}
	.cc0-v a {
		color: var(--accent);
		text-decoration: underline;
	}
	.cc0-by,
	.cc0-lic {
		color: var(--text-muted);
	}
</style>
