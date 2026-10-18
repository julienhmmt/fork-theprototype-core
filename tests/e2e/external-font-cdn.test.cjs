// 48 G1 (R40) — the phone "Failed to fetch" page errors of the deployed-build proofs were troika-three-text's
// runtime font lookup: every in-scene label (avatar name tag, VR panels, pins) names no font, so troika fetches
// glyph data from cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver, and a failed fetch is an uncaught page error.
//   1. with that CDN aborted, the character card (proof F2's Customize character) raises exactly that error —
//      and the harness files it as EXTERNAL (h.externalErrors), not as an app error (h.pageErrors)
//   2. with the CDN open the same page fetches the font data and raises nothing
//   3. counterfactual: a real uncaught error in the same page is still an app error
// Product follow-up (not a test matter): self-host the font data (troika unicodeFontsURL) so labels survive a
// blocked or offline CDN.
// Run: APP_URL=https://localhost:5486/ node tests/e2e/external-font-cdn.test.cjs
const h = require('./helpers.cjs');

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.9 };

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	for (const blocked of [true, false]) {
		const P = await h.setupPage(browser, blocked ? 'blocked' : 'open', { context: PHONE });
		const asked = [];
		P.page.on('request', (r) => /unicode-font-resolver/.test(r.url()) && asked.push(r.url()));
		if (blocked) await P.ctx.route(/unicode-font-resolver/, (r) => r.abort('failed'));
		await P.page.evaluate(() => window.__stores.characterModalOpen.set(true));
		await h.eventually(() => Promise.resolve(asked.length), (n) => n > 0, `${blocked ? 'blocked' : 'open'}: the character card asks the font CDN for glyph data`, 15000);
		await P.page.waitForTimeout(3000);
		if (blocked) {
			h.check(h.externalErrors(P).length > 0, `the failed font fetch is filed as external (${h.externalErrors(P).length}: ${h.externalErrors(P)[0]})`);
			h.check(h.pageErrors(P).length === 0, `…and is NOT an app error (${h.pageErrors(P).join(' | ')})`);
			// 3. the classifier is narrow: a genuine uncaught error is still the app's
			await P.page.evaluate(() => setTimeout(() => { throw new TypeError('Failed to fetch (an app fetch, not the font CDN)'); }, 0));
			await P.page.waitForTimeout(300);
			h.check(h.pageErrors(P).some((e) => /an app fetch/.test(e)), 'counterfactual: an uncaught error of the app itself is still a page error');
		} else {
			h.check(h.externalErrors(P).length === 0 && h.pageErrors(P).length === 0, `with the CDN reachable nothing is raised (${asked.length} font requests)`);
		}
		await P.ctx.close();
	}
	await h.finish(browser);
});
