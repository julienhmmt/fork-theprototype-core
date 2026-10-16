// 46-media R1 — THE BUDGETED SHADOW, the pure half (shadowBudget.js is the wiring).
//
// MEASURED (Race, the headset analogue, shadows on — ~/.code/lanes-30/after-46/46-media/perf/):
// 142 calls / 306k tris against 37 / 64.6k with shadows off. The whole difference is the shadow
// pass, and two things made it that big:
//   · TWO directional casters: the scene's own `Sun` AND the environment preset's rig sun, so
//     every caster was drawn twice (and the ground showed two shadows per object);
//   · frusta over the WHOLE valley (the authored Sun ±326 m, the rig sun ±120 m), so every tree
//     (9-10k tris each), the kit batch and the mountains cast every frame even when they were
//     behind the player — three culls casters against the SHADOW camera, not the view.
// The fix is a single cascade that follows the viewer: the frustum is a square of `radius` around
// the viewer in the light's view plane, so only the casters whose shadow can land near the player
// are drawn (three's own shadow-frustum cull does the rest), and the map's texels are spent where
// the player looks (2048 over ±45 m = 4.4 cm, against 32 cm over ±326 m).

/** The environment rig's sun (environment.js names it; ONE source for both). */
export const ENV_RIG_SUN = 'env-rig-sun';

/** The default reach (m) of a budgeted shadow around the viewer. */
export const SHADOW_FIT_RADIUS = 40;
/** The reach is clamped to this range (a module asking for 0 or 10 km gets a sane square). */
export const SHADOW_FIT_MIN = 8;
export const SHADOW_FIT_MAX = 150;

/** @param {any} radius */
export function fitRadius(radius) {
	const r = Number(radius);
	if (!Number.isFinite(r) || r <= 0) return SHADOW_FIT_RADIUS;
	return Math.min(SHADOW_FIT_MAX, Math.max(SHADOW_FIT_MIN, r));
}

/**
 * The fitted square in the LIGHT'S VIEW SPACE: centred on the viewer (x, y = the viewer's
 * light-view coordinates), its centre SNAPPED to whole shadow-map texels — a square that slid
 * continuously with the head would resample every texel each frame and the shadow edges would
 * crawl ("shimmer"); snapped, a still shadow stays still while the viewer moves.
 * @param {number} x @param {number} y @param {number} radius @param {number} mapSize
 * @returns {{left: number, right: number, top: number, bottom: number, texel: number}}
 */
export function fitSquare(x, y, radius, mapSize) {
	const r = fitRadius(radius);
	const size = Number(mapSize) > 0 ? Number(mapSize) : 1024;
	const texel = (2 * r) / size;
	const cx = Math.round((Number(x) || 0) / texel) * texel;
	const cy = Math.round((Number(y) || 0) / texel) * texel;
	return { left: cx - r, right: cx + r, top: cy + r, bottom: cy - r, texel };
}

/**
 * The one budgeted claim in force when several modules hold one: the LARGEST reach wins (a
 * module that asked for 60 m must not see its far shadows cut by another's 30).
 * @param {{radius?: number}[]} claims @returns {{radius: number} | null}
 */
export function claimInForce(claims) {
	if (!Array.isArray(claims) || !claims.length) return null;
	return { radius: Math.max(...claims.map((c) => fitRadius(c?.radius))) };
}
