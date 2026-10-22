<script>
	// 53-reader (A4): the app's two live regions — POLITE for toasts and selections, ASSERTIVE for
	// errors. Visually hidden (sr-only), mounted once at the App root and never inside a gated
	// block, so a toast hidden from the viewport (toastsInDrawerOnly) is still read aloud.
	// The text comes from `$lib/a11y/announce`; `startAnnouncers` decides what is said.
	import { onMount } from 'svelte';
	import { politeAnnouncement, assertiveAnnouncement } from '$lib/a11y/announce';
	import { startAnnouncers } from '$lib/a11y/announcers';

	onMount(() => startAnnouncers());
</script>

<div id="a11y-live-polite" class="sr-only" role="status" aria-live="polite" aria-atomic="true">{$politeAnnouncement}</div>
<div id="a11y-live-assertive" class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{$assertiveAnnouncement}</div>
