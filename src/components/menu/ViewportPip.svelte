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
	import { globalCamera, orbitControls } from '../../stores/sceneStore';
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
		return () => {
			off();
			ctl.dispose();
			if (controls === ctl) controls = null;
			viewportPipView.set(null);
		};
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
