// 41b H3 — THE ONE LIVE BOTTOM EDGE: how much of the phone screen, measured up from its bottom, is
// covered by the bottom bar and whatever is open along it (a framed sheet, the Inspector, the notes
// sheet or its note card, a toolbox sheet, a docked view and its tab row, the Add list).
//
// The selection strip rides 8 px above that edge (NOTES-38 #32 b). It used to re-measure on a 120 ms
// timer and move by `bottom`, so while a drawer was being dragged the strip held a stale position for
// several frames and then jumped to catch up — measured on 41-int: 95-102 of ~169 frames more than one
// frame behind and 17-18 jumps per drag, on the dock, a framed sheet and the Inspector alike ("inspect
// toolbar stutter when I resize drawers"). Those drawers belong to five components with five ways of
// sizing themselves (a detent sheet, a remembered height, a CSS transition, a dock height), so the
// edge is not computed from any one of them: it is READ, once per frame, from the boxes on screen.
//
// SAME FRAME: the callback runs inside requestAnimationFrame, which comes after the frame's input
// events (the drag's touchmove already resized the drawer) and after its CSS animations were
// sampled (a height transition is mid-flight at this frame's value), and before style, layout and
// paint. A reader that writes a TRANSFORM there (no layout) paints in step with the drawer. The
// callback fires only when the edge changes, so a still screen costs one cheap read per frame.
//
// A LEAF: no imports; PhoneShell is its reader (`followBottomEdge`), the selector list its contract.

/** everything that can occupy the bottom of the phone screen under the selection strip — the bottom
 *  bar first, so with nothing open the strip rests 8 px above the bar (safe-area inset included) */
export const BOTTOM_OCCUPANTS =
	'#ps-bar, .ps-sheet, #inspector, #notes-drawer, .note-card.note-sheet, .toolbox.tbx-sheet, .tp-dock-panel, .tp-dock-panel .dt-row, :root.ps-add-open .ctx-scroll';

/** @param {Element} el */
function shown(el) {
	const e = /** @type {any} */ (el);
	if (typeof e.checkVisibility === 'function') return e.checkVisibility({ visibilityProperty: true });
	const cs = getComputedStyle(el);
	return cs.display !== 'none' && cs.visibility !== 'hidden';
}

/** px covered from the bottom of the window by the open occupants (0 = nothing open) */
export function occupiedHeight() {
	if (typeof document === 'undefined') return 0;
	const vh = window.innerHeight;
	let occ = 0;
	for (const el of document.querySelectorAll(BOTTOM_OCCUPANTS)) {
		const r = el.getBoundingClientRect();
		if (!r.height || !shown(el)) continue;
		occ = Math.max(occ, vh - r.top);
	}
	return Math.round(occ * 100) / 100;
}

/**
 * Call `fn(px)` now and then in the same animation frame whenever the occupied height changes.
 * @param {(px: number) => void} fn @returns {() => void} stop
 */
export function followBottomEdge(fn) {
	if (typeof requestAnimationFrame === 'undefined') return () => {};
	let last = occupiedHeight();
	fn(last);
	let raf = 0;
	const frame = () => {
		raf = requestAnimationFrame(frame);
		const now = occupiedHeight();
		if (now !== last) {
			last = now;
			fn(now);
		}
	};
	raf = requestAnimationFrame(frame);
	return () => cancelAnimationFrame(raf);
}
