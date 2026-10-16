import { writable, get } from 'svelte/store';

// 46-media R1 — WHO ASKED FOR SHADOWS IN A HEADSET. A LEAF (svelte/store only), because both the
// quality governor (the XR entry floor) and the shadow runtime (shadowBudget.js) read it, and the
// governor is imported by lightParams, which shadowBudget imports — a store in either of them would
// close a cycle.
//
// A headset enters at the governor's XR floor, "shadows off" (the Quest budget), because a shadow
// pass is a second draw of every caster. A claim says "this scene's shadows are BUDGETED": its
// directional shadow is fitted around the player (shadowBudget.js), so the pass costs a few dozen
// calls instead of the whole valley, and the headset may keep it. The governor still steps down
// (level 1 = shadows off) when the frames cannot hold — a claim moves the FLOOR, not the ladder.
// LOCAL: a claim is a module's statement about this device's render, never sent, never saved.

/** @typedef {{id: number, radius: number, owner: string}} ShadowClaim */

/** @type {import('svelte/store').Writable<ShadowClaim[]>} */
export const shadowClaims = writable([]);

let nextId = 1;

/**
 * Hold a claim; returns `release()` (idempotent).
 * @param {{radius?: number, owner?: string}} [opts] radius = the reach (m) of the fitted shadow
 * @returns {() => void}
 */
export function claimBudgetedShadows(opts = {}) {
	/** @type {ShadowClaim} */
	const claim = { id: nextId++, radius: Number(opts.radius) || 0, owner: String(opts.owner ?? '') };
	shadowClaims.update((list) => [...list, claim]);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		shadowClaims.update((list) => list.filter((c) => c !== claim));
	};
}

/** Does any claim hold — i.e. does a headset keep shadows for this scene? */
export function shadowsKeptInXR() {
	return get(shadowClaims).length > 0;
}
