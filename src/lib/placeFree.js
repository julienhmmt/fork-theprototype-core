// 45 N7 — HOLD CTRL (Cmd on a Mac) WHILE DRAGGING A FLOATING WINDOW = PLACE IT WITHOUT DOCKING.
//
// The user: "now I cannot drag somewhere floating window if I hover on sidebar or dock … maybe I can
// hold Ctrl when move window to allow to place on top of sidebar/dock without merging it there, and I
// like that by default it merges". Decision (Visual Studio / JetBrains): a window dragged over a sidebar
// column, the dock's tab strip, its bottom band or another window's header still DOCKS by default (the
// target lights up); while Ctrl (Cmd) is held every one of those targets stands down, so the window is
// simply placed where it is dropped — over a sidebar or the dock too. A LIVE toggle: pressing or
// releasing the key mid-drag, with the pointer still, flips the target at once. Touch has no modifier:
// the window menu's "Float" is the touch path (a long press before the drag is NOT used).
//
// A LEAF (no imports): the drop model ($lib/sidebarDrop), the window drag (`bottomDockable`), the group
// strips (TabStrips) and the header merge (windowTabs) all read the one switch, and windowTabs sits under
// sidebarDrop's import chain, so this cannot live there.

let held = false;
/** @type {Set<(held: boolean) => void>} */
const watchers = new Set();

/** @param {boolean} v */
function set(v) {
	v = !!v;
	if (v === held) return;
	held = v;
	for (const fn of [...watchers]) fn(held);
}
/** @param {KeyboardEvent} e */
const onKey = (e) => set(e.ctrlKey || e.metaKey);
const onBlur = () => set(false);

/**
 * Read the switch from a pointer (or key) event — every pointermove of a drag carries the modifiers —
 * and return it. A call with no event just reads it.
 * @param {{ctrlKey?: boolean, metaKey?: boolean}} [e]
 */
export function placeFree(e) {
	if (e && typeof e.ctrlKey === 'boolean') set(!!(e.ctrlKey || e.metaKey));
	return held;
}

/**
 * Watch the switch for the duration of a drag (the key pressed or released with the pointer still).
 * The key listeners exist only while somebody watches. @param {(held: boolean) => void} fn @returns {() => void}
 */
export function watchPlaceFree(fn) {
	if (typeof window === 'undefined') return () => {};
	if (!watchers.size) {
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keyup', onKey, true);
		window.addEventListener('blur', onBlur);
	}
	watchers.add(fn);
	return () => {
		if (!watchers.delete(fn) || watchers.size) return;
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('keyup', onKey, true);
		window.removeEventListener('blur', onBlur);
		held = false;
	};
}

/** the modifier's name on this machine */
export function placeFreeKey() {
	if (typeof navigator === 'undefined') return 'Ctrl';
	const p = /** @type {any} */ (navigator).userAgentData?.platform ?? navigator.platform ?? '';
	return /mac|iphone|ipad/i.test(p) ? 'Cmd' : 'Ctrl';
}
/** the hint a docking target carries */
export function placeFreeHint() {
	return `Hold ${placeFreeKey()} to place without docking`;
}

/** @type {HTMLElement|null} */ let chip = null;
/**
 * The chip beside the pointer while the key is suppressing a target the window would otherwise dock
 * into ("Placing without docking"), or null to clear it.
 * @param {{x: number, y: number}|null} at
 */
export function showPlaceFreeChip(at) {
	if (typeof document === 'undefined') return;
	if (!at) {
		chip?.remove();
		chip = null;
		return;
	}
	if (!chip) {
		chip = document.createElement('div');
		chip.id = 'place-free-hint';
		chip.className = 'place-free-chip';
		chip.setAttribute('aria-hidden', 'true');
		chip.textContent = `Placing without docking — release ${placeFreeKey()} to dock`;
		document.body.appendChild(chip);
	}
	// beside the pointer, and kept inside the window (near the right / bottom edge it flips to the other side)
	const w = chip.offsetWidth;
	const h = chip.offsetHeight;
	const x = at.x + 16 + w > window.innerWidth - 4 ? at.x - 16 - w : at.x + 16;
	const y = at.y + 18 + h > window.innerHeight - 4 ? at.y - 18 - h : at.y + 18;
	chip.style.left = Math.round(Math.max(4, x)) + 'px';
	chip.style.top = Math.round(Math.max(4, y)) + 'px';
}
