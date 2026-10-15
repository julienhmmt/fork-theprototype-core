// 44 M4 / M11 / M12 / M13 / M14 — the user's preview-1-34 review of the toolbar, the corner clusters and the
// Connect pill (Controls.svelte, Connect.svelte, TouchTools.svelte):
//   M4  toolbar menu ▸ Move toolbar works on TOUCH: the finger drags the bar and the lift places it
//   M11 the Connect pill pinned to the top row + a sidebar open: its bottom corner on that side is square
//   M12 Edit positions: right-click / long press a cluster → Move, Reset position, Flip, Rotate 90° (the bar),
//       Hide cluster / Show all; the unpinned Connect pill's edit outline sits ON the pill (no gap to its "−")
//   M13 the top-left cluster (the row beside the logo) slides with a pinned left sidebar like the logo, and in
//       Edit positions beside any open left sidebar; no room on the top row → the Connect pill goes compact
//   M14 Connect's drawer has "Pin to top row" / "Float" — per shell (pinned on the unfolded phone, floating on
//       desktop), remembered, carried by layouts
// Desktop 1440×900 with a REAL mouse; the OPPO Find N6 UNFOLDED (770×850, DPR 2.9) with REAL touch (CDP) and
// FOLDED (390×896). Counterfactual: on origin/feat/43-int (the 1.34.0 candidate) each row is red.
const h = require('./helpers.cjs');

const SHOTS = process.env.SHOT_DIR || null;
const shot = async (page, name) => {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
};
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('controlsLayout') ?? 'null'));
const centre = async (loc) => {
	const b = await loc.boundingBox();
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const rect = (page, sel) =>
	page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
	}, sel);
const menuOpen = (page) => page.evaluate(() => !!document.querySelector('[role="menu"]'));
const menuRows = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
			.map((el) => ({ label: el.textContent.trim(), checked: el.className.includes('ctx-checked'), disabled: el.getAttribute('aria-disabled') === 'true' || el.className.includes('disabled') }))
			.filter((r) => r.label)
	);
async function closeMenus(page) {
	for (let i = 0; i < 3 && (await menuOpen(page)); i++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
	}
}
async function sidebar(page, { side = 'right', open = true, full = false, w = 320 } = {}) {
	await page.evaluate(({ side, open, full, w }) => {
		const S = window.__stores;
		S.sidebars.inspectorSide.set(side);
		S.inspectorKind.set('scene');
		S.inspectorClose.set(!open);
		S.sidebars.toggleSidebarFull('left', side === 'left' && full);
		S.sidebars.toggleSidebarFull('right', side === 'right' && full);
		S.sidebars.setSidebarWidth(side, w);
	}, { side, open, full, w });
	await page.waitForTimeout(800);
}
/** swap the stored toolbar record in place (no reload: 4-5 reloads in one tab kill headless Chromium) */
async function setBar(page, json) {
	await page.evaluate((v) => {
		if (v == null) localStorage.removeItem('controlsLayout');
		else localStorage.setItem('controlsLayout', v);
		window.__stores.uiLayoutsCore?.runLayoutReloaders();
	}, json);
	await page.waitForTimeout(600);
}
/** a short bar (so it has room to travel on the unfolded phone) */
const SHORT = JSON.stringify({ order: ['move', 'rotate', 'objects', 'explorer'], hidden: [], spacerIndex: 2, seen: ['move', 'rotate', 'scale', 'pivot', 'mode', 'objects', 'flow', 'explorer', 'animation'] });

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);

/** real CDP touch helpers for a page */
async function touchKit(P) {
	const cdp = await P.context().newCDPSession(P);
	const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
	const tap = async (p) => {
		await touch('touchStart', p.x, p.y);
		await P.waitForTimeout(60);
		await touch('touchEnd');
		await P.waitForTimeout(350);
	};
	const hold = async (p, ms = 750) => {
		await touch('touchStart', p.x, p.y);
		await P.waitForTimeout(ms);
		await touch('touchEnd');
		await P.waitForTimeout(350);
	};
	/** a finger drag in `steps` moves, lifted at the end */
	const drag = async (from, to, steps = 12) => {
		await touch('touchStart', from.x, from.y);
		await P.waitForTimeout(80);
		for (let i = 1; i <= steps; i++) {
			await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
			await P.waitForTimeout(30);
		}
		await touch('touchEnd');
		await P.waitForTimeout(400);
	};
	return { touch, tap, hold, drag };
}
/** tap / click a menu row by its label */
async function pickRow(P, label, kit) {
	const row = P.locator('[role="menu"] [role="menuitem"]', { hasText: label }).first();
	if (kit) await kit.tap(await centre(row));
	else await row.click();
	await P.waitForTimeout(350);
}

module.exports = (/** @type {string[]} */ parts) => {
	const want = (/** @type {string} */ key) => parts.includes(key) && (!ONLY.length || ONLY.includes(key));
	h.run(async () => {
		const browser = await h.launch();

		// ═══ M4 — Move toolbar on TOUCH (the N6 unfolded, real CDP touch) + the mouse path unchanged ═══
		if (want('m4')) {
			const A = await h.setupPage(browser, 'm4-unfolded', {
				context: { viewport: { width: 770, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.9 },
				storage: { theme: 'dark', toastsInDrawerOnly: 'true', toursSeen: '{"editor-touch":true,"editor":true}' }
			});
			const P = A.page;
			const T = '[unfolded] ';
			const kit = await touchKit(P);
			await P.locator('#restore-session-dismiss').click({ timeout: 3000 }).catch(() => {});
			await setBar(P, SHORT);
			const track = await P.evaluate(() => window.__toolbarTrack);
			h.check(track?.ok === true && track.max - track.min > 150, T + `premise: the short bar has room to travel (${Math.round(track?.min)}..${Math.round(track?.max)})`);
			const b0 = await rect(P, '#controls-pill');
			// long press a cell → the toolbar menu → Move toolbar
			const openMenu = async () => {
				for (let i = 0; i < 3 && !(await menuOpen(P)); i++) await kit.hold(await centre(P.locator('#controls-pill [title="Explorer"]')));
			};
			await openMenu();
			const rows = await menuRows(P);
			const mv = rows.find((r) => r.label === 'Move toolbar');
			h.check(!!mv && !mv.disabled, T + `M4: a long press offers Move toolbar, enabled (${rows.map((r) => r.label).join(' | ')})`);
			await pickRow(P, 'Move toolbar', kit);
			h.check(await P.locator('#toolbar-move-hint').isVisible(), T + 'M4: armed, the bar says how to place it (hint + Cancel)');
			await shot(P, 'm4-armed-unfolded');
			// a finger drags the bar: down on the bar, slide 170 px left, lift
			const from = { x: b0.cx, y: b0.cy };
			await kit.drag(from, { x: from.x - 170, y: from.y - 6 });
			let b1 = await rect(P, '#controls-pill');
			const moved = b0.cx - b1.cx;
			h.check(moved > 120, T + `M4: the finger dragged the bar left (${Math.round(b0.cx)} → ${Math.round(b1.cx)})`);
			h.check(!(await P.locator('#toolbar-move-hint').count()), T + 'M4: the lift placed it (the armed move ended)');
			const posX = (await stored(P))?.posX;
			h.check(typeof posX === 'number' && posX < 0.4, T + `M4: …and the place is stored (posX ${posX})`);
			await shot(P, 'm4-placed-unfolded');
			// the drag does not ALSO press the cell it lifted on (no panel opened)
			const opened = await P.evaluate(() => { let v; window.__stores.explorerClose.subscribe((x) => (v = x))(); return v === false; });
			h.check(!opened, T + 'M4: the lift did not press the button under the finger');
			// Cancel puts the bar back where it was
			await openMenu();
			await pickRow(P, 'Move toolbar', kit);
			const before = await rect(P, '#controls-pill');
			await kit.tap(await centre(P.locator('#toolbar-move-cancel')));
			const after = await rect(P, '#controls-pill');
			h.check(!(await P.locator('#toolbar-move-hint').count()) && Math.abs(after.cx - before.cx) < 2, T + `M4: Cancel ends the armed move, the bar stays (${Math.round(before.cx)} / ${Math.round(after.cx)})`);
			await P.evaluate(() => window.__stores.explorerClose.set(true));
			h.check(h.pageErrors(A).length === 0, T + `no page errors (${h.pageErrors(A).join(' / ')})`);
			await setBar(P, null);
			await A.ctx.close();

			// the MOUSE path is unchanged: armed, the bar follows the pointer and a click places it
			const D = await h.setupPage(browser, 'm4-desk', { context: { viewport: { width: 1440, height: 900 } }, storage: { theme: 'dark', toastsInDrawerOnly: 'true' } });
			const Q = D.page;
			const TD = '[desktop] ';
			await Q.locator('#restore-session-dismiss').click({ timeout: 3000 }).catch(() => {});
			const d0 = await rect(Q, '#controls-pill');
			await Q.locator('#controls-pill [title="Explorer"]').click({ button: 'right' });
			await Q.waitForTimeout(300);
			const at = await Q.evaluate(() => { const m = document.querySelector('[role="menu"]').getBoundingClientRect(); return { x: m.left, y: m.top }; });
			await Q.getByRole('menuitem', { name: 'Move toolbar', exact: true }).click();
			await Q.waitForTimeout(300);
			h.check(await Q.locator('#toolbar-move-hint').isVisible(), TD + 'M4: armed by mouse, the hint shows too');
			const p0 = await Q.evaluate(() => window.__toolbarTrack);
			await Q.mouse.move(at.x, at.y);
			await Q.mouse.move(at.x - 200, at.y, { steps: 6 });
			await Q.waitForTimeout(200);
			const d1 = await rect(Q, '#controls-pill');
			h.check(d0.cx - d1.cx > 150, TD + `M4: the bar follows the mouse with no button held (${Math.round(d0.cx)} → ${Math.round(d1.cx)}, track ${Math.round(p0.min)}..${Math.round(p0.max)})`);
			await Q.mouse.click(at.x - 200, at.y);
			await Q.waitForTimeout(300);
			h.check(!(await Q.locator('#toolbar-move-hint').count()) && typeof (await stored(Q))?.posX === 'number', TD + 'M4: a click places it and stores it');
			h.check(h.pageErrors(D).length === 0, TD + `no page errors (${h.pageErrors(D).join(' / ')})`);
			await D.ctx.close();
		}

		await h.finish(browser);
	});
};
