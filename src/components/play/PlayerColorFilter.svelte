<script>
	// 53 (A6) — THE COLOUR-BLIND FILTER on a flat screen. One CORRECTION matrix (daltonize,
	// playerAccessCore.colorFilterMatrix) as an SVG feColorMatrix, applied as a CSS filter to the
	// 3D canvas and the game HUD while the player plays with a filter picked on the game menu's
	// Accessibility page. No extra GL pass: the browser's compositor applies a colour matrix to
	// the finished frame. The pause menu, captions and toasts stay unfiltered (they are app
	// chrome in the theme's own safe colours). A headset has no compositor step to hook — the
	// row says "flat screens" there. LOCAL; nothing replicates.
	import { accessValues } from '$lib/playerAccess';
	import { colorFilterMatrix, feColorMatrixValues } from '$lib/playerAccessCore';
	import { isLocked, isVRMode, editorMode } from '../../stores/sceneStore';
	import { embedMode } from '$lib/playMode';

	const playing = $derived($isLocked === true || $editorMode === 'interact' || $embedMode);
	const kind = $derived(String($accessValues.colorFilter ?? 'none'));
	const matrix = $derived(colorFilterMatrix(kind));
	const on = $derived(!!matrix && playing && !$isVRMode);

	$effect(() => {
		const root = document.documentElement;
		if (on) root.setAttribute('data-player-filter', kind);
		else root.removeAttribute('data-player-filter');
		return () => root.removeAttribute('data-player-filter');
	});
</script>

{#if matrix}
	<svg class="player-filter-defs" aria-hidden="true" focusable="false" width="0" height="0">
		<filter id="tp-player-cb-filter" color-interpolation-filters="sRGB">
			<feColorMatrix type="matrix" values={feColorMatrixValues(matrix)} />
		</filter>
	</svg>
{/if}

<style>
	.player-filter-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
		pointer-events: none;
	}
	:global(html[data-player-filter] .viewport canvas),
	:global(html[data-player-filter] #hud-layer) {
		filter: url(#tp-player-cb-filter);
	}
</style>
