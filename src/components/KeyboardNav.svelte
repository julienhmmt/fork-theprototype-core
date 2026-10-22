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
	import { get } from 'svelte/store';
	import { focusViewport, focusablesIn, isShown, isViewportTarget, trackFocus } from '$lib/keyboardNav';
	import { keySessionOpen } from '$lib/shortcuts';
	import { isIsolated } from '$lib/objectActions';
	import { focusActive } from '$lib/focusMode';
	import { canvasCenter } from '$lib/canvasRect';
	import { closeMenu, notificationCenterOpen, connectDrawerOpen, notesDrawerOpen, peersPanelOpen, objectContextMenu, viewportMenuOpener } from '../stores/appStore.js';
	import { selectedObjects, lockedObjects } from '../stores/sceneStore.js';

	/** POPOVERS THAT ESCAPE CLOSES while they hold the focus (none of them had a key of their own),
	 *  and the trigger the focus goes back to. A surface whose own handler takes Escape (a menu, a
	 *  dialog, a field) prevents it first, so this never doubles up. */
	const DISMISS = [
		{ within: '#sidebar70, #logo-menu', open: () => !get(closeMenu), close: () => closeMenu.set(true), back: '#logo-menu' },
		{ within: '#notif-panel, #notif-bell', open: () => get(notificationCenterOpen), close: () => notificationCenterOpen.set(false), back: '#notif-bell' },
		{ within: '[data-testid="connect-info-drawer"], #connect-info-button', open: () => get(connectDrawerOpen), close: () => connectDrawerOpen.set(false), back: '#connect-info-button' },
		{ within: '#notes-drawer, #notes-toggle', open: () => get(notesDrawerOpen), close: () => notesDrawerOpen.set(false), back: '#notes-toggle' },
		{ within: '#peers-popover, #peers-trigger', open: () => get(peersPanelOpen), close: () => peersPanelOpen.set(false), back: '#peers-trigger' }
	];

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

	/** Shift+F10 / the Menu key on the 3D view or the object tree: the selection's object menu
	 *  (at its row, or the canvas centre), else the viewport's own menu — a right-click without a
	 *  mouse. Elsewhere the browser's `contextmenu` reaches the focused control's own handler.
	 *  @param {HTMLElement | null} target */
	function keyboardContextMenu(target) {
		const tree = target?.closest?.('#object-tree');
		if (!tree && !isViewportTarget(target)) return false;
		const centre = canvasCenter();
		const sel = get(selectedObjects);
		const uuid = sel.length ? sel[sel.length - 1] : null;
		if (uuid) {
			const row = tree ? /** @type {HTMLElement | null} */ (tree.querySelector('.selected, [aria-selected="true"]')) : null;
			const r = (row ?? tree)?.getBoundingClientRect();
			objectContextMenu.set({
				x: r ? r.left + Math.min(r.width, 160) : centre.x,
				y: r ? r.top + r.height : centre.y,
				uuid,
				point: null,
				locked: !!get(lockedObjects).find((/** @type {any} */ lock) => lock[1] === uuid)
			});
			return true;
		}
		const open = /** @type {any} */ (get(viewportMenuOpener));
		if (!open) return false;
		open(centre.x, centre.y, true);
		return true;
	}

	onMount(() => {
		trackFocus();
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
		/** after every handler in the app: an Escape nobody took closes the popover holding focus,
		 *  and the Menu key / Shift+F10 opens a context menu where no control would get one
		 *  @param {KeyboardEvent} e */
		const bubble = (e) => {
			if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
			const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
			if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
				if (keyboardContextMenu(target)) e.preventDefault();
				return;
			}
			if (e.key !== 'Escape' || !target) return;
			for (const d of DISMISS) {
				if (!target.closest(d.within) || !d.open()) continue;
				e.preventDefault();
				d.close();
				/** @type {HTMLElement | null} */ (document.querySelector(d.back))?.focus();
				return;
			}
		};
		window.addEventListener('keydown', capture, true);
		window.addEventListener('keydown', bubble);
		return () => {
			window.removeEventListener('keydown', capture, true);
			window.removeEventListener('keydown', bubble);
		};
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
		font-family: var(--font-ui);
		font-size: var(--fs-body);
		text-decoration: none;
		/* parked well above the window, shadowless: a window shadow's blur reached back into the
		   corner from just above the edge (the A/B caught it) */
		transform: translateY(-200px);
	}
	.kb-skip:focus,
	.kb-skip:focus-visible {
		transform: none;
		box-shadow: var(--shadow-window);
	}
</style>
