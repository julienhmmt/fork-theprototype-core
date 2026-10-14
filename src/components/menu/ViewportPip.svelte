<script>
	// 43 K5 — the 3D view as a PICTURE-IN-PICTURE while a docked window is maximized to the whole
	// window (the user: "if I open full screen, then it shows viewport as picture in picture and I can
	// close it if I want same as camera viewport preview … resizable … on top of any docked window").
	// The frame is the shared PipFrame (the camera preview's too); the picture is drawn by the shared PiP
	// renderer ($lib/pipViews) through this window's OWN camera, which starts where the editor camera
	// is and then moves on its own — orbit / pan / zoom in the PiP never move the editor's view, and the
	// editor's view comes back unchanged on exit. Rendered outside #editor-chrome (focus mode hides that).
	//
	// It shows only while the dock covers the WHOLE window: resize the maximized dock down and the real
	// viewport is back on screen, so the PiP steps aside (it would be a second copy of what you see).
	import { onDestroy, untrack } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import { focusMode, fullDockHeight } from '$lib/focusMode';
	import { dockHeight } from '$lib/bottomDock';
	import { globalCamera, orbitControls, TControls } from '../../stores/sceneStore';
	import { selectObject, deselectObject, topLevelObjectOf } from '$lib/objectActions';
	import { sceneHits } from '$lib/scenePick';
	import { pickStack, primaryIndex } from '$lib/selectThrough';
	import { editorPass } from '$lib/pickPass';
	import { HELPER_LAYER } from '$lib/helperLayer';
	import { phoneShell } from '$lib/ui/phoneShell.js';
	import { registerPipView, setMainViewCovered } from '$lib/pipViews';
	import {
		viewportPipSize,
		viewportPipPosition,
		viewportPipClosed,
		viewportPipView,
		resetViewportPipSize,
		resetViewportPipSession,
		VIEWPORT_PIP_MIN_H
	} from '$lib/viewportPip';
	import PipFrame from './PipFrame.svelte';

	const MARGIN = 16;
	let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 800);

	// the dock fills the window (a 4-px slack for rounding); `vh` is read so a window resize re-decides
	const full = $derived($focusMode === 'dock' && (void vh, $dockHeight >= fullDockHeight() - 4));
	const shown = $derived(full && !$viewportPipClosed && !$phoneShell);

	// the dock covers the whole 3D view: the render loop stops drawing the main frame (pipViews)
	$effect(() => {
		setMainViewCovered(full && !$phoneShell);
		return () => setMainViewCovered(false);
	});

	// a new focus session parks it bottom-right and shows it again
	let lastFocus = /** @type {string|null} */ (null);
	$effect(() => {
		const f = $focusMode;
		if (f !== lastFocus && (f === null || lastFocus === null)) resetViewportPipSession();
		lastFocus = f;
	});

	/** never bigger than the window, never smaller than the minimum */
	const size = $derived({
		w: Math.min(Math.max(VIEWPORT_PIP_MIN_H, $viewportPipSize.w), vw - 2 * MARGIN),
		h: Math.min(Math.max(VIEWPORT_PIP_MIN_H, $viewportPipSize.h), vh - 2 * MARGIN - 24)
	});
	/** @param {{x: number, y: number}} p @param {{w: number, h: number}} s */
	const clamp = (p, s) => ({
		x: Math.min(Math.max(0, p.x), Math.max(0, vw - s.w)),
		// never over the maximized dock's tab strip (24 px) — its tabs stay reachable
		y: Math.min(Math.max(24, p.y), Math.max(24, vh - s.h))
	});
	const position = $derived(
		$viewportPipPosition ? clamp($viewportPipPosition, size) : { x: vw - size.w - MARGIN, y: vh - size.h - MARGIN }
	);

	/** @param {{x: number, y: number, w: number, h: number}} r @param {'move'|'resize'} kind */
	function onrect(r, kind) {
		if (kind === 'resize') {
			const s = { w: Math.min(r.w, vw - 2 * MARGIN), h: Math.min(r.h, vh - 2 * MARGIN - 24) };
			viewportPipSize.set(s);
			viewportPipPosition.set(clamp({ x: r.x + r.w - s.w, y: r.y + r.h - s.h }, s));
			return;
		}
		viewportPipPosition.set(clamp({ x: r.x, y: r.y }, size));
	}

	/** @type {HTMLCanvasElement | null} */
	let canvas = $state(null);
	/** @type {any} */
	let camera = null;
	/** @type {any} */
	let controls = null;

	/** the editor camera's pose, lens and orbit target, as the PiP's starting point */
	function seatFromEditor() {
		const main = /** @type {any} */ ($globalCamera);
		if (!camera) camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
		if (main) {
			camera.position.copy(main.position);
			camera.quaternion.copy(main.quaternion);
			if (main.isPerspectiveCamera) {
				camera.fov = main.fov;
				camera.near = main.near;
				camera.far = main.far;
			}
			camera.layers.mask = main.layers.mask;
		}
		camera.updateProjectionMatrix();
	}

	$effect(() => {
		const el = canvas;
		if (!shown || !el) return;
		// only `shown` and the canvas decide this effect: the stores read while seating are untracked
		return untrack(() => mount(el));
	});

	/** @param {HTMLCanvasElement} el @returns {() => void} */
	function mount(el) {
		if (!camera) seatFromEditor();
		controls = new OrbitControls(camera, el);
		controls.enableDamping = true;
		controls.dampingFactor = 0.12;
		const target = /** @type {any} */ ($orbitControls)?.target;
		if (target) controls.target.copy(target);
		else camera.getWorldDirection(controls.target).multiplyScalar(5).add(camera.position);
		controls.update();
		viewportPipView.set({ camera, controls });
		const off = registerPipView('viewport', {
			canvas: el,
			camera: (aspect) => {
				const main = /** @type {any} */ ($globalCamera);
				if (main) camera.layers.mask = main.layers.mask;
				if (camera.aspect !== aspect) {
					camera.aspect = aspect;
					camera.updateProjectionMatrix();
				}
				controls?.update();
				return camera;
			}
		});
		const ctl = controls;
		const unhook = hookInput(el);
		return () => {
			unhook();
			off();
			ctl.dispose();
			if (controls === ctl) controls = null;
			viewportPipView.set(null);
		};
	}

	/**
	 * The PiP is a second VIEWPORT, not a picture of one: a click selects there, and the transform
	 * gizmo works there. There is ONE TransformControls in the app and every gizmo rule hangs on that
	 * instance (Scene.svelte: the undo entry per drag, the move broadcast, snapping, the multi-select
	 * pivot, the edit proxies), so instead of a second gizmo the one gizmo is HANDED the PiP's camera
	 * and canvas while the PiP is up — the main view is covered then (that is when the PiP shows), so
	 * nothing else is aiming at it — and handed back on the way out.
	 * @param {HTMLCanvasElement} el @returns {() => void}
	 */
	function hookInput(el) {
		const tc = /** @type {any} */ ($TControls);
		/** @type {{camera: any, dom: any} | null} */
		let handed = null;
		if (tc) {
			handed = { camera: tc.camera, dom: tc.domElement };
			tc.disconnect();
			tc.camera = camera;
			tc.connect(el);
		}
		/** @param {PointerEvent} e */
		const ndc = (e) => {
			const r = el.getBoundingClientRect();
			return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, button: e.button };
		};
		// a press on a gizmo handle is the GIZMO's: the orbit stands down before OrbitControls sees the
		// press (capture on the frame runs first). Hover is re-asked here, because a finger has none.
		/** @param {PointerEvent} e */
		const onCapture = (e) => {
			if (e.target !== el || !tc?.object || !controls) return;
			try {
				tc.pointerHover?.(ndc(e));
			} catch {
				/* a gizmo with nothing to hover */
			}
			if (tc.axis) controls.enabled = false;
		};
		/** @param {{value: boolean}} e */
		const onDragging = (e) => {
			if (controls) controls.enabled = !e.value;
		};
		const onRelease = () => {
			if (controls && !tc?.dragging) controls.enabled = true;
		};
		// a CLICK (a press that does not travel, not on the gizmo) selects what is under it
		/** @type {{x: number, y: number, gizmo: boolean} | null} */
		let down = null;
		/** @param {PointerEvent} e */
		const onDown = (e) => {
			down = e.button === 0 && e.target === el ? { x: e.clientX, y: e.clientY, gizmo: !!tc?.axis } : null;
		};
		/** @param {PointerEvent} e */
		const onUp = (e) => {
			const d = down;
			down = null;
			if (!d || e.button !== 0 || d.gizmo || tc?.dragging) return;
			if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
			pickAt(ndc(e), e.shiftKey || e.ctrlKey || e.metaKey);
		};
		const frame = el.parentElement;
		frame?.addEventListener('pointerdown', onCapture, true);
		tc?.addEventListener('dragging-changed', onDragging);
		el.addEventListener('pointerdown', onDown);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointerup', onRelease, true);
		return () => {
			frame?.removeEventListener('pointerdown', onCapture, true);
			tc?.removeEventListener('dragging-changed', onDragging);
			el.removeEventListener('pointerdown', onDown);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointerup', onRelease, true);
			if (tc && handed) {
				tc.disconnect();
				tc.camera = handed.camera;
				if (handed.dom) tc.connect(handed.dom);
			}
		};
	}

	const raycaster = new THREE.Raycaster();
	raycaster.layers.enable(HELPER_LAYER);
	/** the editor's pick, through the PiP's camera: the one scene pick + select-through, then select
	 * @param {{x: number, y: number}} at NDC @param {boolean} additive */
	function pickAt(at, additive) {
		if (!camera) return;
		raycaster.setFromCamera(new THREE.Vector2(at.x, at.y), camera);
		const stack = pickStack(sceneHits(raycaster, { tinyProxies: true }), topLevelObjectOf, editorPass());
		const chosen = stack.length ? stack[primaryIndex(stack)] : null;
		if (chosen?.target) selectObject(chosen.target.uuid, false, additive);
		else if (!additive) deselectObject();
	}

	// leaving focus mode forgets the PiP camera: the next maximize starts from the editor's view
	$effect(() => {
		if ($focusMode === null) camera = null;
	});
	onDestroy(() => viewportPipView.set(null));
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#if shown}
	<PipFrame
		id="viewport-pip"
		title="Viewport"
		rect={{ x: position.x, y: position.y, w: size.w, h: size.h }}
		{onrect}
		onreset={resetViewportPipSize}
		minH={VIEWPORT_PIP_MIN_H}
		z="calc(var(--z-dock) + 2)"
		interactive
		data-key-scope="pip"
		closeTitle="Close the viewport picture-in-picture (it comes back the next time you maximize)"
		onclose={() => viewportPipClosed.set(true)}
		bind:canvas
	>
		{#snippet buttons()}
			<button
				class="pip-btn"
				title="Match the editor camera"
				aria-label="Match the editor camera"
				onclick={() => {
					seatFromEditor();
					const target = /** @type {any} */ ($orbitControls)?.target;
					if (target && controls) controls.target.copy(target);
					controls?.update();
				}}>⌖</button
			>
		{/snippet}
	</PipFrame>
{/if}
