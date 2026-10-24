// test-health-1 (plans review #24, roadmap-42 Follow-ups): RELOADING ONE TAB MUST NOT GROW IT.
//
// The report: editor-ui-33 died on its 5th reload in one tab (WebGL context lost / Target crashed)
// and the heap grew ~29 MB per reload. A reload replaces the document, so anything that grows
// ACROSS reloads is something the old document left behind: the old document itself (a reference
// from something that outlives it), or GPU memory the old page's WebGL contexts still held.
//
// Per reload, after a forced GC: the JS heap, the number of live Documents (1 = only the current
// one; more = an old document is retained), and the resident memory of this browser's renderer and
// GPU processes (ps, so it sees what Chromium's own heap metrics do not: WebGL buffers live in the
// GPU process). Evidence: EVIDENCE/reload-memory.json.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const h = require('./helpers.cjs');

const RELOADS = Number(process.env.RELOADS || 6);
const SETTLE_MS = Number(process.env.RELOAD_SETTLE_MS || 4000);
const EVIDENCE = process.env.EVIDENCE || path.join(process.env.HOME || '.', '.code/lanes-30/after-60/60-test-health-1');
// thresholds: the growth that killed a tab was ~29 MB/reload of JS heap; a steady state after the
// first reload (caches warm) should be flat within noise
const MAX_HEAP_MB_PER_RELOAD = Number(process.env.MAX_HEAP_MB_PER_RELOAD || 5);
const MAX_GPU_MB_PER_RELOAD = Number(process.env.MAX_GPU_MB_PER_RELOAD || 25);

/** RSS (MB) of the renderer + gpu processes under this browser @param {number} rootPid */
function processRss(rootPid) {
	const rows = execSync('ps -eo pid=,ppid=,rss=,args=', { encoding: 'utf8', maxBuffer: 64 << 20 })
		.split('\n')
		.map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
		.filter((m) => m !== null)
		.map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] }));
	const mine = new Set([rootPid]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const r of rows) if (mine.has(r.ppid) && !mine.has(r.pid)) mine.add(r.pid), (grew = true);
	}
	const sum = (/** @type {RegExp} */ re) => Math.round(rows.filter((r) => mine.has(r.pid) && re.test(r.args)).reduce((t, r) => t + r.rss, 0) / 1024);
	return { renderer: sum(/--type=renderer/), gpu: sum(/--type=gpu-process/) };
}

h.run(async () => {
	const browser = await h.launch();
	const rootPid = browser.process?.()?.pid ?? 0;
	const A = await h.setupPage(browser, 'A');
	const cdp = await A.page.context().newCDPSession(A.page);
	await cdp.send('Performance.enable');
	await cdp.send('HeapProfiler.enable');
	const sample = async (/** @type {number} */ i) => {
		await A.page.waitForTimeout(SETTLE_MS);
		await cdp.send('HeapProfiler.collectGarbage');
		await cdp.send('HeapProfiler.collectGarbage');
		const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((/** @type {any} */ x) => [x.name, x.value]));
		const gl = await A.page.evaluate(() => {
			/** @type {any} */ let r;
			window.__stores.renderer?.subscribe?.((/** @type {any} */ v) => (r = v))?.();
			return r?.info?.memory ?? null;
		}).catch(() => null);
		return {
			reload: i,
			heapMB: Math.round((m.JSHeapUsedSize / 1048576) * 10) / 10,
			documents: m.Documents,
			frames: m.Frames,
			nodes: m.Nodes,
			listeners: m.JSEventListeners,
			gl,
			...(rootPid ? processRss(rootPid) : {})
		};
	};
	/** @type {any[]} */
	const rows = [await sample(0)];
	console.log(JSON.stringify(rows[0]));
	let crashed = '';
	for (let i = 1; i <= RELOADS; i++) {
		try {
			await h.freshReload(A);
			await h.answerRestore(A).catch(() => false);
		} catch (error) {
			crashed = `reload ${i}: ${String(/** @type {any} */ (error)?.message ?? error).split('\n')[0]}`;
			break;
		}
		rows.push(await sample(i));
		console.log(JSON.stringify(rows[rows.length - 1]));
	}
	fs.mkdirSync(EVIDENCE, { recursive: true });
	fs.writeFileSync(path.join(EVIDENCE, 'reload-memory.json'), JSON.stringify({ at: new Date().toISOString(), url: h.URL, rows, crashed }, null, 1));

	h.check(!crashed, `the tab survives ${RELOADS} reloads (${crashed || 'all of them'})`);
	// growth from the FIRST reload on: reload 0 -> 1 warms caches every app has
	const from = rows[1] ?? rows[0];
	const last = rows[rows.length - 1];
	const n = Math.max(1, last.reload - from.reload);
	const heapPer = (last.heapMB - from.heapMB) / n;
	h.check(heapPer <= MAX_HEAP_MB_PER_RELOAD, `JS heap after GC grows <= ${MAX_HEAP_MB_PER_RELOAD} MB per reload (${heapPer.toFixed(1)} MB/reload: ${rows.map((r) => r.heapMB).join(' → ')})`);
	h.check(rows.slice(1).every((r) => r.documents <= 2), `no old document is retained (live Documents per reload: ${rows.map((r) => r.documents).join(', ')})`);
	if (last.gpu != null && from.gpu != null) {
		const gpuPer = (last.gpu - from.gpu) / n;
		h.check(gpuPer <= MAX_GPU_MB_PER_RELOAD, `GPU process RSS grows <= ${MAX_GPU_MB_PER_RELOAD} MB per reload (${gpuPer.toFixed(1)} MB/reload: ${rows.map((r) => r.gpu).join(' → ')})`);
	}
	await h.finish(browser);
});
