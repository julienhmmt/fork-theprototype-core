import { writable, get } from 'svelte/store';
import { anyModalOpen } from '../stores/appStore';
import { isLocked } from '../stores/sceneStore';
import { visibleDockKey, dockMinimized, activateDock, dockHeight } from './bottomDock';

// 42 I14 — FOCUS MODE (the user: "add focus mode? which hides all windows/tabs temporarily showing
// fullscreen viewport? maybe it can also work for docker window to open it on full screen").
// Decision (orchestrator, 2026-10-14): Ctrl+Space, Blender's "maximize area" — it toggles a maximize
// of the area under the POINTER:
//   · over a docked window (any dock tab, the hosted ones included) -> 'dock': that docked window fills
//     the browser window, every other piece of chrome hidden;
//   · anywhere else -> 'viewport': every piece of chrome hidden, the 3D view alone.
// Esc or Ctrl+Space again restores; View ▸ Focus mode (the viewport menu), the dock tab menu's
// "Maximize" and More ▸ Focus mode on a phone are the pointer / touch ways in; a small "Exit focus"
// pill is the touch way out.
//
// IT IS PRESENTATION ONLY: one attribute on <html> (`data-focus`) and CSS (windows.css "42 I14") that
// hides chrome with `display: none` — the path Play mode already takes for `#editor-chrome` — so no
// panel closes, no store changes, nothing replicates, and leaving restores exactly what was there.
// LOCAL and not persisted: a reload is the normal editor.
//
// It leaves on its own when what it hides would be needed: a modal opening (Settings from the command
// palette), entering Play (Play draws its own screen), and — in 'dock' — the dock going empty or
// minimized (there is nothing left to maximize).

/** @typedef {'viewport'|'dock'} FocusKind */

/** null = the normal editor @type {import('svelte/store').Writable<FocusKind|null>} */
export const focusMode = writable(/** @type {FocusKind|null} */ (null));

let px = -1;
let py = -1;
/** the last pointer position over the page, for "the area under the pointer" */
function track(/** @type {PointerEvent} */ e) {
	px = e.clientX;
	py = e.clientY;
}

/** the docked-window surfaces: an editor's own dock panel, the dock host frame and what it hosts */
const DOCK_SURFACE = '.tp-dock-panel:not(.hidden), [data-pd-host="shown"], #phone-dock:not(.hidden)';

/**
 * Which area is at (x, y): a docked window, or the viewport (everything else — the canvas, but also a
 * toolbar or a floating window: maximizing "the viewport" from over chrome is what a DCC's maximize
 * key does over a header, and it is the useful reading of an aim that is not a docked window).
 * @param {number} x @param {number} y @returns {FocusKind}
 */
export function areaAt(x, y) {
	if (typeof document === 'undefined' || x < 0 || y < 0) return 'viewport';
	const el = document.elementFromPoint(x, y);
	if (el && el.closest(DOCK_SURFACE)) return get(visibleDockKey) && !get(dockMinimized) ? 'dock' : 'viewport';
	return 'viewport';
}

/**
 * 'dock' fills the window by giving the dock the window's height for the duration: every docked
 * editor sizes its INSIDE from `dockHeight` too (the Explorer's shell, the Node editor's pane), so
 * stretching only the outer box left their content short. The height before is put back on exit.
 *
 * 43 K5 ("really full screen … this gap should cover the entire screen"): on the desktop layout the
 * dock's own tab strip rides at the window's TOP edge and the panel takes everything below it — no
 * band for the exit pill any more (the pill sits IN the strip row, FocusModeExit), and the pinned
 * sidebars give their width back for the duration (windows.css "43 K5"). The phone shell keeps the
 * 42 band: its dock host has no strip of its own to share.
 */
let heightBefore = /** @type {number|null} */ (null);
/** the dock tab strip's height (it hangs ABOVE the panel: DockTabs' `-top-6` row) */
export const DOCK_STRIP_H = 24;
export function fullDockHeight() {
	if (typeof window === 'undefined') return 600;
	const phone = document.documentElement.classList.contains('phone-shell');
	if (phone) {
		const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
		return Math.max(160, window.innerHeight - (coarse ? 56 : 48) - DOCK_STRIP_H);
	}
	return Math.max(160, window.innerHeight - DOCK_STRIP_H);
}
/** @param {FocusKind|null} kind */
function sizeDock(kind) {
	if (kind === 'dock') {
		if (heightBefore === null) heightBefore = get(dockHeight);
		dockHeight.set(fullDockHeight());
	} else if (heightBefore !== null) {
		const h = heightBefore;
		heightBefore = null;
		dockHeight.set(h);
	}
}

/** @param {FocusKind|null} kind */
function apply(kind) {
	sizeDock(kind);
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (kind) root.setAttribute('data-focus', kind);
	else root.removeAttribute('data-focus');
	// (the canvas follows by itself: threlte sizes the renderer from a ResizeObserver on `.viewport`,
	// whose dock inset the focus CSS lifts)
}

/** enter focus mode on an area @param {FocusKind} kind */
export function enterFocus(kind) {
	if (get(isLocked) === true || get(anyModalOpen)) return;
	if (kind === 'dock' && (!get(visibleDockKey) || get(dockMinimized))) kind = 'viewport';
	focusMode.set(kind);
}

/** back to the normal editor */
export function exitFocus() {
	if (get(focusMode)) focusMode.set(null);
}

/** is focus mode on? (the Esc row's `when`) */
export function focusActive() {
	return !!get(focusMode);
}

/** Ctrl+Space: toggle the maximize of the area under the pointer */
export function toggleFocusAtPointer() {
	if (get(focusMode)) {
		exitFocus();
		return;
	}
	enterFocus(areaAt(px, py));
}

/** View ▸ Focus mode / More ▸ Focus mode: the viewport (a menu has no "area under the pointer") */
export function toggleViewportFocus() {
	if (get(focusMode)) exitFocus();
	else enterFocus('viewport');
}

/** the dock tab menu's "Maximize": that tab, filling the window @param {string} key */
export function maximizeDockTab(key) {
	activateDock(key);
	enterFocus('dock');
}

/** leave 'dock' focus once the dock has STAYED empty for two frames (see the subscription) */
function exitWhenDockStaysEmpty() {
	const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (/** @type {any} */ fn) => setTimeout(fn, 16);
	later(() => later(() => !get(visibleDockKey) && get(focusMode) === 'dock' && exitFocus()));
}

let started = false;
/** wire the pointer tracker and the auto-exits (once, from the always-mounted chrome) */
export function startFocusMode() {
	if (started || typeof window === 'undefined') return () => {};
	started = true;
	window.addEventListener('pointermove', track, { capture: true, passive: true });
	window.addEventListener('pointerdown', track, { capture: true, passive: true });
	// a reload / tab close in dock focus must not leave the window-tall height saved as the dock's
	window.addEventListener('pagehide', exitFocus);
	const onResize = () => get(focusMode) === 'dock' && dockHeight.set(fullDockHeight());
	window.addEventListener('resize', onResize);
	/** @type {(() => void)[]} */
	const offs = [
		focusMode.subscribe(apply),
		isLocked.subscribe((v) => v === true && exitFocus()),
		anyModalOpen.subscribe((v) => v && exitFocus()),
		// 43 K5: SETTLED, not instant — entering 'dock' resizes the dock and hides the chrome, and
		// every dock member re-reports itself on the way (measured: the occupants go present ->
		// absent -> present inside one task), so an instant check left focus the moment it entered.
		// Exit only when the dock is STILL empty two frames later.
		visibleDockKey.subscribe((k) => !k && get(focusMode) === 'dock' && exitWhenDockStaysEmpty()),
		dockMinimized.subscribe((m) => m && get(focusMode) === 'dock' && exitFocus())
	];
	return () => {
		started = false;
		window.removeEventListener('pointermove', track, { capture: true });
		window.removeEventListener('pointerdown', track, { capture: true });
		window.removeEventListener('pagehide', exitFocus);
		window.removeEventListener('resize', onResize);
		for (const off of offs) off();
		focusMode.set(null);
	};
}
