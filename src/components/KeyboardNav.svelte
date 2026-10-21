<script>
	// 53 A3 — the keyboard's way around the app, in one place:
	//   - THE SKIP LINK, the first thing Tab reaches: "Skip to the 3D viewport" focuses #viewport.
	//   - ESC LEAVES THE VIEWPORT (no keyboard trap in the canvas): with focus on the 3D view and
	//     nothing else wanting the key (a mesh/sculpt/measure session, an isolation, focus mode),
	//     Escape hands focus back to whatever sent it there — the skip link by default.
	//   - F6 / Shift+F6 cycle the app's REGIONS (top bar, panels, docks, toolbar, viewport), the
	//     desktop convention for "jump between panes"; a region that is not on screen is skipped.
	// The region list lives in `REGIONS` (keyboardNav.js would have to import the stores this file
	// reads, and shortcuts.js reads keyboardNav — it stays a leaf).
	import { onMount } from 'svelte';
	import { focusViewport, focusablesIn, isShown } from '$lib/keyboardNav';
	import { keySessionOpen } from '$lib/shortcuts';
	import { isIsolated } from '$lib/objectActions';
	import { focusActive } from '$lib/focusMode';

	/** Regions in reading order: top-left to bottom-right, the viewport last. Each entry is a
	 *  selector list; the first match on screen is the region. */
	const REGIONS = [
		'#logo-menu',
		'#sidebar70',
		'.connect-wrap',
		'#hud-tr',
		'#avatar-trigger',
		'#object-list',
		'#inspector',
		'.tp-window:not(#object-list)',
		'.tp-dock-panel',
		'#controls-pill',
		'#hud-stack-left',
		'#hud-stack-right',
		'#viewport'
	];

	/** @type {HTMLAnchorElement | undefined} */
	let link = $state();
	/** where Escape sends focus back to from the viewport @type {HTMLElement | null} */
	let cameFrom = null;

	/** @param {MouseEvent} e */
	function skip(e) {
		e.preventDefault();
		enterViewport(link ?? null);
	}

	/** @param {HTMLElement | null} from */
	function enterViewport(from) {
		cameFrom = from;
		focusViewport();
	}

	function leaveViewport() {
		const back = cameFrom && cameFrom.isConnected && isShown(cameFrom) ? cameFrom : link;
		cameFrom = null;
		back?.focus();
	}

	/** every region element on screen, in REGIONS order (one per entry, first visible match) */
	function regions() {
		/** @type {HTMLElement[]} */
		const out = [];
		for (const sel of REGIONS) {
			const el = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(sel)]).find((n) => isShown(n) && !out.some((o) => o.contains(n) || n.contains(o)));
			if (el) out.push(el);
		}
		return out;
	}

	/** focus a region: a toolbar's roving item first, else its first control, else the region */
	/** @param {HTMLElement} el */
	function focusRegion(el) {
		if (el.id === 'viewport') return enterViewport(/** @type {HTMLElement} */ (document.activeElement));
		const target = el.matches('a[href], button, input, select, textarea, [tabindex]') && el.getAttribute('tabindex') !== '-1' ? el : (focusablesIn(el).find((n) => n.getAttribute('tabindex') !== '-1') ?? focusablesIn(el)[0]);
		if (target) target.focus();
		else {
			if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
			el.focus();
		}
	}

	/** @param {1 | -1} step */
	function cycle(step) {
		const list = regions();
		if (!list.length) return;
		const active = document.activeElement;
		const at = list.findIndex((r) => r === active || (active && r.contains(active)));
		const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
		focusRegion(list[next]);
	}

	onMount(() => {
		/** the viewport's Escape: decided BEFORE the app's own Escape handlers run (capture), acted
		 *  on after them (a task later) — a session that Escape ends must not also lose the view */
		let busy = false;
		/** @param {KeyboardEvent} e */
		const capture = (e) => {
			if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				e.stopPropagation();
				cycle(e.shiftKey ? -1 : 1);
				return;
			}
			const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
			if (e.key !== 'Escape' || target?.id !== 'viewport') return;
			busy = keySessionOpen() || isIsolated() || focusActive();
			if (busy) return;
			setTimeout(() => {
				if (e.defaultPrevented || document.activeElement !== target) return;
				leaveViewport();
			}, 0);
		};
		window.addEventListener('keydown', capture, true);
		return () => window.removeEventListener('keydown', capture, true);
	});
</script>

<a bind:this={link} id="skip-to-viewport" class="kb-skip" href="#viewport" onclick={skip}>Skip to the 3D viewport</a>

<style>
	/* off screen until it has keyboard focus — then a pill at the top-left, over everything */
	.kb-skip {
		position: fixed;
		left: var(--space-2, 8px);
		top: var(--space-2, 8px);
		z-index: var(--z-toast);
		padding: 8px 14px;
		border-radius: var(--radius-pill, 999px);
		background: var(--surface-1);
		color: var(--text);
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow-window);
		font-family: var(--font-ui);
		font-size: var(--fs-body);
		text-decoration: none;
		transform: translateY(calc(-100% - 24px));
	}
	.kb-skip:focus,
	.kb-skip:focus-visible {
		transform: none;
	}
</style>
