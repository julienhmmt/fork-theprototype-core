// 49-fluid W2: the fluid tank's PBF step on WebGPU COMPUTE — the same algorithm as
// fluidCore's FluidSolver.step (Macklin & Müller 2013), ported pass for pass, so a tank on
// either solver pours the same fluid (count, tank bounds, rest height).
//
// A leaf that imports nothing: fluidGpu.worker.js runs it beside a FluidSolver MIRROR. The
// mirror owns the particles (x, v, age, flowing) and every cheap per-step job the CPU worker
// already does around a step (emitter/drain, spawn batches, flows, sinks, the lifetime and
// escaped-particle cull); this file only replaces the expensive middle — predict, the grid
// sort, the neighbour lists, the three density iterations with their collisions, velocity,
// XSPH viscosity. Each step uploads x/v/flowing, runs ~20 dispatches in ONE compute pass,
// and reads x/v and the dynamic colliders' reaction back (the visual and the buoyancy
// publish need the positions on the CPU anyway). Honest per-step cost = all of that.
//
// Differences from the CPU solver, all invisible at a glance: f32 arithmetic in a different
// order, and the order of a cell's particles comes from atomics (so which 48 neighbours a
// crowded particle keeps can differ). The fluid is LOCAL per peer either way — what
// replicates is `userData.fluid`, so peers on different solvers stay in sync.

/** must match fluidCore's private constants (the GPU port of the same solver) */
export const GPU_MAX_NEIGHBORS = 48;
const ITERATIONS = 3;
const MAX_SPEED = 12;
/** the most colliders one step carries to the GPU (fluidRuntime sends <= 16, an emitter more) */
export const GPU_MAX_COLLIDERS = 64;
const COL_STRIDE = 24;
const WG = 64;
/** reaction impulses are summed as fixed-point integers (atomics are integer-only) */
const IMP_SCALE = 1e6;

/** [name, type] — ONE table builds the WGSL struct and the JS writer (offsets cannot drift) */
const PARAMS = /** @type {const} */ ([
	['n', 'u32'], ['cells', 'u32'], ['dimX', 'u32'], ['dimY', 'u32'], ['dimZ', 'u32'], ['nCol', 'u32'],
	['minX', 'f32'], ['minY', 'f32'], ['minZ', 'f32'], ['maxX', 'f32'], ['maxY', 'f32'], ['maxZ', 'f32'],
	['cell', 'f32'], ['h', 'f32'], ['h2', 'f32'], ['poly6K', 'f32'], ['spikyK', 'f32'], ['rho0', 'f32'],
	['eps', 'f32'], ['radius', 'f32'], ['dt', 'f32'], ['gx', 'f32'], ['gy', 'f32'], ['gz', 'f32'],
	['scorrK', 'f32'], ['invScorrW', 'f32'], ['cohesionFloor', 'f32'], ['contactFriction', 'f32'],
	['viscC', 'f32'], ['w0', 'f32'], ['floorFriction', 'f32'], ['floorY', 'f32'], ['maxSpeed', 'f32'], ['wallBins', 'f32'],
	['wall0', 'u32'], ['wall1', 'u32'], ['wall2', 'u32'], ['wall3', 'u32'], ['wall4', 'u32'], ['wall5', 'u32'],
	['floorOn', 'u32'], ['oCount', 'u32'], ['oStart', 'u32'], ['oFill', 'u32'], ['oCellOf', 'u32'],
	['oSorted', 'u32'], ['oNbrN', 'u32'], ['oNbr', 'u32'], ['oFlow', 'u32'], ['oDp', 'u32'], ['oCol', 'u32'], ['pad0', 'u32']
]);
const PARAM_BYTES = Math.ceil((PARAMS.length * 4) / 16) * 16;

const HEADER = (/** @type {boolean} */ atomicGrid) => /* wgsl */ `
struct Params { ${PARAMS.map(([n, t]) => `${n}: ${t}`).join(', ')} }
@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var<storage, read_write> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> V: array<f32>;
@group(0) @binding(3) var<storage, read_write> Pp: array<f32>;
@group(0) @binding(4) var<storage, read_write> S: array<f32>;
@group(0) @binding(5) var<storage, read_write> G: array<${atomicGrid ? 'atomic<u32>' : 'u32'}>;
@group(0) @binding(6) var<storage, read> K: array<f32>;
@group(0) @binding(7) var<storage, read_write> I: array<atomic<i32>>;
fn getX(i: u32) -> vec3f { return vec3f(X[3u * i], X[3u * i + 1u], X[3u * i + 2u]); }
fn setX(i: u32, v: vec3f) { X[3u * i] = v.x; X[3u * i + 1u] = v.y; X[3u * i + 2u] = v.z; }
fn getV(i: u32) -> vec3f { return vec3f(V[3u * i], V[3u * i + 1u], V[3u * i + 2u]); }
fn setV(i: u32, v: vec3f) { V[3u * i] = v.x; V[3u * i + 1u] = v.y; V[3u * i + 2u] = v.z; }
fn getP(i: u32) -> vec3f { return vec3f(Pp[3u * i], Pp[3u * i + 1u], Pp[3u * i + 2u]); }
fn setP(i: u32, v: vec3f) { Pp[3u * i] = v.x; Pp[3u * i + 1u] = v.y; Pp[3u * i + 2u] = v.z; }
fn mn() -> vec3f { return vec3f(u.minX, u.minY, u.minZ); }
fn mx() -> vec3f { return vec3f(u.maxX, u.maxY, u.maxZ); }
fn cellOf(p: vec3f) -> u32 {
	let hi = vec3f(f32(u.dimX) - 1.0, f32(u.dimY) - 1.0, f32(u.dimZ) - 1.0);
	let c = vec3u(clamp(floor((p - mn()) / u.cell), vec3f(0.0), hi));
	return (c.z * u.dimY + c.y) * u.dimX + c.x;
}
`;

const MAIN = /* wgsl */ `
fn wallOn(k: u32) -> bool {
	switch k {
		case 0u: { return u.wall0 != 0u; }
		case 1u: { return u.wall1 != 0u; }
		case 2u: { return u.wall2 != 0u; }
		case 3u: { return u.wall3 != 0u; }
		case 4u: { return u.wall4 != 0u; }
		default: { return u.wall5 != 0u; }
	}
}
// the glass as fluid: fluidCore's wall tables, indexed by distance above a wall
fn wallBin(d: f32) -> i32 {
	if (d >= u.h) { return -1; }
	return i32(clamp(floor(d / u.h * u.wallBins + 0.5), 0.0, u.wallBins));
}
fn wallRho(b: i32) -> f32 { return K[u32(b)]; }
fn wallGrad(b: i32) -> f32 { return K[u32(b) + u32(u.wallBins) + 1u]; }
fn poly6(r2: f32) -> f32 {
	if (r2 >= u.h2) { return 0.0; }
	let d = u.h2 - r2;
	return u.poly6K * d * d * d;
}
fn rotq(q: vec4f, v: vec3f) -> vec3f {
	let t = 2.0 * cross(q.xyz, v);
	return v + q.w * t + cross(q.xyz, t);
}

@compute @workgroup_size(${WG}) fn predict(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	var v = getV(i) + vec3f(u.gx, u.gy, u.gz) * u.dt;
	let sp = length(v);
	if (sp > u.maxSpeed) { v = v * (u.maxSpeed / sp); }
	setV(i, v);
	setP(i, getX(i) + v * u.dt);
}

@compute @workgroup_size(${WG}) fn neighbours(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let c = G[u.oCellOf + i];
	let cx = i32(c % u.dimX);
	let cy = i32((c / u.dimX) % u.dimY);
	let cz = i32(c / (u.dimX * u.dimY));
	let pi = getP(i);
	var n = 0u;
	let base = u.oNbr + i * ${GPU_MAX_NEIGHBORS}u;
	for (var dz = -1; dz <= 1; dz++) {
		let z = cz + dz;
		if (z < 0 || z >= i32(u.dimZ)) { continue; }
		for (var dy = -1; dy <= 1; dy++) {
			let y = cy + dy;
			if (y < 0 || y >= i32(u.dimY)) { continue; }
			for (var dx = -1; dx <= 1; dx++) {
				let x = cx + dx;
				if (x < 0 || x >= i32(u.dimX)) { continue; }
				let cc = (u32(z) * u.dimY + u32(y)) * u.dimX + u32(x);
				let k1 = G[u.oStart + cc + 1u];
				for (var k = G[u.oStart + cc]; k < k1 && n < ${GPU_MAX_NEIGHBORS}u; k++) {
					let j = G[u.oSorted + k];
					if (j == i) { continue; }
					let r = pi - getP(j);
					if (dot(r, r) < u.h2) { G[base + n] = j; n++; }
				}
			}
		}
	}
	G[u.oNbrN + i] = n;
}

@compute @workgroup_size(${WG}) fn lambdas(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let pi = getP(i);
	var rho = u.poly6K * u.h2 * u.h2 * u.h2;
	var g = vec3f(0.0);
	var sum2 = 0.0;
	let cnt = G[u.oNbrN + i];
	let base = u.oNbr + i * ${GPU_MAX_NEIGHBORS}u;
	for (var q = 0u; q < cnt; q++) {
		let r = pi - getP(G[base + q]);
		let r2 = dot(r, r);
		if (r2 >= u.h2) { continue; }
		let d6 = u.h2 - r2;
		rho += u.poly6K * d6 * d6 * d6;
		let rl = sqrt(r2);
		if (rl > 1e-9 && rl < u.h) {
			let wv = (u.spikyK * (u.h - rl) * (u.h - rl) / (rl * u.rho0)) * r;
			g += wv;
			sum2 += dot(wv, wv);
		}
	}
	let lo3 = mn();
	let hi3 = mx();
	for (var a = 0u; a < 3u; a++) {
		var lo = -1;
		if (wallOn(a * 2u)) { lo = wallBin(pi[a] - lo3[a]); }
		if (lo >= 0) { rho += wallRho(lo); g[a] += wallGrad(lo); }
		var hi = -1;
		if (wallOn(a * 2u + 1u)) { hi = wallBin(hi3[a] - pi[a]); }
		if (hi >= 0) { rho += wallRho(hi); g[a] -= wallGrad(hi); }
	}
	sum2 += dot(g, g);
	let C = max(rho / u.rho0 - 1.0, u.cohesionFloor);
	S[i] = -C / (sum2 + u.eps);
}

@compute @workgroup_size(${WG}) fn deltas(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let pi = getP(i);
	let li = S[i];
	var d = vec3f(0.0);
	let cnt = G[u.oNbrN + i];
	let base = u.oNbr + i * ${GPU_MAX_NEIGHBORS}u;
	for (var q = 0u; q < cnt; q++) {
		let j = G[base + q];
		let r = pi - getP(j);
		let r2 = dot(r, r);
		let rl = sqrt(r2);
		if (rl <= 1e-9 || rl >= u.h) { continue; }
		let d6 = u.h2 - r2;
		let ratio = u.poly6K * d6 * d6 * d6 * u.invScorrW;
		let scorr = -u.scorrK * ratio * ratio * ratio * ratio;
		d += ((li + S[j] + scorr) * u.spikyK * (u.h - rl) * (u.h - rl) / (rl * u.rho0)) * r;
	}
	let lo3 = mn();
	let hi3 = mx();
	for (var a = 0u; a < 3u; a++) {
		var w = 0.0;
		if (wallOn(a * 2u)) { let lo = wallBin(pi[a] - lo3[a]); if (lo >= 0) { w += wallGrad(lo); } }
		if (wallOn(a * 2u + 1u)) { let hi = wallBin(hi3[a] - pi[a]); if (hi >= 0) { w -= wallGrad(hi); } }
		d[a] += 2.0 * li * w;
	}
	let o = u.oDp + 3u * i;
	S[o] = d.x; S[o + 1u] = d.y; S[o + 2u] = d.z;
}

// fluidCore's sweptEntry (slab method): x = entry axis (-1 = none), y = the face coordinate
fn swept(s: vec3f, d: vec3f, e: vec3f) -> vec2f {
	var tE = -1e30;
	var tX = 1e30;
	var axis = -1;
	for (var a = 0; a < 3; a++) {
		if (abs(d[a]) < 1e-12) {
			if (abs(s[a]) >= e[a]) { return vec2f(-1.0, 0.0); }
			continue;
		}
		var t1 = (-e[a] - s[a]) / d[a];
		var t2 = (e[a] - s[a]) / d[a];
		if (t1 > t2) { let t = t1; t1 = t2; t2 = t; }
		if (t1 > tE) { tE = t1; axis = a; }
		tX = min(tX, t2);
		if (tE > tX) { return vec2f(-1.0, 0.0); }
	}
	if (axis < 0 || tE < -1e-3 || tE > 1.0) { return vec2f(-1.0, 0.0); }
	return vec2f(f32(axis), select(e[axis], -e[axis], d[axis] > 0.0));
}

fn react(slot: f32, w: vec3f) {
	if (slot < 0.0) { return; }
	let b = u32(slot) * 4u;
	atomicAdd(&I[b], i32(round(w.x * ${IMP_SCALE})));
	atomicAdd(&I[b + 1u], i32(round(w.y * ${IMP_SCALE})));
	atomicAdd(&I[b + 2u], i32(round(w.z * ${IMP_SCALE})));
	atomicAdd(&I[b + 3u], 1);
}

// friction on a resting (upward-facing) contact: fluidCore's rub
fn rub(p: vec3f, x: vec3f, nrm: vec3f, flowing: bool) -> vec3f {
	if (u.contactFriction <= 0.0 || nrm.y < 0.6 || flowing) { return p; }
	let d = p - x;
	let dn = dot(d, nrm);
	return p - (d - dn * nrm) * u.contactFriction;
}

// a touching particle rides along with a moving collider: fluidCore's carry
fn carry(p: vec3f, cb: u32, r: vec3f, nrm: vec3f) -> vec3f {
	let f = K[cb + 17u] * u.dt;
	let s = vec3f(K[cb + 11u], K[cb + 12u], K[cb + 13u]) + cross(vec3f(K[cb + 14u], K[cb + 15u], K[cb + 16u]), r);
	let sn = dot(s, nrm);
	return p + (s - sn * nrm) * f;
}

fn collide(i: u32, last: bool) {
	var p = getP(i);
	let x = getX(i);
	let r = u.radius;
	let lo3 = mn();
	let hi3 = mx();
	for (var a = 0u; a < 3u; a++) {
		if (p[a] < lo3[a] + r) {
			if (wallOn(a * 2u)) { p[a] = lo3[a] + r; }
		} else if (p[a] > hi3[a] - r) {
			if (wallOn(a * 2u + 1u)) { p[a] = hi3[a] - r; }
		}
	}
	let travel = length(p - x);
	let flowing = G[u.oFlow + i] != 0u;
	for (var ci = 0u; ci < u.nCol; ci++) {
		let cb = u.oCol + ci * ${COL_STRIDE}u;
		let c = vec3f(K[cb + 1u], K[cb + 2u], K[cb + 3u]);
		let e0 = p - c;
		let reach = K[cb + 20u] + travel;
		if (dot(e0, e0) > reach * reach) { continue; }
		let half = vec3f(K[cb + 4u], K[cb + 5u], K[cb + 6u]);
		let q = vec4f(K[cb + 7u], K[cb + 8u], K[cb + 9u], K[cb + 10u]);
		let qi = vec4f(-q.xyz, q.w);
		var slot = -1.0;
		if (last) { slot = K[cb + 18u]; }
		let moving = last && K[cb + 19u] != 0.0;
		if (K[cb] != 0.0) {
			let rr = half.x + r;
			let d2 = dot(e0, e0);
			if (d2 >= rr * rr || d2 < 1e-12) { continue; }
			let d = sqrt(d2);
			let push = (rr - d) / d;
			p += e0 * push;
			react(slot, -e0 * push);
			p = rub(p, x, e0 / d, flowing);
			if (moving) { p = carry(p, cb, e0, e0 / d); }
			continue;
		}
		let l = rotq(qi, e0);
		let ex = half + vec3f(r);
		var o = vec3f(0.0);
		if (abs(l.x) >= ex.x || abs(l.y) >= ex.y || abs(l.z) >= ex.z) {
			if (travel < K[cb + 21u]) { continue; }
			let s = rotq(qi, x - c);
			let hit = swept(s, l - s, ex);
			if (hit.x < 0.0) { continue; }
			let ax = u32(hit.x);
			o[ax] = hit.y - l[ax];
			let w = rotq(q, o);
			p += w;
			react(slot, -w);
			var wl = length(w);
			if (wl == 0.0) { wl = 1.0; }
			p = rub(p, x, w / wl, flowing);
			continue;
		}
		let b = rotq(qi, x - c);
		let f = abs(b) - ex;
		let ON = -1e-4;
		if (f.x > ON || f.y > ON || f.z > ON) {
			if (f.x >= f.y && f.x >= f.z) { o.x = select(-ex.x, ex.x, b.x > 0.0) - l.x; }
			else if (f.y >= f.z) { o.y = select(-ex.y, ex.y, b.y > 0.0) - l.y; }
			else { o.z = select(-ex.z, ex.z, b.z > 0.0) - l.z; }
		} else {
			let pn = ex - abs(l);
			if (pn.x <= pn.y && pn.x <= pn.z) { o.x = select(-pn.x, pn.x, l.x > 0.0); }
			else if (pn.y <= pn.z) { o.y = select(-pn.y, pn.y, l.y > 0.0); }
			else { o.z = select(-pn.z, pn.z, l.z > 0.0); }
		}
		let w = rotq(q, o);
		p += w;
		react(slot, -w);
		var wl = length(w);
		if (wl == 0.0) { wl = 1.0; }
		p = rub(p, x, w / wl, flowing);
		if (moving) { p = carry(p, cb, e0, w / wl); }
	}
	setP(i, p);
}

fn applyDelta(i: u32) {
	let o = u.oDp + 3u * i;
	setP(i, getP(i) + vec3f(S[o], S[o + 1u], S[o + 2u]));
}
@compute @workgroup_size(${WG}) fn applyQuiet(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	applyDelta(i);
	collide(i, false);
}
@compute @workgroup_size(${WG}) fn applyLast(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	applyDelta(i);
	collide(i, true);
}

@compute @workgroup_size(${WG}) fn velocity(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let p = getP(i);
	var v = (p - getX(i)) / u.dt;
	if (u.floorOn != 0u && p.y <= u.floorY && G[u.oFlow + i] == 0u) {
		v.x *= 1.0 - u.floorFriction;
		v.z *= 1.0 - u.floorFriction;
	}
	setV(i, v);
}

@compute @workgroup_size(${WG}) fn viscosity(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let pi = getP(i);
	let vi = getV(i);
	var acc = vec3f(0.0);
	let cnt = G[u.oNbrN + i];
	let base = u.oNbr + i * ${GPU_MAX_NEIGHBORS}u;
	for (var q = 0u; q < cnt; q++) {
		let j = G[base + q];
		let r = pi - getP(j);
		acc += (getV(j) - vi) * (poly6(dot(r, r)) * u.w0);
	}
	let o = u.oDp + 3u * i;
	S[o] = acc.x; S[o + 1u] = acc.y; S[o + 2u] = acc.z;
}

@compute @workgroup_size(${WG}) fn finish(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	if (u.viscC != 0.0) {
		let o = u.oDp + 3u * i;
		setV(i, getV(i) + u.viscC * vec3f(S[o], S[o + 1u], S[o + 2u]));
	}
	setX(i, getP(i));
}
`;

// the counting sort over the dense grid (atomics): clear, count, one-workgroup scan, scatter
const GRID = /* wgsl */ `
@compute @workgroup_size(${WG}) fn clearCells(@builtin(global_invocation_id) gid: vec3u) {
	let c = gid.x;
	if (c >= u.cells) { return; }
	atomicStore(&G[u.oCount + c], 0u);
}
@compute @workgroup_size(${WG}) fn countCells(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let c = cellOf(getP(i));
	atomicStore(&G[u.oCellOf + i], c);
	atomicAdd(&G[u.oCount + c], 1u);
}
var<workgroup> sums: array<u32, 256>;
@compute @workgroup_size(256) fn scanCells(@builtin(local_invocation_id) lid: vec3u) {
	let t = lid.x;
	let per = (u.cells + 255u) / 256u;
	let b = min(t * per, u.cells);
	let e = min(b + per, u.cells);
	var s = 0u;
	for (var c = b; c < e; c++) { s += atomicLoad(&G[u.oCount + c]); }
	sums[t] = s;
	workgroupBarrier();
	for (var off = 1u; off < 256u; off *= 2u) {
		var add = 0u;
		if (t >= off) { add = sums[t - off]; }
		workgroupBarrier();
		sums[t] += add;
		workgroupBarrier();
	}
	var run = 0u;
	if (t > 0u) { run = sums[t - 1u]; }
	for (var c = b; c < e; c++) {
		atomicStore(&G[u.oStart + c], run);
		atomicStore(&G[u.oFill + c], run);
		run += atomicLoad(&G[u.oCount + c]);
	}
	if (t == 255u) { atomicStore(&G[u.oStart + u.cells], sums[255]); }
}
@compute @workgroup_size(${WG}) fn scatter(@builtin(global_invocation_id) gid: vec3u) {
	let i = gid.x;
	if (i >= u.n) { return; }
	let c = atomicLoad(&G[u.oCellOf + i]);
	let k = atomicAdd(&G[u.oFill + c], 1u);
	atomicStore(&G[u.oSorted + k], i);
}
`;

/** the six walls' and the colliders' constants buffer: [wallRho(B+1) | wallGrad(B+1) | colliders] */
const wallFloats = (/** @type {number} */ bins) => 2 * (bins + 1);

/**
 * One device per worker. Throws (with a reason) when this browser has no WebGPU compute.
 * @param {any} [gpu] navigator.gpu (a test may pass a stub)
 * @returns {Promise<{device: any, adapter: any, info: {vendor: string, architecture: string, device: string, description: string, fallback: boolean}}>}
 */
export async function requestFluidDevice(gpu = /** @type {any} */ (globalThis).navigator?.gpu) {
	if (!gpu) throw new Error('no WebGPU in this browser');
	const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
	if (!adapter) throw new Error('no WebGPU adapter');
	if (adapter.limits.maxStorageBuffersPerShaderStage < 7) throw new Error('adapter allows too few storage buffers');
	const device = await adapter.requestDevice();
	const i = adapter.info ?? {};
	return {
		device,
		adapter,
		info: {
			vendor: String(i.vendor ?? ''),
			architecture: String(i.architecture ?? ''),
			device: String(i.device ?? ''),
			description: String(i.description ?? ''),
			fallback: !!(adapter.isFallbackAdapter ?? i.isFallbackAdapter)
		}
	};
}

/** @type {WeakMap<any, any>} device -> its compiled pipelines (shared by every tank) */
const pipelineCache = new WeakMap();

/** @param {any} device */
function pipelinesFor(device) {
	let p = pipelineCache.get(device);
	if (p) return p;
	const S = 0x4; // GPUShaderStage.COMPUTE
	const layout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: S, buffer: { type: 'uniform' } },
			...[1, 2, 3, 4, 5, 7].map((b) => ({ binding: b, visibility: S, buffer: { type: 'storage' } })),
			{ binding: 6, visibility: S, buffer: { type: 'read-only-storage' } }
		]
	});
	const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
	const main = device.createShaderModule({ code: HEADER(false) + MAIN });
	const grid = device.createShaderModule({ code: HEADER(true) + GRID });
	const mk = (/** @type {any} */ module, /** @type {string} */ entryPoint) => device.createComputePipeline({ layout: pl, compute: { module, entryPoint } });
	p = { layout };
	for (const e of ['clearCells', 'countCells', 'scanCells', 'scatter']) p[e] = mk(grid, e);
	for (const e of ['predict', 'neighbours', 'lambdas', 'deltas', 'applyQuiet', 'applyLast', 'velocity', 'viscosity', 'finish']) p[e] = mk(main, e);
	pipelineCache.set(device, p);
	return p;
}

/**
 * The GPU half of one tank. `solver` is a fluidCore FluidSolver (the MIRROR): its constants,
 * wall tables and particle arrays; `step` reads and writes them exactly where
 * FluidSolver.step would.
 */
export class GpuFluidStepper {
	/** @param {any} device @param {any} solver a FluidSolver */
	constructor(device, solver) {
		this.device = device;
		this.solver = solver;
		this.p = pipelinesFor(device);
		const cap = solver.capacity;
		const cells = solver.dims[0] * solver.dims[1] * solver.dims[2];
		this.cells = cells;
		// the u32 grid buffer: count | start (+1) | fill | cellOf | sorted | nbrCount | nbr | flowing
		let o = 0;
		const take = (/** @type {number} */ n) => ((o += n), o - n);
		this.off = {
			oCount: take(cells), oStart: take(cells + 1), oFill: take(cells), oCellOf: take(cap), oSorted: take(cap),
			oNbrN: take(cap), oNbr: take(cap * GPU_MAX_NEIGHBORS), oFlow: take(cap)
		};
		const gridWords = o;
		const U = 0x80 | 0x08 | 0x04; // STORAGE | COPY_DST | COPY_SRC
		const buf = (/** @type {number} */ bytes, /** @type {number} */ usage) => device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage });
		this.uBuf = buf(PARAM_BYTES, 0x40 | 0x08); // UNIFORM | COPY_DST
		this.xBuf = buf(cap * 12, U);
		this.vBuf = buf(cap * 12, U);
		this.pBuf = buf(cap * 12, U);
		this.sBuf = buf(cap * 16, U); // lambda (cap) | dp (3 cap)
		this.gBuf = buf(gridWords * 4, U);
		this.bins = solver.wallBins;
		this.kBuf = buf((wallFloats(this.bins) + GPU_MAX_COLLIDERS * COL_STRIDE) * 4, U);
		this.iBuf = buf(GPU_MAX_COLLIDERS * 16, U);
		this.readBuf = buf(cap * 24 + GPU_MAX_COLLIDERS * 16, 0x01 | 0x08); // MAP_READ | COPY_DST
		this.bind = device.createBindGroup({
			layout: this.p.layout,
			entries: [this.uBuf, this.xBuf, this.vBuf, this.pBuf, this.sBuf, this.gBuf, this.kBuf, this.iBuf].map((buffer, binding) => ({ binding, resource: { buffer } }))
		});
		const walls = new Float32Array(wallFloats(this.bins));
		walls.set(solver.wallRho.subarray(0, this.bins + 1), 0);
		walls.set(solver.wallGrad.subarray(0, this.bins + 1), this.bins + 1);
		device.queue.writeBuffer(this.kBuf, 0, walls);
		this.params = new ArrayBuffer(PARAM_BYTES);
		this.paramView = new DataView(this.params);
		this.colData = new Float32Array(GPU_MAX_COLLIDERS * COL_STRIDE);
		this.flow32 = new Uint32Array(cap);
		this.zeroImp = new Int32Array(GPU_MAX_COLLIDERS * 4);
		/** colliders beyond GPU_MAX_COLLIDERS this tank was handed (not simulated) */
		this.colliderOverflow = 0;
		/** colliders packed for this step */
		this.nCol = 0;
		/** @type {((solver: any, dt: number, o: any) => void) | null} a pass over old x / new p before x = p */
		this.beforeCommit = null;
		this.destroyed = false;
	}

	/** @param {Record<string, number>} values */
	writeParams(values) {
		const dv = this.paramView;
		PARAMS.forEach(([name, type], k) => {
			const val = values[name] ?? 0;
			if (type === 'u32') dv.setUint32(k * 4, val >>> 0, true);
			else dv.setFloat32(k * 4, val, true);
		});
		this.device.queue.writeBuffer(this.uBuf, 0, this.params);
	}

	/**
	 * Pack this step's colliders (fluidCore's FluidCollider, tank-local) and their reaction
	 * slots. @param {any[]} colliders @returns {string[]} slot -> collider id
	 */
	packColliders(colliders) {
		const r = this.solver.radius;
		const d = this.colData;
		/** @type {string[]} */
		const ids = [];
		const n = Math.min(colliders.length, GPU_MAX_COLLIDERS);
		this.colliderOverflow = colliders.length - n;
		for (let ci = 0; ci < n; ci++) {
			const c = colliders[ci];
			const b = ci * COL_STRIDE;
			const sphere = c.kind === 'sphere';
			const h = c.half;
			d[b] = sphere ? 1 : 0;
			d[b + 1] = c.center[0]; d[b + 2] = c.center[1]; d[b + 3] = c.center[2];
			d[b + 4] = h[0]; d[b + 5] = h[1] ?? h[0]; d[b + 6] = h[2] ?? h[0];
			const q = c.quat ?? [0, 0, 0, 1];
			d[b + 7] = q[0]; d[b + 8] = q[1]; d[b + 9] = q[2]; d[b + 10] = q[3];
			const v = c.vel, w = c.omega;
			d[b + 11] = v ? v[0] : 0; d[b + 12] = v ? v[1] : 0; d[b + 13] = v ? v[2] : 0;
			d[b + 14] = w ? w[0] : 0; d[b + 15] = w ? w[1] : 0; d[b + 16] = w ? w[2] : 0;
			d[b + 17] = c.carry ?? 0.8;
			let slot = -1;
			if (c.dynamic && c.id) {
				slot = ids.length;
				ids.push(c.id);
			}
			d[b + 18] = slot;
			d[b + 19] = v || w ? 1 : 0;
			d[b + 20] = (sphere ? h[0] : Math.hypot(h[0], h[1], h[2])) + r;
			d[b + 21] = sphere ? h[0] : Math.min(h[0], h[1], h[2]);
		}
		if (n) this.device.queue.writeBuffer(this.kBuf, wallFloats(this.bins) * 4, d, 0, n * COL_STRIDE);
		this.nCol = n;
		return ids;
	}

	/**
	 * One frame — FluidSolver.step(dt, o) with the middle on the GPU. Resolves with the
	 * active count once x/v (and the dynamic colliders' reaction) are back in the mirror.
	 * @param {number} dt @param {any} o the step message (gravity, viscosity, surfaceTension, colliders, walls, lifetime, cohesion, floorFriction)
	 */
	async step(dt, o) {
		const s = this.solver;
		const device = this.device;
		if (o.walls) s.setWalls(o.walls);
		s.impulses = {};
		const n = s.count;
		if (!n) {
			s.cull(Math.min(dt, 1 / 30), o.lifetime ?? 0);
			return s.count;
		}
		dt = Math.min(dt, 1 / 30);
		const ids = this.packColliders(o.colliders ?? []);
		const ff = Math.min(1, Math.max(0, o.floorFriction ?? 0));
		const visc = (o.viscosity ?? 0) * 0.5;
		const walls = s.walls;
		this.writeParams({
			n, cells: this.cells, dimX: s.dims[0], dimY: s.dims[1], dimZ: s.dims[2], nCol: this.nCol,
			minX: s.min[0], minY: s.min[1], minZ: s.min[2], maxX: s.max[0], maxY: s.max[1], maxZ: s.max[2],
			cell: s.cell, h: s.h, h2: s.h2, poly6K: s.poly6K, spikyK: s.spikyK, rho0: s.rho0, eps: s.eps, radius: s.radius,
			dt, gx: o.gravity[0], gy: o.gravity[1], gz: o.gravity[2],
			scorrK: 0.0012 * (o.surfaceTension ?? 0) * s.h2, invScorrW: 1 / s.scorrW,
			cohesionFloor: -0.2 * Math.min(1, Math.max(0, o.cohesion ?? 0)),
			contactFriction: ff / ITERATIONS,
			viscC: visc > 0 ? Math.min(visc, 0.5) / Math.max(1, GPU_MAX_NEIGHBORS / 8) : 0,
			w0: 1 / s.poly6(0), floorFriction: ff, floorY: s.min[1] + s.radius * 1.3, maxSpeed: MAX_SPEED, wallBins: this.bins,
			wall0: +walls[0], wall1: +walls[1], wall2: +walls[2], wall3: +walls[3], wall4: +walls[4], wall5: +walls[5],
			floorOn: ff > 0 && walls[2] ? 1 : 0,
			...this.off, oDp: s.capacity, oCol: wallFloats(this.bins), pad0: 0
		});
		const q = device.queue;
		q.writeBuffer(this.xBuf, 0, s.x, 0, n * 3);
		q.writeBuffer(this.vBuf, 0, s.v, 0, n * 3);
		const f32 = this.flow32;
		for (let i = 0; i < n; i++) f32[i] = s.flowing[i];
		q.writeBuffer(this.gBuf, this.off.oFlow * 4, f32, 0, n);
		if (ids.length) q.writeBuffer(this.iBuf, 0, this.zeroImp, 0, ids.length * 4);
		const enc = device.createCommandEncoder();
		const pass = enc.beginComputePass();
		pass.setBindGroup(0, this.bind);
		const P = this.p;
		const groups = Math.ceil(n / WG);
		const run = (/** @type {any} */ pipe, /** @type {number} */ count = groups) => {
			pass.setPipeline(pipe);
			pass.dispatchWorkgroups(count);
		};
		run(P.predict);
		run(P.clearCells, Math.ceil(this.cells / WG));
		run(P.countCells);
		run(P.scanCells, 1);
		run(P.scatter);
		run(P.neighbours);
		for (let it = 0; it < ITERATIONS; it++) {
			run(P.lambdas);
			run(P.deltas);
			run(it === ITERATIONS - 1 ? P.applyLast : P.applyQuiet);
		}
		run(P.velocity);
		if (visc > 0) run(P.viscosity);
		run(P.finish);
		pass.end();
		const bytes = n * 12;
		enc.copyBufferToBuffer(this.xBuf, 0, this.readBuf, 0, bytes);
		enc.copyBufferToBuffer(this.vBuf, 0, this.readBuf, bytes, bytes);
		if (ids.length) enc.copyBufferToBuffer(this.iBuf, 0, this.readBuf, bytes * 2, ids.length * 16);
		q.submit([enc.finish()]);
		const readBytes = bytes * 2 + ids.length * 16;
		await this.readBuf.mapAsync(1, 0, readBytes); // GPUMapMode.READ
		if (this.destroyed) return s.count;
		const out = this.readBuf.getMappedRange(0, readBytes);
		// the new positions land in the mirror's p and are committed below, exactly where
		// FluidSolver.step does x.set(p): a pass that compares old (x) and new (p) positions —
		// 49-water's crossSurfaces — runs at that same point through `beforeCommit`
		s.p.set(new Float32Array(out, 0, n * 3));
		s.v.set(new Float32Array(out, bytes, n * 3));
		if (ids.length) {
			const imp = new Int32Array(out, bytes * 2, ids.length * 4);
			const m = s.particleMass / dt / IMP_SCALE;
			ids.forEach((id, k) => {
				if (imp[k * 4 + 3] > 0) s.impulses[id] = [imp[k * 4] * m, imp[k * 4 + 1] * m, imp[k * 4 + 2] * m];
			});
		}
		this.readBuf.unmap();
		// (a pass may REMOVE particles — swap-removed from x, v and p — so commit the count it
		// leaves; the next step re-uploads x/v/count from the mirror, so the GPU keeps nothing stale)
		this.beforeCommit?.(s, dt, o);
		s.x.set(s.p.subarray(0, s.count * 3));
		s.cull(dt, o.lifetime ?? 0);
		return s.count;
	}

	destroy() {
		this.destroyed = true;
		for (const b of [this.uBuf, this.xBuf, this.vBuf, this.pBuf, this.sBuf, this.gBuf, this.kBuf, this.iBuf, this.readBuf]) b.destroy();
	}
}
