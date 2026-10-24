// 69 T1 — SCRIPT NODES IN THE GUEST. scriptRuntime keeps everything it owned (the lint, the loop
// guard, the per-node time budget, the badge); what changed is WHERE the compiled function lives:
// here it is compiled and called inside the sandbox guest (engine.js), and this module is the host
// half that marshals the same arguments the function always got.
//
// `object` is the one argument that was a LIVE THREE.Object3D, and a live object is the way out of
// any sandbox (its parent chain, its material's image, its constructor). The guest gets a VIEW
// instead — uuid, name, type, position, rotation, scale, quaternion, visible, plus `material` and
// `userData` fetched only when the script touches them — with three-alike maths classes, and the
// methods scripts use (lookAt, rotateX/Y/Z, translateX/Y/Z, getWorldPosition). After the call the
// guest diffs the view against what it was handed and the host applies ONLY the changed fields,
// each through an allowlist with type checks. Calls stay synchronous, so a script still sees the
// pose the animations before it in the chain produced, in the same frame.

import { newGuest } from './engine.js';
import { GUEST_MATH } from './guestMath.js';

/** userData keys a script may not write (prototype keys; everything else is the scene author's) */
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** a userData value larger than this (JSON chars) is not handed to the guest */
const USERDATA_VALUE_CAP = 20000;
const ORDERS = new Set(['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']);

/** @type {import('./engine.js').Guest | null} */
let guest = null;
/** the object a running effect script is looking at @type {any} */
let current = null;
/** the api of the running script (flowRuntime.scriptApi) @type {any} */
let currentApi = null;

const finite = (/** @type {any} */ v) => typeof v === 'number' && Number.isFinite(v);

/** @param {any} material */
function materialView(material) {
	if (!material || Array.isArray(material)) return null;
	/** @type {Record<string, any>} */
	const view = {};
	if (material.color?.isColor) view.color = [material.color.r, material.color.g, material.color.b];
	if (material.emissive?.isColor) view.emissive = [material.emissive.r, material.emissive.g, material.emissive.b];
	for (const key of ['opacity', 'emissiveIntensity', 'roughness', 'metalness'])
		if (finite(material[key])) view[key] = material[key];
	for (const key of ['transparent', 'wireframe', 'visible']) if (typeof material[key] === 'boolean') view[key] = material[key];
	return view;
}

/** @param {any} userData */
function userDataView(userData) {
	/** @type {Record<string, any>} */
	const out = {};
	if (!userData || typeof userData !== 'object') return out;
	for (const key of Object.keys(userData)) {
		if (BLOCKED_KEYS.has(key)) continue;
		try {
			const json = JSON.stringify(userData[key]);
			if (json !== undefined && json.length <= USERDATA_VALUE_CAP) out[key] = JSON.parse(json);
		} catch {
			// a cycle / a BigInt: not script data
		}
	}
	return out;
}

const ops = {
	ud: () => (current ? userDataView(current.userData) : null),
	mat: () => (current ? materialView(current.material) : null),
	/** @param {string} name @param {any[]} args */
	api: (name, args) => {
		if (!currentApi) throw new Error('api is not available in this script');
		const fn = currentApi[String(name)];
		if (typeof fn !== 'function') throw new TypeError('api.' + name + ' is not a function');
		return fn(...(Array.isArray(args) ? args : []));
	}
};

/** the scripts guest (null while the engine loads) */
function scriptGuest() {
	if (guest && !guest.disposed) return guest;
	guest = newGuest(ops, [GUEST_MATH, SCRIPT_PRELUDE]);
	return guest;
}

/** Is the guest ready (starts the load when it is not)? */
export function scriptSandboxReady() {
	return !!scriptGuest();
}

/**
 * Compile `body` (already linted + loop-guarded) under `key` for one of scriptRuntime's shapes.
 * Returns '' on success, the compile error's text otherwise, or null while the engine loads.
 * @param {string} key @param {string} shape @param {string} body
 */
export function compileInGuest(key, shape, body) {
	const g = scriptGuest();
	if (!g) return null;
	return String(g.callEntry('__compile', key, shape, body) ?? '');
}

/** drop every compiled function (scriptRuntime's cache was cleared) */
export function forgetCompiled() {
	if (guest && !guest.disposed) guest.callEntry('__forgetAll');
}

/** @param {any} object */
function snapshotOf(object) {
	const wp = object.getWorldPosition ? object.getWorldPosition(object.position.clone()) : object.position;
	return {
		u: String(object.uuid ?? ''),
		n: String(object.name ?? ''),
		ty: String(object.type ?? ''),
		p: [object.position.x, object.position.y, object.position.z],
		r: [object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.order],
		s: [object.scale.x, object.scale.y, object.scale.z],
		q: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
		v: !!object.visible,
		wp: [wp.x, wp.y, wp.z]
	};
}

/** @param {any} target @param {any} arr @param {string[]} keys */
function setComponents(target, arr, keys) {
	if (!Array.isArray(arr)) return false;
	let changed = false;
	keys.forEach((k, i) => {
		if (finite(arr[i]) && target[k] !== arr[i]) {
			target[k] = arr[i];
			changed = true;
		}
	});
	return changed;
}

/** apply a guest patch to the real object — allowlisted fields, type-checked values @param {any} object @param {any} p */
export function applyObjectPatch(object, p) {
	if (!p || typeof p !== 'object') return;
	if (Array.isArray(p.p)) setComponents(object.position, p.p, ['x', 'y', 'z']);
	if (Array.isArray(p.r)) {
		const r = p.r;
		const order = ORDERS.has(r[3]) ? r[3] : object.rotation.order;
		object.rotation.set(finite(r[0]) ? r[0] : object.rotation.x, finite(r[1]) ? r[1] : object.rotation.y, finite(r[2]) ? r[2] : object.rotation.z, order);
	} else if (Array.isArray(p.q) && p.q.every(finite)) object.quaternion.set(p.q[0], p.q[1], p.q[2], p.q[3]).normalize();
	if (Array.isArray(p.s)) setComponents(object.scale, p.s, ['x', 'y', 'z']);
	if (typeof p.v === 'boolean') object.visible = p.v;
	if (p.ud && typeof p.ud === 'object' && object.userData) {
		for (const key of Object.keys(p.ud)) if (!BLOCKED_KEYS.has(key)) object.userData[key] = p.ud[key];
	}
	if (Array.isArray(p.udDel) && object.userData) {
		for (const key of p.udDel) if (typeof key === 'string' && !BLOCKED_KEYS.has(key)) delete object.userData[key];
	}
	const m = p.m;
	const material = object.material;
	if (m && typeof m === 'object' && material && !Array.isArray(material)) {
		if (material.color?.isColor) setComponents(material.color, m.color, ['r', 'g', 'b']);
		if (material.emissive?.isColor) setComponents(material.emissive, m.emissive, ['r', 'g', 'b']);
		if (finite(m.opacity)) material.opacity = Math.max(0, Math.min(1, m.opacity));
		for (const key of ['emissiveIntensity', 'roughness', 'metalness']) if (finite(m[key]) && key in material) material[key] = m[key];
		for (const key of ['wireframe', 'visible']) if (typeof m[key] === 'boolean') material[key] = m[key];
		// a render-program change: three must recompile the material
		if (typeof m.transparent === 'boolean' && material.transparent !== m.transparent) {
			material.transparent = m.transparent;
			material.needsUpdate = true;
		}
	}
}

/**
 * Run a compiled EFFECT (v1 or v2) on `object`.
 * @param {string} key @param {boolean} v2 @param {any} object @param {any} base @param {any} data
 * @param {number} time @param {any} [inputs] @param {any} [api]
 */
export function runEffectInGuest(key, v2, object, base, data, time, inputs, api) {
	const g = scriptGuest();
	if (!g) return undefined;
	current = object && object.position ? object : null;
	currentApi = api ?? null;
	try {
		const out = g.callEntry('__runEffect', key, v2, current ? snapshotOf(current) : null, base ?? null, data ?? null, time, inputs ?? null, !!api);
		if (current && out?.patch) applyObjectPatch(current, out.patch);
		return out?.result;
	} finally {
		current = null;
		currentApi = null;
	}
}

/** a compiled VALUE script @param {string} key @param {any} inputs @param {number} time @param {any} [api] */
export function runValueInGuest(key, inputs, time, api) {
	const g = scriptGuest();
	if (!g) return undefined;
	currentApi = api ?? null;
	try {
		return g.callEntry('__runValue', key, inputs ?? null, time, !!api);
	} finally {
		currentApi = null;
	}
}

/** a compiled built-in "Player" body @param {string} key @param {any} settings @param {any} input @param {number} time */
export function runPlayerInGuest(key, settings, input, time) {
	const g = scriptGuest();
	if (!g) return undefined;
	return g.callEntry('__runPlayer', key, settings ?? null, input ?? null, time);
}

/** tests / debug: the guest itself (null until loaded) */
export function scriptGuestForTest() {
	return scriptGuest();
}

// ---- guest side ------------------------------------------------------------------------------
const SCRIPT_PRELUDE = String.raw`
(function () {
	'use strict';
	const B = __bridge;
	const { Vector3, Quaternion, Euler, Color, matOf, fin } = __guestMath;
	const SIG = {
		v1: ['object', 'base', 'data', 'time', 'params'],
		effect: ['object', 'base', 'data', 'time', 'params', 'inputs', 'dist', 'lerp', 'clamp', 'api'],
		value: ['inputs', 'time', 'dist', 'lerp', 'clamp', 'api'],
		player: ['settings', 'input', 'time', 'dist', 'lerp', 'clamp']
	};
	// scriptIO's SCRIPT_HELPERS, verbatim in behaviour
	const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
	const pointOf = (p) => {
		if (Array.isArray(p)) return [finite(p[0]), finite(p[1]), finite(p[2])];
		if (p && Array.isArray(p.position)) return pointOf(p.position);
		if (p && typeof p === 'object' && 'x' in p) return [finite(p.x), finite(p.y), finite(p.z)];
		return [0, 0, 0];
	};
	const dist = (a, b) => {
		const p = pointOf(a), q = pointOf(b);
		return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
	};
	const lerp = (a, b, t) => a + (b - a) * t;
	const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
	const api = Object.freeze({
		object: (ref) => B.call('api', 'object', [ref && typeof ref === 'object' ? { uuid: ref.uuid } : ref]),
		raycast: (from, dir, max) => B.call('api', 'raycast', max === undefined ? [from, dir] : [from, dir, max]),
		keys: () => B.call('api', 'keys', []),
		spawn: (command) => B.call('api', 'spawn', [command])
	});

	const fns = new Map();
	const def = (name, fn) => Object.defineProperty(globalThis, name, { value: (json) => B.encode(fn(...B.decode(json))) });
	def('__compile', (key, shape, body) => {
		try {
			fns.set(key, new Function(...SIG[shape], body));
			return '';
		} catch (error) {
			return String(error);
		}
	});
	def('__forgetAll', () => {
		fns.clear();
		return true;
	});

	const Z = new Vector3(0, 0, 1), X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
	const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i] || (v !== v && b[i] !== b[i]));
	/** the object a script sees: a view, diffed afterwards */
	function viewOf(o) {
		const view = {
			uuid: o.u,
			name: o.n,
			type: o.ty,
			position: new Vector3(o.p[0], o.p[1], o.p[2]),
			rotation: new Euler(o.r[0], o.r[1], o.r[2], o.r[3]),
			scale: new Vector3(o.s[0], o.s[1], o.s[2]),
			quaternion: new Quaternion(o.q[0], o.q[1], o.q[2], o.q[3]),
			visible: o.v,
			up: new Vector3(0, 1, 0),
			isObject3D: true,
			rotateOnAxis(axis, angle) {
				const q = new Quaternion().setFromEuler(this.rotation).multiply(new Quaternion().setFromAxisAngle(axis, angle));
				this.quaternion.copy(q);
				this.rotation.setFromQuaternion(q);
				return this;
			},
			rotateX(a) { return this.rotateOnAxis(X, a); },
			rotateY(a) { return this.rotateOnAxis(Y, a); },
			rotateZ(a) { return this.rotateOnAxis(Z, a); },
			translateOnAxis(axis, d) {
				const v = axis.clone().applyQuaternion(new Quaternion().setFromEuler(this.rotation));
				this.position.addScaledVector(v, d);
				return this;
			},
			translateX(d) { return this.translateOnAxis(X, d); },
			translateY(d) { return this.translateOnAxis(Y, d); },
			translateZ(d) { return this.translateOnAxis(Z, d); },
			lookAt(x, y, z) {
				const t = x && typeof x === 'object' ? new Vector3(x.x, x.y, x.z) : new Vector3(x, y, z);
				const zAxis = t.sub(this.position);
				if (zAxis.lengthSq() === 0) zAxis.z = 1;
				zAxis.normalize();
				let xAxis = new Vector3().crossVectors(this.up, zAxis);
				if (xAxis.lengthSq() === 0) {
					zAxis.x += Math.abs(this.up.z) === 1 ? 0.0001 : 0;
					zAxis.z += Math.abs(this.up.z) === 1 ? 0 : 0.0001;
					zAxis.normalize();
					xAxis = new Vector3().crossVectors(this.up, zAxis);
				}
				xAxis.normalize();
				const yAxis = new Vector3().crossVectors(zAxis, xAxis);
				const q = new Quaternion().setFromRotationMatrix([xAxis.x, yAxis.x, zAxis.x, xAxis.y, yAxis.y, zAxis.y, xAxis.z, yAxis.z, zAxis.z]);
				this.quaternion.copy(q);
				this.rotation.setFromQuaternion(q);
				return this;
			},
			getWorldPosition(target) {
				const v = target || new Vector3();
				return v.set(o.wp[0] + this.position.x - o.p[0], o.wp[1] + this.position.y - o.p[1], o.wp[2] + this.position.z - o.p[2]);
			},
			getWorldQuaternion(target) { return (target || new Quaternion()).setFromEuler(this.rotation); },
			updateMatrix() {},
			updateMatrixWorld() {},
			updateWorldMatrix() {}
		};
		let ud = null, udJson = null, mat = null, matJson = null;
		Object.defineProperty(view, 'userData', {
			enumerable: true,
			get() {
				if (ud === null) {
					ud = B.call('ud') || {};
					udJson = {};
					for (const k of Object.keys(ud)) udJson[k] = JSON.stringify(ud[k]);
				}
				return ud;
			}
		});
		Object.defineProperty(view, 'material', {
			enumerable: true,
			get() {
				if (mat === null) {
					const m = B.call('mat');
					if (!m) return (mat = undefined);
					matJson = JSON.stringify(m);
					mat = { ...m };
					if (m.color) mat.color = new Color().setRGB(m.color[0], m.color[1], m.color[2]);
					if (m.emissive) mat.emissive = new Color().setRGB(m.emissive[0], m.emissive[1], m.emissive[2]);
				}
				return mat;
			}
		});
		view.__patch = () => {
			const p = {};
			const pos = [view.position.x, view.position.y, view.position.z];
			if (!same(pos, o.p)) p.p = pos;
			const rot = [view.rotation.x, view.rotation.y, view.rotation.z, view.rotation.order];
			const q = [view.quaternion.x, view.quaternion.y, view.quaternion.z, view.quaternion.w];
			if (!same(rot, o.r)) p.r = rot;
			else if (!same(q, o.q)) p.q = q;
			const sc = [view.scale.x, view.scale.y, view.scale.z];
			if (!same(sc, o.s)) p.s = sc;
			if (!!view.visible !== o.v) p.v = !!view.visible;
			if (ud) {
				const changed = {};
				let any = false;
				for (const k of Object.keys(ud)) {
					const j = JSON.stringify(ud[k]);
					if (j !== udJson[k]) { changed[k] = ud[k]; any = true; }
				}
				if (any) p.ud = changed;
				const gone = Object.keys(udJson).filter((k) => !(k in ud));
				if (gone.length) p.udDel = gone;
			}
			if (mat) {
				const now = {};
				for (const k of Object.keys(mat)) {
					const v = mat[k];
					now[k] = v && v.isColor ? [v.r, v.g, v.b] : v;
				}
				const j = JSON.stringify(now);
				if (j !== matJson) p.m = now;
			}
			return p;
		};
		return view;
	}

	const fnOf = (key) => {
		const fn = fns.get(key);
		if (!fn) throw new Error('Script could not be compiled');
		return fn;
	};
	def('__runEffect', (key, v2, snap, base, data, time, inputs, withApi) => {
		const fn = fnOf(key);
		const object = snap ? viewOf(snap) : null;
		const result = v2
			? fn(object, base, data, time, data, inputs, dist, lerp, clamp, withApi ? api : undefined)
			: fn(object, base, data, time, data);
		return { patch: object ? object.__patch() : null, result: result === undefined ? undefined : result };
	});
	def('__runValue', (key, inputs, time, withApi) => fnOf(key)(inputs, time, dist, lerp, clamp, withApi ? api : undefined));
	def('__runPlayer', (key, settings, input, time) => fnOf(key)(settings, input, time, dist, lerp, clamp));
})();
`;
