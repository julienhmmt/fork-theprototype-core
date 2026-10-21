<script module>
	// I4 settings search: the labels + keywords this section answers to
	export const keywords = ['gpu', 'webgpu', 'fluid', 'tank', 'water', 'particles', 'simulation', 'compute', 'performance'];
	import { registerSettingsKeywords } from '$lib/settingsSearch';
	registerSettingsKeywords('gpu fluid', ['webgpu', 'fluid tank', 'compute', 'particles']);
</script>

<script>
	// 49-fluid W2 — Settings ▸ Scene ▸ Performance: "GPU fluid" (Auto / Off). LOCAL (this device),
	// persisted by fluidGpuHost.js. Auto runs fluid tanks on the WebGPU solver only where WebGPU
	// exists AND this device's own measurement says it is clearly faster; the row says what Auto
	// chose and why. Its own file so the settings index stays a one-line union.
	import SettingRow from '../ui/SettingRow.svelte';
	import Segmented from '../ui/Segmented.svelte';
	import Button from '../ui/Button.svelte';
	import { gpuFluidPref, gpuFluidVerdict, remeasureGpuFluid, normalizeGpuFluidPref } from '$lib/sim/fluidGpuHost.js';

	const MODES = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'off', label: 'Off' }
	];
	const ms = (/** @type {any} */ v) => (typeof v === 'number' ? (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ms' : '—');
	const status = $derived.by(() => {
		const v = $gpuFluidVerdict;
		const timing = `the GPU steps 8000 particles in ${ms(v.gpuMs)}, the CPU in ${ms(v.cpuMs)}`;
		switch (v.state) {
			case 'off':
				return 'Off: fluid tanks run on the CPU.';
			case 'gpu':
				return `On here: ${timing}.`;
			case 'cpu':
				return v.gpuMs == null ? `Auto chose the CPU here (${v.reason || 'the GPU could not run it'}).` : `Auto chose the CPU here: ${timing}.`;
			case 'unavailable':
				return 'This browser has no WebGPU, so fluid tanks run on the CPU.';
			case 'failed':
				return `The GPU solver stopped (${v.reason}); fluid tanks went back to the CPU.`;
			case 'measuring':
				return 'Measuring this device…';
			default:
				return 'Auto measures this device the first time a fluid tank runs.';
		}
	});
</script>

<!-- the I4 search reads a section's keywords from its root element -->
<div class="contents" data-keywords={keywords.join(' ')}>
	<SettingRow id="row-gpu-fluid" label="GPU fluid" description={'Runs fluid tanks on the graphics card where that is faster. ' + status} wide>
		<Segmented id="gpu-fluid" label="GPU fluid" options={MODES} value={$gpuFluidPref} onchange={(v) => gpuFluidPref.set(normalizeGpuFluidPref(v))} />
		<Button id="gpu-fluid-remeasure" variant="ghost" size="sm" disabled={$gpuFluidPref === 'off' || $gpuFluidVerdict.state === 'measuring'} onclick={remeasureGpuFluid}>Measure again</Button>
	</SettingRow>
</div>

<style>
	.contents {
		display: contents;
	}
</style>
