<script>
	// 41b H1 — THE PHONE DOCK'S CONTENT TABS: the frame Properties, Configure Scene, Objects, Notes
	// and Layouts sit in on a phone ($lib/phoneDock keeps the bookkeeping). It is the bottom dock's
	// own frame — the same `.tp-dock-panel` box, height and tab strip as the Explorer or the Node
	// editor (DockTabs, PhoneShell's grab bar over its top edge) — so a content tab and an editor
	// tab are one strip, one height, one grab bar.
	//
	// It REUSES the panels, the PhoneShell way: the Inspector, the object list and the notes list
	// stay the components they are (their ids, stores and handlers untouched) and are placed into
	// this frame's body by CSS (`[data-pd-host]`, phone.css + ui.css for the Inspector), so a
	// panel that is open but behind another tab stays mounted, exactly like a hidden dock tab.
	// The Layouts list has no element of its own to move (its wider-screen home is a dialog), so
	// it renders here.
	//
	// Always mounted with the editor chrome: the posture watcher has to see a fold / unfold while
	// the phone shell itself is unmounted (in Play, say).
	import { onMount, tick } from 'svelte';
	import DockTabs from '../DockTabs.svelte';
	import EmptyState from '../ui/EmptyState.svelte';
	import WorkspaceLayouts from '../menu/WorkspaceLayouts.svelte';
	import { dockHeight } from '$lib/bottomDock';
	import { phoneDockShown, phoneTabsOpen, startPhoneDock } from '$lib/phoneDock';
	import { phoneShell } from '$lib/ui/phoneShell.js';
	import { selectedObjects } from '../../stores/sceneStore';
	import { inspectorKind } from '../../stores/appStore';
	import { moduleSelection } from '$lib/moduleContent';
	import { minimalScroll } from '$lib/ui/minimalScroll.js';

	onMount(() => startPhoneDock());

	const anyOpen = $derived(Object.values($phoneTabsOpen).some(Boolean));
	// Properties with nothing selected has nothing to show (the Inspector would show the last
	// object, which the selection no longer holds): the frame says so instead
	const nothingSelected = $derived(
		$phoneDockShown === 'properties' && $inspectorKind !== 'file' && !($selectedObjects ?? []).length && !$moduleSelection
	);

	// ---- the reused elements -------------------------------------------------------------
	/** content tab -> the element it reuses (Layouts renders in the frame) */
	const HOST_OF = { properties: '#inspector', scene: '#inspector', objects: '#object-list', notes: '#notes-drawer' };
	function clearHosts() {
		for (const el of document.querySelectorAll('[data-pd-host]')) el.removeAttribute('data-pd-host');
	}
	function markHosts() {
		if (!$phoneShell) return clearHosts();
		const shown = $phoneDockShown;
		const open = /** @type {Record<string, boolean>} */ ($phoneTabsOpen);
		/** @type {Map<Element, string>} */
		const want = new Map();
		for (const [key, sel] of Object.entries(HOST_OF)) {
			if (!open[key]) continue;
			const el = document.querySelector(sel);
			if (!el) continue;
			const on = shown === key && !(key === 'properties' && nothingSelected);
			if (on || !want.has(el)) want.set(el, on ? 'shown' : 'hidden');
		}
		for (const el of document.querySelectorAll('[data-pd-host]')) if (!want.has(el)) el.removeAttribute('data-pd-host');
		for (const [el, v] of want) if (el.getAttribute('data-pd-host') !== v) el.setAttribute('data-pd-host', v);
	}
	$effect(() => {
		void $phoneShell;
		void $phoneDockShown;
		void $phoneTabsOpen;
		void nothingSelected;
		// an element may mount a frame after its store flips (the Inspector's fly-in, the object
		// list's chunked tree): try now, after the flush, on the next frame and once more
		markHosts();
		tick().then(markHosts);
		const raf = requestAnimationFrame(markHosts);
		const late = setTimeout(markHosts, 250);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(late);
		};
	});
	onMount(() => () => clearHosts());

	// ---- the body rect the reused elements are placed into ----------------------------------
	let bodyEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
	$effect(() => {
		const el = bodyEl;
		if (!el) return;
		const root = document.documentElement.style;
		const publish = () => {
			root.setProperty('--pd-top', Math.round(el.getBoundingClientRect().top) + 'px');
			// the frame's own top edge (a note card opened from the Notes tab covers the whole frame)
			if (el.parentElement) root.setProperty('--pd-frame-top', Math.round(el.parentElement.getBoundingClientRect().top) + 'px');
		};
		publish();
		// on the NEXT frame: the write moves the re-seated panel, which has observers of its own
		// (minimalScroll), and a synchronous write inside this callback re-entered them in the same
		// frame — "ResizeObserver loop completed with undelivered notifications", the app's error toast
		let raf = 0;
		const later = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(publish);
		};
		const ro = new ResizeObserver(later);
		ro.observe(el);
		window.addEventListener('resize', later);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			window.removeEventListener('resize', later);
			root.removeProperty('--pd-top');
			root.removeProperty('--pd-frame-top');
		};
	});
</script>

{#if $phoneShell && anyOpen}
	<div
		id="phone-dock"
		class="tp-themed tp-ui tp-dock-panel pd-frame fixed inset-x-0 bottom-0 flex flex-col {$phoneDockShown ? '' : 'hidden'}"
		style="z-index: var(--z-dock); height: {$dockHeight}px; border-top: 1px solid var(--tp-line)"
		data-key-scope="panel"
		data-phone-tab={$phoneDockShown ?? ''}
		role="region"
		aria-label="Docked panels"
	>
		<DockTabs />
		<div class="pd-body" bind:this={bodyEl}>
			{#if $phoneDockShown === 'layouts'}
				<div class="pd-layouts" id="phone-dock-layouts" use:minimalScroll>
					<WorkspaceLayouts idPrefix="layouts-menu" />
				</div>
			{:else if nothingSelected}
				<EmptyState id="phone-dock-no-selection" icon="sliders-horizontal" title="Nothing selected" description="Select an object to see its properties here." />
			{/if}
		</div>
	</div>
{/if}

<style>
	.pd-frame {
		background: var(--surface-1);
	}
	.pd-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.pd-layouts {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) var(--space-3) var(--space-4);
	}
</style>
