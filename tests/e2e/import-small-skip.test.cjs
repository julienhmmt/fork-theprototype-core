// 48 F4 — A SMALL MODEL SKIPS THE IMPORT OPTIMIZER. 46 P2's auto-optimize loaded its module (importOptimize.js, which
// pulls the glTF engine and its worker) and SHA-hashed the whole file on EVERY import — even a model far under both
// thresholds, which it then placed untouched. fileHandler now measures first (the parse is already in hand): under
// 50k triangles and 2048 px textures nothing can optimize it except an asset override saying `always`, so it is
// placed as parsed — no optimizer chunk on the wire, no hash.
//
// What is asserted, on a page WITHOUT the debug hook (the hook imports every module at boot, the optimizer
// included, so only a plain session can show what an import fetches):
//  1. premise: the boot fetched no optimizer module
//  2. a 1k-triangle model dropped on the viewport is placed (the object list lists it)…
//  3. …and the network log holds no importOptimize / gltfOptimize engine / worker request, and nothing hashed the file
//  4. control: a 61k-triangle model (over the threshold) DOES load the optimizer — the gate is not just closed
//
// Counterfactual (base v1.38.0): 3 is red (importOptimize.js is fetched and the file's bytes are digested).
const h = require('./helpers.cjs');

const URL = process.env.APP_URL || h.URL;
const EVIDENCE = process.env.EVIDENCE || null;

/** an OBJ grid of n×n quads (2n² triangles) @param {number} n @param {string} name */
function gridObj(n, name) {
	const lines = ['o ' + name];
	for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) lines.push(`v ${(x / n - 0.5).toFixed(4)} 0 ${(z / n - 0.5).toFixed(4)}`);
	const at = (x, z) => z * (n + 1) + x + 1;
	for (let z = 0; z < n; z++)
		for (let x = 0; x < n; x++) {
			lines.push(`f ${at(x, z)} ${at(x + 1, z)} ${at(x + 1, z + 1)}`);
			lines.push(`f ${at(x, z)} ${at(x + 1, z + 1)} ${at(x, z + 1)}`);
		}
	return lines.join('\n') + '\n';
}
// the optimizer = importOptimize + the engine (gltfOptimize.js, its core and worker); gltfOptimize/glbPost.js is the
// small KTX2-twin reader fileHandler has always loaded at boot (ktx2Twins), not part of it
const OPTIMIZER = /\/(importOptimize\.js|gltfOptimize\.js|gltfOptimize\/(core|optimizeWorker)\.js)|importOptimize-[\w-]+\.js|gltfOptimize-[\w-]+\.js|optimizeWorker-[\w-]+\.js/;

h.run(async () => {
	const browser = await h.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
	await ctx.addInitScript(() => {
		localStorage.setItem('hasSeenDisclaimer', 'true');
		localStorage.setItem('hasSeenWelcome', 'true');
		localStorage.setItem('toursSeen', '{"editor":true,"editor-touch":true}');
		// what the app hashes: every SHA digest's input size, from the first frame
		window.__digests = [];
		const orig = crypto.subtle.digest.bind(crypto.subtle);
		crypto.subtle.digest = (alg, data) => {
			window.__digests.push(data?.byteLength ?? -1);
			return orig(alg, data);
		};
	});
	const page = await ctx.newPage();
	const requests = [];
	page.on('request', (r) => requests.push(r.url()));
	page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
	await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
	await page.locator('#controls-pill').waitFor({ timeout: 90000 });
	await page.waitForTimeout(5000);
	await page.locator('#restore-session-dismiss').click({ timeout: 3000 }).catch(() => {});
	h.check(!(await page.evaluate(() => !!window.__stores)), 'premise: this is a plain session (no debug hook)');
	const boot = requests.filter((u) => OPTIMIZER.test(u));
	h.check(boot.length === 0, `premise: the boot fetched no optimizer module (${boot.join(', ') || 'none'})`);

	/** drop a model file on the viewport the way a person does (App.svelte's window drop) */
	const drop = (name, text) =>
		page.evaluate(
			({ name, text }) => {
				const file = new File([text], name, { type: 'text/plain' });
				const dt = new DataTransfer();
				dt.items.add(file);
				const canvas = document.querySelector('canvas');
				const r = canvas.getBoundingClientRect();
				canvas.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
				return file.size;
			},
			{ name, text }
		);
	const listed = async (name) => {
		if (!(await page.locator('#object-list').isVisible().catch(() => false))) {
			await page.locator('canvas').first().click({ position: { x: 640, y: 300 } }).catch(() => {});
			await page.keyboard.press('o');
			await page.waitForTimeout(600);
		}
		return page.evaluate((n) => [...document.querySelectorAll('#object-list .obj-row')].some((r) => r.textContent.includes(n)), name);
	};

	// ---------- 2 + 3. a 1k-triangle model ----------
	const small = gridObj(23, 'SmallGrid'); // 1058 triangles
	const before = requests.length;
	await page.evaluate(() => (window.__digests.length = 0));
	const size = await drop('SmallGrid.obj', small);
	await h.eventually(() => listed('SmallGrid'), (v) => v, 'F4: a 1k-triangle model dropped on the viewport is placed (the object list lists it)', 20000);
	await page.waitForTimeout(1500);
	const after = requests.slice(before).filter((u) => OPTIMIZER.test(u));
	h.check(after.length === 0, `F4: …without fetching the optimizer (network log: ${after.join(', ') || 'no optimizer request'})`);
	const digests = await page.evaluate(() => window.__digests.slice());
	h.check(!digests.includes(size), `F4: …and without hashing the file (${size} bytes; digests seen: ${JSON.stringify(digests)})`);
	if (EVIDENCE) await page.screenshot({ path: EVIDENCE + '/01-small-placed.png' }).catch(() => {});

	// ---------- 4. control: over the threshold the optimizer is loaded ----------
	const big = gridObj(175, 'BigGrid'); // 61250 triangles
	const before2 = requests.length;
	await drop('BigGrid.obj', big);
	await h.eventually(() => Promise.resolve(requests.slice(before2).filter((u) => OPTIMIZER.test(u))), (v) => v.length > 0, 'F4 control: a 61k-triangle model (over the 50k threshold) does load the optimizer', 30000);

	await browser.close();
});
