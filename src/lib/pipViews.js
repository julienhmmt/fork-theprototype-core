// 43 K5 — ONE PICTURE-IN-PICTURE RENDERER for every PiP window (the camera preview, 16-Q4, and the
// maximized dock's viewport PiP). A leaf: no imports, so Outline (the render loop), the windows and
// the suites all reach it without touching history's import family.
//
// HOW A PiP IS DRAWN. Still no second WebGL context (16-Q4's rule: a second context duplicates every
// texture and geometry on the GPU). Each frame, BEFORE the main frame, Outline renders each visible
// view with the SAME renderer into a scissored corner of the drawing buffer at REDUCED resolution and
// copies those pixels into the PiP's own small 2D <canvas> (`drawImage` of the WebGL canvas inside the
// frame that drew it — no preserveDrawingBuffer needed); the main frame then paints over that corner.
// 16-Q4 drew the inset straight into the main canvas instead, which only works while the main canvas
// is what is on screen there. A PiP with its own canvas is a real DOM window: it can sit above a
// docked window that covers the whole 3D view (K5: "on top of any docked window"), it takes its own
// pointer events, and resizing it is just resizing a box.
//
// A view is drawn only while its canvas is connected and laid out (a closed or hidden PiP costs
// nothing), and at `scale` of its CSS size × device pixel ratio (PIP_SCALE by default).

/**
 * @typedef {{
 *   canvas: HTMLCanvasElement,
 *   camera: (aspect: number) => any,
 *   before?: () => void,
 *   after?: () => void,
 *   scale?: number
 * }} PipView
 */

/** the default render resolution of a PiP, relative to its CSS size × the device pixel ratio */
export const PIP_SCALE = 0.75;

/** @type {Map<string, PipView>} */
const views = new Map();

/** 43 K5: a docked window covers the WHOLE 3D view (focus mode 'dock' at full height): nothing can
 *  see the main frame, so the render loop skips it — the viewport PiP is then the only 3D drawing,
 *  which is what makes a maximized dock CHEAPER than the editor it hides. Set by ViewportPip. */
let mainCovered = false;
/** @param {boolean} v */
export function setMainViewCovered(v) {
	mainCovered = !!v;
}
/** is the main 3D view covered (and so not worth drawing)? */
export function mainViewCovered() {
	return mainCovered;
}
/** main frames skipped while covered (the perf gate reads it) */
let skipped = 0;
export function noteMainSkipped() {
	skipped++;
}

/** frames drawn per view (the suites and the perf gate read it) @type {Record<string, number>} */
const drawn = {};

/**
 * A PiP window offers its canvas. Returns `off`.
 * @param {string} id @param {PipView} view @returns {() => void}
 */
export function registerPipView(id, view) {
	views.set(id, view);
	return () => {
		if (views.get(id) === view) views.delete(id);
	};
}

/** @param {HTMLCanvasElement} canvas */
function laidOut(canvas) {
	return canvas.isConnected && canvas.clientWidth > 1 && canvas.clientHeight > 1;
}

/** is any PiP visible right now? (cheap — the render loop asks every frame) */
export function anyPipVisible() {
	for (const v of views.values()) if (laidOut(v.canvas)) return true;
	return false;
}

/**
 * Draw every visible view (called by Outline, before the main frame, never in XR).
 * @param {any} renderer a THREE.WebGLRenderer @param {any} scene
 */
export function renderPipViews(renderer, scene) {
	if (!views.size) return;
	const gl = renderer.domElement;
	const pr = renderer.getPixelRatio();
	const bufW = gl.width;
	const bufH = gl.height;
	if (!bufW || !bufH) return;
	const size = renderer.getSize({ x: 0, y: 0, set(/** @type {number} */ x, /** @type {number} */ y) { this.x = x; this.y = y; return this; } });
	const shadowAuto = renderer.shadowMap.autoUpdate;
	let shadowsDone = false;
	for (const [id, view] of views) {
		const canvas = view.canvas;
		if (!laidOut(canvas)) continue;
		const cssW = canvas.clientWidth;
		const cssH = canvas.clientHeight;
		const scale = view.scale ?? PIP_SCALE;
		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		// the pixel size of the picture, never bigger than the drawing buffer it is drawn in
		const pxW = Math.max(1, Math.min(bufW, Math.round(cssW * dpr * scale)));
		const pxH = Math.max(1, Math.min(bufH, Math.round(cssH * dpr * scale)));
		const camera = view.camera(cssW / cssH);
		if (!camera) continue;
		const ctx = canvas.getContext('2d');
		if (!ctx) continue;
		if (canvas.width !== pxW) canvas.width = pxW;
		if (canvas.height !== pxH) canvas.height = pxH;
		view.before?.();
		try {
			// the shadow maps of this frame are the main frame's: a PiP reuses them, it does not
			// re-render every caster for a 300-px picture — unless the main frame is skipped
			// (covered), when the FIRST view drawn keeps them current
			renderer.shadowMap.autoUpdate = shadowAuto && mainCovered && !shadowsDone;
			shadowsDone = true;
			renderer.setScissorTest(true);
			renderer.setScissor(0, 0, pxW / pr, pxH / pr);
			renderer.setViewport(0, 0, pxW / pr, pxH / pr);
			renderer.render(scene, camera);
			// gl's (0, 0) is the BOTTOM-left of the drawing buffer; drawImage counts from the top
			ctx.drawImage(gl, 0, bufH - pxH, pxW, pxH, 0, 0, pxW, pxH);
			drawn[id] = (drawn[id] || 0) + 1;
		} finally {
			renderer.shadowMap.autoUpdate = shadowAuto;
			renderer.setScissorTest(false);
			renderer.setViewport(0, 0, size.x, size.y);
			view.after?.();
		}
	}
}

/** test/debug view: which views are registered, visible, how many frames each drew, and whether the
 *  main frame is being skipped */
export function pipViewsDebug() {
	/** @type {Record<string, {visible: boolean, w: number, h: number, frames: number}>} */
	const out = {};
	for (const [id, v] of views)
		out[id] = { visible: laidOut(v.canvas), w: v.canvas.width, h: v.canvas.height, frames: drawn[id] || 0 };
	return { views: out, mainCovered, mainSkipped: skipped };
}
