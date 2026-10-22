// 49-fluid W2: the GPU fluid switch's pure rules — what Auto picks from a calibration, and the
// setting's normalisation. (The solver itself needs a GPU: e2e fluid-gpu covers it.)
import { describe, it, expect } from 'vitest';
import { pickSolver, normalizeGpuFluidPref, FASTER_SHARE, solverChoice, gpuFluidDebug } from '../../src/lib/sim/fluidGpuHost.js';

describe('pickSolver', () => {
	it('takes the GPU only when it is clearly faster', () => {
		expect(pickSolver({ gpuMs: 2.9, cpuMs: 35 })).toBe('gpu');
		expect(pickSolver({ gpuMs: 35 * FASTER_SHARE, cpuMs: 35 })).toBe('gpu');
		expect(pickSolver({ gpuMs: 35 * FASTER_SHARE + 0.01, cpuMs: 35 })).toBe('cpu');
		expect(pickSolver({ gpuMs: 40, cpuMs: 25 })).toBe('cpu');
	});
	it('a failed or missing measurement is the CPU', () => {
		expect(pickSolver({ gpuMs: null, cpuMs: 25 })).toBe('cpu');
		expect(pickSolver({ gpuMs: NaN, cpuMs: 25 })).toBe('cpu');
		expect(pickSolver({ gpuMs: 0, cpuMs: 25 })).toBe('cpu');
		expect(pickSolver(/** @type {any} */ (null))).toBe('cpu');
	});
});

describe('the setting', () => {
	it('is Auto unless it says Off', () => {
		expect(normalizeGpuFluidPref('off')).toBe('off');
		expect(normalizeGpuFluidPref('auto')).toBe('auto');
		expect(normalizeGpuFluidPref('on')).toBe('auto');
		expect(normalizeGpuFluidPref(null)).toBe('auto');
	});
	it('without WebGPU a tank runs on the CPU at once (no measuring)', () => {
		expect(gpuFluidDebug().webgpu).toBe(false);
		expect(solverChoice()).toBe('cpu');
		expect(gpuFluidDebug().verdict.state).toBe('unavailable');
	});
});
