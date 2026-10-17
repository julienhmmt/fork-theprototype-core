// 47 M2: align and distribute as ARITHMETIC over world-space bounding boxes. A LEAF — imports
// nothing — so the positions every op produces are unit-tested without a scene; align.js is the
// half that reads the boxes off the objects, moves them, replicates and records ONE undo entry.
//
// A box is `{min: [x, y, z], max: [x, y, z]}` in world metres. Every op answers a DELTA per box
// along one axis (0 = x, 1 = y, 2 = z): how far that object must move, which is what the caller
// adds to its world position. A delta of 0 is a box that is already where the op puts it.

/** @typedef {{min: number[], max: number[]}} Box */

/** @param {Box} box @param {number} axis @param {'min'|'center'|'max'} edge */
export function edgeOf(box, axis, edge) {
	if (edge === 'min') return box.min[axis];
	if (edge === 'max') return box.max[axis];
	return (box.min[axis] + box.max[axis]) / 2;
}

/** the union of the boxes @param {Box[]} boxes @returns {Box} */
export function unionBox(boxes) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const b of boxes)
		for (let a = 0; a < 3; a++) {
			min[a] = Math.min(min[a], b.min[a]);
			max[a] = Math.max(max[a], b.max[a]);
		}
	return { min, max };
}

/**
 * Align: line every box's min / centre / max on `axis` up with the REFERENCE's — the selection's
 * union box (`activeIndex` < 0) or the ACTIVE object's own box, which then stays where it is.
 * @param {Box[]} boxes @param {number} axis @param {'min'|'center'|'max'} edge
 * @param {number} [activeIndex] -1 = the selection bounds
 * @returns {number[]} a delta per box
 */
export function alignDeltas(boxes, axis, edge, activeIndex = -1) {
	if (!boxes.length) return [];
	const ref = activeIndex >= 0 && activeIndex < boxes.length ? boxes[activeIndex] : unionBox(boxes);
	const target = edgeOf(ref, axis, edge);
	return boxes.map((b, i) => (i === activeIndex ? 0 : target - edgeOf(b, axis, edge)));
}

/**
 * Distribute 3+ boxes on `axis`, in the order of their centres, keeping the two outermost where
 * they are: `centers` spaces the centres evenly; `gaps` makes the empty space between every
 * neighbour pair equal (what you want when the objects differ in size). Fewer than three boxes
 * have nothing to distribute: every delta is 0.
 * @param {Box[]} boxes @param {number} axis @param {'centers'|'gaps'} mode
 * @returns {number[]} a delta per box (input order)
 */
export function distributeDeltas(boxes, axis, mode) {
	const deltas = boxes.map(() => 0);
	if (boxes.length < 3) return deltas;
	// stable order: by centre, ties by input index (two peers must compute the same answer)
	const order = boxes
		.map((b, i) => ({ i, c: edgeOf(b, axis, 'center') }))
		.sort((p, q) => p.c - q.c || p.i - q.i)
		.map((p) => p.i);
	const first = boxes[order[0]];
	const last = boxes[order[order.length - 1]];
	const n = order.length;
	if (mode === 'centers') {
		const c0 = edgeOf(first, axis, 'center');
		const step = (edgeOf(last, axis, 'center') - c0) / (n - 1);
		order.forEach((idx, k) => {
			if (k === 0 || k === n - 1) return;
			deltas[idx] = c0 + k * step - edgeOf(boxes[idx], axis, 'center');
		});
		return deltas;
	}
	const sizes = order.map((idx) => boxes[idx].max[axis] - boxes[idx].min[axis]);
	const span = last.max[axis] - first.min[axis];
	const gap = (span - sizes.reduce((s, v) => s + v, 0)) / (n - 1);
	let cursor = first.min[axis];
	order.forEach((idx, k) => {
		if (k > 0 && k < n - 1) deltas[idx] = cursor - boxes[idx].min[axis];
		cursor += sizes[k] + gap;
	});
	return deltas;
}

/** which axis an op letter names @param {string} axis 'x'|'y'|'z' */
export function axisIndex(axis) {
	return axis === 'y' ? 1 : axis === 'z' ? 2 : 0;
}
