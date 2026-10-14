import { isHeaderDrag } from './windowGrip';
import { bottomDockWouldTake } from './bottomDockDrop';
import { safeStorage } from './safeStorage';
import { onLayoutRestore } from './uiLayoutsCore';
import { reportMember, sidebarShown, sidebarTabs, setDockMover, activateSidebarTab } from './sidebars';

// Docking lite (phase 81L). Drag a window near the left/right screen edge to dock it as a
// full-height panel (--z-chrome tier); drag its header away to float it again.
// 21-H2: the Library drawer it also used to give way to no longer exists.
//
// 42 I3 — ONE SIDEBAR PER SIDE ($lib/sidebars). An edge is ONE column and every window docked
// to it is a TAB of that column, beside the Inspector when it docks to the same side: only the
// tab in front renders (`data-sidebar-hidden` on the others), the column's tab header + resize
// grip are SidebarStrips.svelte's, and the column's geometry is the `--sb-*` CSS bus. This
// RETIRES two older shapes, both of which put two things on screen where the user asked for
// one: 81.4's vertical SPLIT (a second window on an edge stacked under the first, with a
// divider) and the right-docked window that slid inward as a SECOND COLUMN while the
// Inspector was open. Dropping a window on an occupied edge (or on the column itself) now adds
// a tab; a stored 81.4 pair restores as two tabs, and its old `dockSplit:<side>` share is
// simply no longer read.

const EDGE = 44; // px from a screen edge that counts as a dock drop

/** @type {{left: string[], right: string[]}} */
let docked = { left: [], right: [] };
/** @type {Map<string, any>} */
const registry = new Map(); // key -> {node, prevRect, present, observer}

/** @param {any} value a persisted side: a string (pre-81.4) or an array
 * @returns {string[]} */
function sideList(value) {
	if (Array.isArray(value)) return value.filter((k) => typeof k === 'string');
	return typeof value === 'string' && value ? [value] : [];
}

try {
	const saved = JSON.parse(safeStorage.getItem('dockedWindows') ?? 'null');
	if (saved) docked = { left: sideList(saved.left), right: sideList(saved.right) };
} catch {}

function persist() {
	safeStorage.setItem('dockedWindows', JSON.stringify(docked));
}

/** @param {string} key @returns {'left'|'right'|null} */
function sideOf(key) {
	if (docked.left.includes(key)) return 'left';
	if (docked.right.includes(key)) return 'right';
	return null;
}
export { sideOf as dockSideOf };

/** the keys docked to a side, in docking order @param {'left'|'right'} side */
export function dockedOn(side) {
	return [...docked[side]];
}

function applyAll() {
	for (const [key] of registry) apply(key);
}

/** a docked window is a TAB only while it is open (the object list stays mounted and hides
 *  itself with a class when closed) @param {any} node */
const isPresent = (node) => !!node?.isConnected && !node.classList.contains('hidden');

/** @param {string} key */
function apply(key) {
	const entry = registry.get(key);
	if (!entry) return;
	const side = sideOf(key);
	const { node } = entry;
	entry.present = isPresent(node);
	reportMember(key, side, entry.present);
	if (!side) {
		delete node.dataset.docked;
		delete node.dataset.sidebarHidden;
		return;
	}
	node.dataset.docked = side;
	node.style.position = 'fixed';
	node.style.maxWidth = 'none';
	node.style.maxHeight = 'none';
	// the column's geometry is the sidebars' CSS bus: one place decides where the column is
	node.style.left = side === 'left' ? 'var(--sb-left-x, 0px)' : 'auto';
	node.style.right = side === 'right' ? '0px' : 'auto';
	node.style.top = `calc(var(--sb-${side}-top, 64px) + var(--sb-strip-h, 30px))`;
	node.style.width = `var(--sb-${side}-w, 320px)`;
	node.style.height = `calc(100vh - var(--sb-${side}-top, 64px) - var(--sb-strip-h, 30px) - var(--sb-${side}-bottom, 0px))`;
	node.style.zIndex = '30'; // z-ok: = --z-chrome; restored + compared as a number by docking/TabStrips
	// only the tab in front renders
	if (get_shown()[side] === key) delete node.dataset.sidebarHidden;
	else node.dataset.sidebarHidden = '';
}

/** @type {Record<'left'|'right', string|null>} */
let shownNow = { left: null, right: null };
const get_shown = () => shownNow;
sidebarShown.subscribe((v) => {
	shownNow = v;
	applyAll();
});

/** remember where a window floated before it joins a column @param {any} entry */
function rememberFloat(entry) {
	entry.prevRect = {
		left: entry.node.style.left,
		top: entry.node.style.top,
		width: entry.node.style.width,
		height: entry.node.style.height,
		zIndex: entry.node.style.zIndex
	};
}

/** dock a window to a side, as that column's front tab @param {string} key @param {'left'|'right'} side */
function dock(key, side) {
	const entry = registry.get(key);
	if (!entry) return false;
	const from = sideOf(key);
	if (from === side) {
		activateSidebarTab(key);
		return true;
	}
	if (from) docked[from] = docked[from].filter((k) => k !== key);
	else rememberFloat(entry);
	docked[side] = [...docked[side].filter((k) => k !== key), key];
	persist();
	apply(key);
	activateSidebarTab(key);
	return true;
}

// the sidebar tab drag moves a docked window to the other side
setDockMover((key, side) => (sideOf(key) ? dock(key, side) : false));

/** @param {string} key @param {number=} x @param {number=} y */
export function undock(key, x, y) {
	const side = sideOf(key);
	if (!side) return;
	docked[side] = docked[side].filter((k) => k !== key);
	persist();
	const entry = registry.get(key);
	if (entry) {
		releaseNode(entry, x, y);
		reportMember(key, null, false);
	}
}

/** Hand a node that is no longer docked its floating geometry back.
 * @param {any} entry @param {number=} x @param {number=} y */
function releaseNode(entry, x, y) {
	const { node, prevRect } = entry;
	delete node.dataset.docked;
	delete node.dataset.sidebarHidden;
	delete node.dataset.dockSlot;
	node.style.height = prevRect?.height || '';
	node.style.width = prevRect?.width || '';
	node.style.maxWidth = '';
	node.style.maxHeight = '';
	node.style.right = '';
	node.style.zIndex = prevRect?.zIndex || '40'; // z-ok: = --z-window, read back as a number
	node.style.left = (x != null ? Math.max(0, x - 120) : parseFloat(prevRect?.left) || 200) + 'px';
	node.style.top = (y != null ? Math.max(0, y - 12) : parseFloat(prevRect?.top) || 120) + 'px';
}

// 37 R14: a named workspace layout rewrote `dockedWindows` — adopt the stored sides. A live
// window that leaves the column gets its floating geometry back (its own dragWindow re-read then
// places it); one that joins a column remembers where it floated, as a drag-dock does.
// Registered at module load, so it runs BEFORE the windows' own re-reads.
onLayoutRestore(() => {
	/** @type {{left: string[], right: string[]}} */
	let next = { left: [], right: [] };
	try {
		const saved = JSON.parse(safeStorage.getItem('dockedWindows') ?? 'null');
		if (saved) next = { left: sideList(saved.left), right: sideList(saved.right) };
	} catch {}
	const was = docked;
	docked = next;
	for (const [key, entry] of registry) {
		const before = was.left.includes(key) || was.right.includes(key);
		const now = !!sideOf(key);
		if (before && !now) {
			releaseNode(entry);
			reportMember(key, null, false);
		} else if (!before && now) rememberFloat(entry);
	}
	if (!isCoarse()) applyAll();
});

/** the column a drop would join: the edge band, or anywhere over a SHOWN column
 * @type {any} */ let zoneEl = null;
/** @param {{side: 'left'|'right', column: boolean} | null} target */
function showZone(target) {
	if (!target) {
		zoneEl?.remove();
		zoneEl = null;
		return;
	}
	if (!zoneEl) {
		zoneEl = document.createElement('div');
		zoneEl.id = 'dock-zone';
		zoneEl.className = 'sb-drop-zone';
		document.body.appendChild(zoneEl);
	}
	const { side, column } = target;
	zoneEl.dataset.side = side;
	zoneEl.dataset.tab = column ? 'true' : 'false';
	// an occupied side highlights its whole column (the window becomes one of its tabs); an
	// empty one shows the edge band the column will open from
	zoneEl.style.top = `var(--sb-${side}-top, 64px)`;
	zoneEl.style.bottom = `var(--sb-${side}-bottom, 0px)`;
	zoneEl.style.width = column ? `var(--sb-${side}-w, 320px)` : '80px';
	zoneEl.style.left = side === 'left' ? (column ? 'var(--sb-left-x, 0px)' : '0px') : 'auto';
	zoneEl.style.right = side === 'right' ? '0px' : 'auto';
	zoneEl.textContent = column ? 'Add as tab' : '';
}

// touch / limited-width devices: edge side-docking is disabled — there isn't the
// horizontal room for a full-height side panel, and it fights touch scrolling.
const isCoarse = () =>
	typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

/** the sides whose column is on screen right now */
let tabsNow = { left: /** @type {string[]} */ ([]), right: /** @type {string[]} */ ([]) };
sidebarTabs.subscribe((v) => (tabsNow = v));

/**
 * svelte action: makes a floating window dockable to the screen edges.
 * @param {any} node @param {{key: string}} options
 */
export function dockable(node, { key }) {
	/** @type {any} */
	const entry = { node, prevRect: null, present: false, observer: null };
	registry.set(key, entry);
	// On mobile, register only (so destroy() still cleans up) but wire NO edge-drag
	// handlers and restore NO persisted side-dock — the window stays a normal floating
	// window. The persisted desktop preference is left untouched.
	if (isCoarse()) {
		return {
			destroy() {
				registry.delete(key);
			}
		};
	}
	if (sideOf(key)) rememberFloat(entry);
	apply(key); // restore a persisted dock (as a tab of its side)
	// open / closed is a class on an always-mounted window (the object list): a tab comes and goes
	// with it, and coming back brings it to the front (reportMember)
	entry.observer = new MutationObserver(() => {
		if (isPresent(node) !== entry.present) apply(key);
	});
	entry.observer.observe(node, { attributes: true, attributeFilter: ['class'] });

	let dragging = false;
	/** @param {any} e */
	const down = (e) => {
		if (!isHeaderDrag(e.target) || e.button !== 0) return; // 36 F4: not on a header control
		if (sideOf(key)) {
			// docked: dragging the header away undocks and hands back to the
			// window's own drag behavior on the NEXT gesture
			e.stopImmediatePropagation();
			const startX = e.clientX;
			const startY = e.clientY;
			const moveOut = (/** @type {any} */ ev) => {
				if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 40) {
					undock(key, ev.clientX, ev.clientY);
					cleanup();
				}
			};
			const cleanup = () => {
				window.removeEventListener('pointermove', moveOut);
				window.removeEventListener('pointerup', cleanup);
			};
			window.addEventListener('pointermove', moveOut);
			window.addEventListener('pointerup', cleanup);
			return;
		}
		dragging = true;
	};
	// W7 PRECEDENCE: the bottom-dock band beats an edge. The bottom-left corner is in
	// both reaches at once, and a DOCK_FAMILY window dropped there means "put it in the
	// dock" — the model the user was aiming at — not "make it a full-height side panel
	// that happens to start below the dock". Asking here rather than there keeps the
	// decision on the side that has to yield.
	/** @param {any} e @returns {{side: 'left'|'right', column: boolean} | null} */
	const targetAt = (e) => {
		// ...but only where the dock would really take THIS window. Yielding the band
		// unconditionally hands the bottom of both side edges to a dock that cannot
		// accept a non-DOCK_FAMILY panel, so the drop does nothing at all.
		if (bottomDockWouldTake(key, e.clientY, e.clientX)) return null;
		const root = getComputedStyle(document.documentElement);
		for (const side of /** @type {const} */ (['left', 'right'])) {
			const occupied = tabsNow[side].some((k) => k !== key);
			const w = parseFloat(root.getPropertyValue(`--sb-${side}-w`)) || 320;
			const x0 = side === 'left' ? parseFloat(root.getPropertyValue('--sb-left-x')) || 0 : window.innerWidth - w;
			const top = parseFloat(root.getPropertyValue(`--sb-${side}-top`)) || 0;
			const overColumn = occupied && e.clientX >= x0 && e.clientX <= x0 + w && e.clientY >= top;
			const onEdge = side === 'left' ? e.clientX < EDGE : e.clientX > window.innerWidth - EDGE;
			if (overColumn || onEdge) return { side, column: occupied };
		}
		return null;
	};
	/** @param {any} e */
	const move = (e) => {
		if (!dragging) return;
		showZone(targetAt(e));
	};
	/** @param {any} e */
	const up = (e) => {
		if (!dragging) return;
		dragging = false;
		showZone(null);
		const target = targetAt(e);
		if (target) dock(key, target.side);
	};
	node.addEventListener('pointerdown', down, true); // capture: beats dragWindow while docked
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);

	return {
		destroy() {
			node.removeEventListener('pointerdown', down, true);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			entry.observer?.disconnect();
			registry.delete(key);
			// a member that unmounts is no longer a tab (its persisted side survives for its return)
			if (sideOf(key)) reportMember(key, sideOf(key), false);
		}
	};
}
