// 47 M1: the Measure tool's arithmetic. A LEAF — imports nothing — so the chain maths, the
// label text and the label anchors are unit-tested without a scene, and the overlay, the
// screen-space labels and the toolbox all read the same numbers.
//
// A measurement is a CHAIN: points in world metres, one segment between each neighbour pair.
// Its labels are a length at every segment's midpoint, the turn at every interior point (the
// angle BETWEEN the two segments there, so two edges of a box corner read 90°) and, once there
// is more than one segment, a running total at the last point.

/** @param {number[]} a @param {number[]} b */
function dist(a, b) {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/**
 * The angle at `at` between the segments to `prev` and `next`, in degrees (0-180), or null
 * when either segment has no length (a double click on one spot has no direction).
 * @param {number[]} prev @param {number[]} at @param {number[]} next
 */
export function jointAngle(prev, at, next) {
	const u = [prev[0] - at[0], prev[1] - at[1], prev[2] - at[2]];
	const v = [next[0] - at[0], next[1] - at[1], next[2] - at[2]];
	const lu = Math.hypot(u[0], u[1], u[2]);
	const lv = Math.hypot(v[0], v[1], v[2]);
	if (lu < 1e-9 || lv < 1e-9) return null;
	const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
	return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Segment lengths, the total and the interior angles of a chain.
 * @param {number[][]} points
 * @returns {{segments: number[], total: number, angles: (number|null)[]}}
 */
export function chainStats(points) {
	const segments = [];
	for (let i = 1; i < points.length; i++) segments.push(dist(points[i - 1], points[i]));
	const angles = [];
	for (let i = 1; i < points.length - 1; i++) angles.push(jointAngle(points[i - 1], points[i], points[i + 1]));
	return { segments, total: segments.reduce((sum, s) => sum + s, 0), angles };
}

/** metres, three decimals under 10 m (a millimetre is the precision a 1 m box is checked to)
 * @param {number} metres */
export function formatLength(metres) {
	if (!Number.isFinite(metres)) return '—';
	return `${metres.toFixed(Math.abs(metres) < 10 ? 3 : 2)} m`;
}

/** @param {number|null} degrees */
export function formatAngle(degrees) {
	return degrees == null || !Number.isFinite(degrees) ? '—' : `${degrees.toFixed(1)}°`;
}

/** the axis deltas of one segment, for the toolbox readout @param {number[]} a @param {number[]} b */
export function segmentDelta(a, b) {
	return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}

/**
 * Every label of one chain, anchored in WORLD space (the overlay projects them each frame).
 * Keys are stable per chain + index, so the DOM layer keeps its nodes while the camera moves.
 * @param {number[][]} points @param {string} chainId
 * @returns {{key: string, kind: 'segment'|'angle'|'total', point: number[], text: string}[]}
 */
export function chainLabels(points, chainId) {
	const { segments, total, angles } = chainStats(points);
	/** @type {{key: string, kind: 'segment'|'angle'|'total', point: number[], text: string}[]} */
	const out = [];
	segments.forEach((length, i) => {
		const a = points[i];
		const b = points[i + 1];
		out.push({
			key: `${chainId}:s${i}`,
			kind: 'segment',
			point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
			text: formatLength(length)
		});
	});
	angles.forEach((angle, i) => {
		if (angle == null) return;
		out.push({ key: `${chainId}:a${i}`, kind: 'angle', point: points[i + 1], text: formatAngle(angle) });
	});
	if (segments.length > 1)
		out.push({ key: `${chainId}:t`, kind: 'total', point: points[points.length - 1], text: `Total ${formatLength(total)}` });
	return out;
}
