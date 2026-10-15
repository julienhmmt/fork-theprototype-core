// 44 M12b — FREE BUT ANCHORED PLACEMENT of the HUD's button clusters, as a pure leaf (imports NOTHING).
//
// The user: "Would you allow to move freely button clusters to adjust their placement …". The decision: drag any
// cluster anywhere; it snaps to the screen edges / corners, the sidebar edges and the other clusters (guide lines);
// its place is stored as the nearest anchor + a % offset so it survives fold/unfold, resize and sidebars; clusters
// never overlap each other, a pinned sidebar or the dock (nudged to the nearest free spot).
//
// THE MODEL. Every placement lives in an AREA — the window less the pinned sidebars and the visible dock (the room a
// cluster may take). A cluster's place is the FRACTION of the area's free span along each axis: x = 0 hugs the left
// edge (at the margin), 1 the right one, 0.5 is centred, and the same for y. A fraction is relative by construction:
// on a narrower window, beside a newly pinned sidebar or above an opened dock the cluster keeps its relative place,
// and an edge-snapped one (0 or 1) stays glued to its edge at exactly the margin. The anchor (`bottom-right`, …) is
// the nearest of the nine and is what the record says for a reader; the fractions are what it is drawn from.
//
// Boxes are {left, top, right, bottom} in client px.

/** the breathing room against the area's edges */
export const MARGIN = 16;
/** the gap a nudged cluster keeps from what it was nudged off (and snaps to beside another cluster) */
export const GAP = 8;
/** how near a line still snaps */
export const SNAP_PX = 10;

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */
/** @typedef {{ w: number, h: number }} Size */
/** @typedef {{ axis: 'x' | 'y', at: number }} Guide */

/** @param {Box} a @returns {number} */
const W = (a) => a.right - a.left;
/** @param {Box} a @returns {number} */
const H = (a) => a.bottom - a.top;
/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** where a placement draws, as a box @param {{x: number, y: number}} f @param {Size} size @param {Box} area */
export function boxAt(f, size, area, margin = MARGIN) {
	const spanX = Math.max(0, W(area) - 2 * margin - size.w);
	const spanY = Math.max(0, H(area) - 2 * margin - size.h);
	const left = area.left + margin + clamp(f.x, 0, 1) * spanX;
	const top = area.top + margin + clamp(f.y, 0, 1) * spanY;
	return { left, top, right: left + size.w, bottom: top + size.h };
}

/** the placement a box stands for (its fractions; a span of 0 reads as centred) @param {Box} box @param {Box} area */
export function fractionsOf(box, area, margin = MARGIN) {
	const spanX = W(area) - 2 * margin - W(box);
	const spanY = H(area) - 2 * margin - H(box);
	const x = spanX > 0 ? clamp((box.left - area.left - margin) / spanX, 0, 1) : 0.5;
	const y = spanY > 0 ? clamp((box.top - area.top - margin) / spanY, 0, 1) : 0.5;
	return { x, y };
}

/** keep a box inside the area's margins (a box larger than the area hugs its top-left) @param {Box} box @param {Box} area */
export function clampBox(box, area, margin = MARGIN) {
	const w = W(box);
	const h = H(box);
	const left = clamp(box.left, area.left + margin, Math.max(area.left + margin, area.right - margin - w));
	const top = clamp(box.top, area.top + margin, Math.max(area.top + margin, area.bottom - margin - h));
	return { left, top, right: left + w, bottom: top + h };
}

/** do two boxes overlap (touching is not overlapping) @param {Box} a @param {Box} b */
export function overlaps(a, b, gap = 0) {
	return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}

/**
 * Snap a dragged box to the area's edges and centre lines and to the other clusters (their edges in line, or
 * side by side at GAP). Each axis snaps on its own to the NEAREST line within SNAP_PX; the lines it snapped to
 * come back as guides to draw.
 * @param {Box} box @param {Box} area @param {Box[]} others
 * @returns {{ box: Box, guides: Guide[] }}
 */
export function snapBox(box, area, others, margin = MARGIN, snap = SNAP_PX) {
	const w = W(box);
	const h = H(box);
	/** candidate positions for the box's left (top), each with the line to draw */
	/** @type {{ v: number, at: number }[]} */
	const xs = [
		{ v: area.left + margin, at: area.left + margin },
		{ v: area.right - margin - w, at: area.right - margin },
		{ v: (area.left + area.right) / 2 - w / 2, at: (area.left + area.right) / 2 }
	];
	/** @type {{ v: number, at: number }[]} */
	const ys = [
		{ v: area.top + margin, at: area.top + margin },
		{ v: area.bottom - margin - h, at: area.bottom - margin },
		{ v: (area.top + area.bottom) / 2 - h / 2, at: (area.top + area.bottom) / 2 }
	];
	for (const o of others) {
		xs.push(
			{ v: o.left, at: o.left },
			{ v: o.right - w, at: o.right },
			{ v: o.right + GAP, at: o.right + GAP / 2 },
			{ v: o.left - GAP - w, at: o.left - GAP / 2 },
			{ v: (o.left + o.right) / 2 - w / 2, at: (o.left + o.right) / 2 }
		);
		ys.push(
			{ v: o.top, at: o.top },
			{ v: o.bottom - h, at: o.bottom },
			{ v: o.bottom + GAP, at: o.bottom + GAP / 2 },
			{ v: o.top - GAP - h, at: o.top - GAP / 2 },
			{ v: (o.top + o.bottom) / 2 - h / 2, at: (o.top + o.bottom) / 2 }
		);
	}
	/** @param {{ v: number, at: number }[]} list @param {number} from */
	const nearest = (list, from) => {
		let best = null;
		for (const c of list) if (Math.abs(c.v - from) <= snap && (!best || Math.abs(c.v - from) < Math.abs(best.v - from))) best = c;
		return best;
	};
	const sx = nearest(xs, box.left);
	const sy = nearest(ys, box.top);
	const left = sx ? sx.v : box.left;
	const top = sy ? sy.v : box.top;
	/** @type {Guide[]} */
	const guides = [];
	if (sx) guides.push({ axis: 'x', at: Math.round(sx.at) });
	if (sy) guides.push({ axis: 'y', at: Math.round(sy.at) });
	return { box: { left, top, right: left + w, bottom: top + h }, guides };
}

/**
 * NO OVERLAPS: a box that overlaps an obstacle (another cluster, the logo, the profile) moves to the nearest free
 * spot inside the area — the candidates are the box itself and every place just beside an obstacle (GAP away),
 * on each axis and in combination; the closest free one wins. Nothing free → the box, clamped (it never leaves
 * the screen). Deterministic: the same inputs always land in the same place.
 * @param {Box} box @param {Box} area @param {Box[]} obstacles
 * @returns {Box}
 */
export function nudgeFree(box, area, obstacles, margin = MARGIN) {
	const start = clampBox(box, area, margin);
	const w = W(start);
	const h = H(start);
	const free = (/** @type {Box} */ b) => obstacles.every((o) => !overlaps(b, o));
	if (free(start)) return start;
	const xs = [start.left];
	const ys = [start.top];
	for (const o of obstacles) {
		xs.push(o.left - GAP - w, o.right + GAP);
		ys.push(o.top - GAP - h, o.bottom + GAP);
	}
	/** @type {Box | null} */
	let best = null;
	let bestD = Infinity;
	for (const x of xs)
		for (const y of ys) {
			const b = clampBox({ left: x, top: y, right: x + w, bottom: y + h }, area, margin);
			if (!free(b)) continue;
			const d = Math.hypot(b.left - start.left, b.top - start.top);
			if (d < bestD - 1e-6) {
				bestD = d;
				best = b;
			}
		}
	return best ?? start;
}
