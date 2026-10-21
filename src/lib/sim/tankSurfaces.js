// 49-water W1: a fluid tank's particles meet a W1 water surface. A LEAF (imports nothing):
// fluidRuntime builds the surfaces on the main thread, fluidCore (the CPU worker) and the
// GPU solver (49-fluid) both run the crossing test inside their step, and vitest runs both.
//
// THE CONTRACT (the solver API, the same for every solver):
//   step option `surfaces: TankSurface[]` — each W1 volume whose surface reaches the tank,
//     in the SOLVER's frame: the plane (unit normal `n`, offset `d`: n·x = d is the surface)
//     and its footprint on that plane (centre `c`, in-plane unit axes `ax`/`az`, half extents
//     `hx`/`hz`, `round` = the ellipse a cylinder pool is), plus `vmin`, the speed through
//     the plane below which a crossing is a wade and not a landing.
//   A particle whose step takes it from ABOVE the plane to ON/BELOW it, faster than `vmin`,
//   inside the footprint, LEAVES the simulation (it joined the pool), and the crossing is
//   reported as [x, y, z, speed, surfaceIndex]* (solver frame) — the frame message's
//   `splashes`, capped at SPLASH_CAP per step (the rest counted). No second readback: the
//   hits ride the frame that already carries the positions.
//
// WHY LEAVE AND NOT BOUNCE: a bounced particle would rest ON the pool's surface — a sheet of
// tank fluid floating on water, drawn by the tank's own renderer over the pool's. Leaving is
// what the Fluid emitter's sinks (F23) and the spill drops (F16) already do with water that
// reaches a pool, so all three agree: water that lands in water is the pool's now.
// WHY ONLY A FAST, DOWNWARD CROSSING: a tank standing IN a pool has fluid below the pool's
// surface from the start, and a resting fluid's surface bobs across the plane — neither is a
// landing, and taking them would drain the tank to the pool's level through the glass.

/** hits handed back per step (a pour lands a few dozen particles a step at most) */
export const SPLASH_CAP = 64;
/** m/s through the plane: slower is a wade (splashWatch's SPLASH_MIN_SPEED) */
export const SURFACE_VMIN = 0.6;

/** @typedef {{n: number[], d: number, c: number[], ax: number[], az: number[], hx: number, hz: number, round: boolean, vmin: number, uuid?: string}} TankSurface */

/** column-major 4x4 (three's Matrix4.elements) applied to a point @param {ArrayLike<number>} e @param {number[]} p */
function apply(e, p) {
	const [x, y, z] = p;
	return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
}
/** a direction (no translation) @param {ArrayLike<number>} e @param {number[]} p */
function applyDir(e, p) {
	const [x, y, z] = p;
	return [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z];
}
/** @param {number[]} a @param {number[]} b */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {number[]} a */
const len = (a) => Math.hypot(a[0], a[1], a[2]);
/** @param {number[]} a */
const unit = (a) => {
	const l = len(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The W1 volumes whose surface reaches a tank, in the tank's (solver's) frame.
 * @param {any[]} volumes waterVolumes.list() (duck-typed: object.matrixWorld.elements, bounds, level, shape)
 * @param {ArrayLike<number>} toTank world -> tank frame (the inverse of the tank frame matrix)
 * @param {number[]} min @param {number[]} max the tank's inside (solver frame)
 * @returns {TankSurface[]}
 */
export function surfacesFor(volumes, toTank, min, max) {
	/** @type {TankSurface[]} */
	const out = [];
	const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
	const reach = len(sub(max, min)) / 2;
	for (const v of volumes ?? []) {
		const e = v?.object?.matrixWorld?.elements;
		const b = v?.bounds;
		if (!e || !b || typeof v.level !== 'number') continue;
		// the surface's footprint in the volume's own frame, then world, then the tank's
		const cl = [(b.minX + b.maxX) / 2, v.level, (b.minZ + b.maxZ) / 2];
		const cw = apply(e, cl);
		const axw = applyDir(e, [(b.maxX - b.minX) / 2, 0, 0]);
		const azw = applyDir(e, [0, 0, (b.maxZ - b.minZ) / 2]);
		const nw = unit(applyDir(e, [0, 1, 0]));
		const hx = len(axw), hz = len(azw);
		if (hx < 1e-6 || hz < 1e-6) continue;
		const c = apply(toTank, cw);
		const n = unit(applyDir(toTank, nw));
		const ax = unit(applyDir(toTank, axw));
		const az = unit(applyDir(toTank, azw));
		// does the plane cross the tank's box at all (the box's half-extent along n), and does
		// the footprint come near it?
		const half = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
		const spread = Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2];
		const d = dot(n, c);
		if (Math.abs(dot(n, centre) - d) > spread) continue;
		const off = sub(centre, c);
		if (Math.abs(dot(off, ax)) > hx + reach || Math.abs(dot(off, az)) > hz + reach) continue;
		out.push({ n, d, c, ax, az, hx, hz, round: v.shape === 'cylinder', vmin: SURFACE_VMIN, uuid: v.uuid });
	}
	return out;
}

/** is a point on the plane inside the footprint @param {TankSurface} s @param {number} x @param {number} y @param {number} z */
export function inFootprint(s, x, y, z) {
	const rx = x - s.c[0], ry = y - s.c[1], rz = z - s.c[2];
	const u = (rx * s.ax[0] + ry * s.ax[1] + rz * s.ax[2]) / s.hx;
	const w = (rx * s.az[0] + ry * s.az[1] + rz * s.az[2]) / s.hz;
	return s.round ? u * u + w * w <= 1 : Math.abs(u) <= 1 && Math.abs(w) <= 1;
}

/**
 * The crossing test, CPU form: particles moving from `from` to `to` (flat xyz arrays, n
 * particles) over `dt`. Marks `crossed[i] = 1` and writes up to `cap` hits into `hits`
 * ([x,y,z,speed,surfaceIndex]*, the plane point). Returns {marked, hits (count written)}.
 * @param {TankSurface[]} surfaces @param {Float32Array} from @param {Float32Array} to @param {number} n @param {number} dt
 * @param {Uint8Array} crossed @param {Float32Array} hits @param {number} cap
 */
export function crossSurfaces(surfaces, from, to, n, dt, crossed, hits, cap) {
	let marked = 0, written = 0;
	if (!surfaces?.length || !(dt > 0)) return { marked, written };
	for (let i = 0; i < n; i++) {
		const k = i * 3;
		const fx = from[k], fy = from[k + 1], fz = from[k + 2];
		const tx = to[k], ty = to[k + 1], tz = to[k + 2];
		for (let si = 0; si < surfaces.length; si++) {
			const s = surfaces[si];
			const a = fx * s.n[0] + fy * s.n[1] + fz * s.n[2] - s.d;
			if (a <= 0) continue;
			const b = tx * s.n[0] + ty * s.n[1] + tz * s.n[2] - s.d;
			if (b > 0) continue;
			const speed = (a - b) / dt;
			if (speed < s.vmin) continue;
			const t = a / (a - b);
			const hx = fx + (tx - fx) * t, hy = fy + (ty - fy) * t, hz = fz + (tz - fz) * t;
			if (!inFootprint(s, hx, hy, hz)) continue;
			crossed[i] = 1;
			marked++;
			if (written < cap) {
				const o = written * 5;
				hits[o] = hx;
				hits[o + 1] = hy;
				hits[o + 2] = hz;
				hits[o + 3] = speed;
				hits[o + 4] = si;
				written++;
			}
			break;
		}
	}
	return { marked, written };
}
