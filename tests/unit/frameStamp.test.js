import { describe, it, expect, vi, afterEach } from 'vitest';
import { startSceneMetrics, stopSceneMetrics } from '../../src/lib/sceneBudget.js';
import { registerMeterFrame } from '../../src/lib/fpsMeter.js';
import { framesIn } from '../../src/lib/perf/profilerModel.js';

// 44 L1: a profiler selection counted a NEIGHBOUR frame. sceneBudget times a frame from the
// rAF timestamp (36-fb-water F27) while fpsMeter stamped it with performance.now() at
// callback time, so with callback jitter a frame's span (t - ms, t] reached back into the
// previous frame's and framesIn picked it up. Here the rAF timestamps are a steady 60 Hz and
// each callback runs 0-14 ms late (a loaded box), which is exactly that shape.
describe('desktop frames are stamped with the rAF timestamp', () => {
	/** @type {((ts: number) => void)[]} */
	let queued = [];
	afterEach(() => {
		stopSceneMetrics();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('each frame starts where the previous one ended, whatever the callback jitter', () => {
		queued = [];
		vi.stubGlobal('requestAnimationFrame', (/** @type {(ts: number) => void} */ cb) => queued.push(cb));
		vi.stubGlobal('cancelAnimationFrame', () => {});
		let clock = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => clock);
		/** @type {{t: number, ms: number}[]} */
		const frames = [];
		const off = registerMeterFrame((ms, _from, now) => frames.push({ t: now, ms }));
		startSceneMetrics();
		const jitter = [0, 13.5, 0.2, 9, 0, 4.4, 12, 0.1, 7, 0, 11, 3];
		for (let i = 1; i <= jitter.length; i++) {
			const ts = 1000 + i * (1000 / 60);
			clock = ts + jitter[i - 1]; // the callback runs late; the rAF timestamp does not move
			const cb = queued.shift();
			cb?.(ts);
		}
		off();
		expect(frames.length).toBe(jitter.length - 1);
		for (let i = 1; i < frames.length; i++) expect(frames[i].t - frames[i].ms).toBeCloseTo(frames[i - 1].t, 6);
		// what the profiler does with them: a selection over frames 3..6 (a click on 3, Shift+→ x3)
		// is FOUR frames, not five
		const rec = frames.map((f) => ({ t: Math.round(f.t * 10) / 10, ms: Math.round(f.ms * 10) / 10 }));
		const from = rec[3].t - rec[3].ms;
		expect(framesIn(/** @type {any} */ (rec), from, rec[6].t).length).toBe(4);
		// and a click inside one frame is ONE frame
		expect(framesIn(/** @type {any} */ (rec), rec[5].t - 2, rec[5].t - 2).length).toBe(1);
	});
});
