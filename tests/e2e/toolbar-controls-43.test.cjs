// 43 J2 / J5 / J8 / J9 / J10 — the user's preview-1-33 review of the toolbar (Controls.svelte):
//   J2  the "…" (Customize toolbar) can be removed like any item — right-click ▸ Hide button, its
//       Customize row, Edit positions' "−" — and its right-click opens the toolbar menu
//   J5  "Lift corner buttons above docked panels" also keeps the corner stacks clear of a PINNED
//       sidebar, and drops back down when the dock is hidden
//   J8  Edit positions lays its bar BESIDE any open sidebar; Move toolbar never crosses a pinned
//       sidebar (incl. the corner stacks' room); no browser context menu anywhere on the toolbar
//       box (gaps between icons included) — a grid of right-clicks proves it
//   J9  the phone More sheet's "Hold and drag items…" tip has an ×, remembered; Reset tips restores it
//   J10 toolbar overflow: items that do not fit fold into a "»" menu right-to-left by the user's order
//       (Play never folds), and come back as room returns; the enabled set never changes
// Desktop 1440×900 with a REAL mouse; the OPPO Find N6 UNFOLDED (770×850, DPR 2.9) with REAL touch
// (CDP) and FOLDED (390×896). Counterfactual: on origin/feat/42-int (1.33.0) each row is red.
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
async function clickAt(page, loc, opts = {}) {
	const p = await centre(loc);
	await page.mouse.click(p.x, p.y, opts);
	await page.waitForTimeout(300);
}
const menuOpen = (page) => page.evaluate(() => !!document.querySelector('[role="menu"]'));
const menuRows = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((el) => ({ label: el.textContent.trim(), checked: el.className.includes('ctx-checked') }))
	);
async function closeMenus(page) {
	for (let i = 0; i < 3 && (await menuOpen(page)); i++) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
	}
}
async function cellMenu(page, title) {
	await page.locator(`#controls-pill > div > [title="${title}"]`).click({ button: 'right' });
	await page.waitForTimeout(350);
}
async function enterEdit(page, title = 'Explorer') {
	await cellMenu(page, title);
	await page.getByRole('menuitem', { name: 'Edit positions', exact: true }).click();
	await page.waitForTimeout(450);
}
/** every contextmenu event, recorded at the window in CAPTURE (before any handler) so its
 *  `defaultPrevented` can be read once the dispatch is over — a bubble listener would never see
 *  the ones a cell stops */
async function armContextLog(page) {
	await page.evaluate(() => {
		window.__ctxLog = [];
		if (window.__ctxArmed) return;
		window.__ctxArmed = true;
		window.addEventListener('contextmenu', (e) => window.__ctxLog.push(e), true);
	});
}
const lastContext = (page) =>
	page.evaluate(() => {
		const e = window.__ctxLog[window.__ctxLog.length - 1];
		return e ? { prevented: e.defaultPrevented, target: e.target?.id || e.target?.className?.baseVal || e.target?.className || e.target?.tagName } : null;
	});
const flag = (page, name) => page.evaluate((n) => { let v; window.__stores[n].subscribe((x) => (v = x))(); return v; }, name);

// ONLY=j2,j8menu,j9,j5,j8clamp,j8edit,j10 runs those sections alone — each row's COUNTERFACTUAL is
// then its own red on a base that lacks the others
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (/** @type {string} */ key) => !ONLY.length || ONLY.includes(key);

h.run(async () => {
	const browser = await h.launch();

	// ═══ DESKTOP 1440×900, real mouse ═════════════════════════════════════════════════════════════
	for (const theme of ['dark', 'light']) {
		const A = await h.setupPage(browser, 'desk-' + theme, { context: { viewport: { width: 1440, height: 900 } }, storage: { theme, toastsInDrawerOnly: 'true' } });
		const P = A.page;
		const T = `[${theme}] `;
		await armContextLog(P);

		if (want('j2')) {
			// ---- J2: the "…" is an item — right-click opens the toolbar menu; it can be hidden -------------
			h.check(await P.locator('#toolbar-customize').isVisible(), T + 'premise: the bar ends in its "…"');
			await clickAt(P, P.locator('#toolbar-customize'), { button: 'right' });
			const ctx = await lastContext(P);
			let rows = (await menuRows(P)).map((r) => r.label);
			h.check(ctx?.prevented === true && rows.includes('Edit positions') && rows.includes('Hide button'), T + `J2: right-click on the "…" opens the toolbar menu, no browser menu (${JSON.stringify(ctx)} / ${rows.length} rows)`);
			h.check(!rows.includes('Move left') && !rows.includes('Move right') && rows.includes('Customize toolbar…') && rows.includes('Move toolbar'), T + `J2: …the bar's rows, no Move left/right for the "…" (${rows.join(' | ')})`);
			await shot(P, `j2-more-menu-${theme}`);
			await P.getByRole('menuitem', { name: 'Hide button', exact: true }).click();
			await P.waitForTimeout(400);
			h.check((await P.locator('#toolbar-customize').count()) === 0 && (await stored(P))?.more === false, T + `J2: Hide button takes the "…" off the bar and stores it (more=${(await stored(P))?.more})`);
			await h.freshReload(A);
			await P.locator('#restore-session-dismiss').click({ timeout: 4000 }).catch(() => {});
			await armContextLog(P);
			h.check((await P.locator('#toolbar-customize').count()) === 0, T + 'J2: …and it stays off after a reload');
			// Customize (from any cell's menu) lists it, unchecked, and puts it back
			await cellMenu(P, 'Explorer');
			await P.getByRole('menuitem', { name: 'Customize toolbar…', exact: true }).click();
			await P.waitForTimeout(400);
			rows = await menuRows(P);
			const off = rows.find((r) => r.label.startsWith('… (Customize toolbar)'));
			h.check(!!off && off.checked === false, T + `J2: Customize lists the "…" unchecked (${JSON.stringify(off)})`);
			await P.locator('[role="menu"] [role="menuitem"]', { hasText: '… (Customize toolbar)' }).first().click();
			await P.waitForTimeout(400);
			const on = (await menuRows(P)).find((r) => r.label.startsWith('… (Customize toolbar)'));
			h.check((await P.locator('#toolbar-customize').count()) === 1 && on?.checked === true, T + `J2: ticking it brings the "…" back, the row reads checked (${JSON.stringify(on)})`);
			await closeMenus(P);
			// Edit positions: a "−" like any item, and the end "+" offers it back
			await enterEdit(P);
			h.check((await P.locator('#controls-pill [data-edit-wrap="__more"] .hud-edit-remove').count()) === 1, T + 'J2: Edit positions draws the "…" with a red "−"');
			await clickAt(P, P.locator('#controls-pill [data-edit-wrap="__more"] .hud-edit-remove'));
			h.check((await P.locator('#controls-pill [data-edit-wrap="__more"]').count()) === 0, T + 'J2: its "−" takes it off the draft');
			await clickAt(P, P.locator('#toolbar-edit-add-end'));
			const adds = (await menuRows(P)).map((r) => r.label);
			h.check(adds.some((l) => l.startsWith('… (Customize toolbar)')), T + `J2: the end "+" offers it back (${adds.join(' | ')})`);
			await closeMenus(P);
			await clickAt(P, P.locator('#toolbar-edit-apply'));
			h.check((await P.locator('#toolbar-customize').count()) === 0 && (await stored(P))?.more === false, T + 'J2: ✓ applies the removal');
			await enterEdit(P);
			await clickAt(P, P.locator('#toolbar-edit-add-end'));
			await P.locator('[role="menu"] [role="menuitem"]', { hasText: '… (Customize toolbar)' }).first().click();
			await P.waitForTimeout(300);
			await clickAt(P, P.locator('#toolbar-edit-apply'));
			h.check((await P.locator('#toolbar-customize').count()) === 1 && (await stored(P))?.more !== false, T + 'J2: …and the "+" puts it back on ✓');
			await shot(P, `j2-more-back-${theme}`);
		}

		if (want('j8menu')) {
			// ---- J8: no browser context menu anywhere on the toolbar box — a grid of right-clicks --------
			// the points: EVERY gap between two cells (top, middle, bottom of the row), the bar's padding
			// all round, the separator, the gaps between stacked corner buttons — plus a coarse grid
			const points = await P.evaluate((dense) => {
				/** @type {{x:number,y:number}[]} */
				const out = [];
				const nav = document.querySelector('#controls-pill').getBoundingClientRect();
				const cells = [...document.querySelectorAll('#controls-pill .hud-bar-row > *, #controls-pill > .hud-sep, #controls-pill > button')];
				const rects = cells.map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
				for (let i = 0; i + 1 < rects.length; i++) {
					const x = (rects[i].right + rects[i + 1].left) / 2;
					for (const y of [nav.top + 3, (nav.top + nav.bottom) / 2, nav.bottom - 3]) out.push({ x, y });
				}
				for (const y of [(nav.top + nav.bottom) / 2]) out.push({ x: nav.left + 3, y }, { x: nav.right - 3, y });
				for (let x = nav.left + 14; x < nav.right - 14; x += dense ? 23 : 61) out.push({ x, y: nav.top + 2 }, { x, y: nav.bottom - 2 });
				for (const side of ['left', 'right']) {
					const kids = [...document.querySelectorAll(`#hud-stack-${side} > *`)].map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
					for (let i = 0; i + 1 < kids.length; i++) out.push({ x: (kids[i].left + kids[i].right) / 2, y: (kids[i].bottom + kids[i + 1].top) / 2 });
					for (const k of kids) out.push({ x: (k.left + k.right) / 2, y: (k.top + k.bottom) / 2 });
				}
				for (let y = nav.top + 6; y < nav.bottom - 4; y += 13) for (let x = nav.left + 9; x < nav.right - 6; x += dense ? 31 : 97) out.push({ x, y });
				return out;
			}, theme === 'dark');
			let tried = 0;
			let gaps = 0;
			/** @type {string[]} */
			const bad = [];
			for (const { x, y } of points) {
				// only points that really land on the toolbar (a rounded corner lands on the canvas)
				const hit = await P.evaluate(([px, py]) => {
					const el = document.elementFromPoint(px, py);
					const on = el?.closest?.('#controls-pill, .hud-stack');
					return on ? { gap: !el.closest('button, p'), cls: String(el.className?.baseVal ?? el.className) } : null;
				}, [x, y]);
				if (!hit) continue;
				tried++;
				if (hit.gap) gaps++;
				await P.mouse.click(x, y, { button: 'right' });
				await P.waitForTimeout(90);
				const ctx = await lastContext(P);
				const opened = await menuOpen(P);
				if (!ctx?.prevented || !opened) bad.push(`${Math.round(x)},${Math.round(y)} ${hit.cls} prevented=${ctx?.prevented} menu=${opened}`);
				await closeMenus(P);
			}
			h.check(tried > (theme === 'dark' ? 60 : 25) && gaps > 10, T + `premise: the grid covered the bar and both corners (${tried} points, ${gaps} on gaps)`);
			h.check(bad.length === 0, T + `J8: every right-click on the toolbar box opens the toolbar menu, never the browser's (${bad.length} bad${bad.length ? ': ' + bad.slice(0, 6).join(' ; ') : ''})`);
			// a gap's menu is the bar's own: the Toolbar rows, no per-button rows
			const gap = await P.evaluate(() => {
				const row = document.querySelector('#controls-pill .hud-bar-row');
				const cells = [...row.children];
				const a = cells[0].getBoundingClientRect();
				const b = cells[1].getBoundingClientRect();
				return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 };
			});
			await P.mouse.click(gap.x, gap.y, { button: 'right' });
			await P.waitForTimeout(300);
			const rows = (await menuRows(P)).map((r) => r.label);
			h.check(rows.includes('Edit positions') && rows.includes('Customize toolbar…') && !rows.includes('Swap with') && !rows.includes('Hide button'), T + `J8: a gap opens the bar's own menu (${rows.join(' | ')})`);
			await closeMenus(P);
			// in Edit positions the toolbar is a work surface: no menu, and still never the browser's
			await enterEdit(P);
			await armContextLog(P);
			const editBox = await P.evaluate(() => {
				const r = document.querySelector('#controls-pill').getBoundingClientRect();
				return { x: r.left + 4, y: r.top + r.height / 2 };
			});
			await P.mouse.click(editBox.x, editBox.y, { button: 'right' });
			await P.waitForTimeout(250);
			const ectx = await lastContext(P);
			h.check(ectx?.prevented === true, T + `J8: in Edit positions a right-click on the bar's edge is not the browser's (${JSON.stringify(ectx)})`);
			await P.keyboard.press('Escape');
			await P.waitForTimeout(300);
		}

		h.check(h.pageErrors(A).length === 0, T + `no page errors (${h.pageErrors(A).join(' / ')})`);
		await A.ctx.close();
	}

	// ═══ OPPO Find N6 UNFOLDED (770×850, DPR 2.9) — REAL touch ════════════════════════════════════
	if (want('j8menu') || want('j2')) {
		const A = await h.setupPage(browser, 'unfolded', {
			context: { viewport: { width: 770, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.9 },
			storage: { theme: 'dark', toastsInDrawerOnly: 'true', toursSeen: '{"editor-touch":true,"editor":true}' }
		});
		const P = A.page;
		const T = '[unfolded] ';
		const cdp = await P.context().newCDPSession(P);
		const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
		const hold = async (p, ms = 750) => {
			await touch('touchStart', p.x, p.y);
			await P.waitForTimeout(ms);
			await touch('touchEnd');
			await P.waitForTimeout(300);
		};
		h.check(await P.locator('#controls-pill').isVisible(), T + 'premise: unfolded, the desktop bar is drawn');
		if (want('j8menu')) {
			// a long press on a GAP between two cells opens the bar's menu
			const gap = await P.evaluate(() => {
				const cells = [...document.querySelector('#controls-pill .hud-bar-row').children];
				const a = cells[0].getBoundingClientRect();
				const b = cells[1].getBoundingClientRect();
				const nav = document.querySelector('#controls-pill').getBoundingClientRect();
				// the bar's padding below the cells is a gap a finger can land on
				return { x: (a.left + a.right) / 2, y: Math.min(nav.bottom - 2, a.bottom + 3), between: { x: (a.right + b.left) / 2, y: a.top + a.height / 2 } };
			});
			await hold({ x: gap.x, y: gap.y });
			const rows = (await menuRows(P)).map((r) => r.label);
			h.check(rows.includes('Edit positions') && rows.includes('Customize toolbar…'), T + `J8: a long press on the bar's padding opens the bar's menu (${rows.length} rows)`);
			await closeMenus(P);
		}
		h.check(h.pageErrors(A).length === 0, T + `no page errors (${h.pageErrors(A).join(' / ')})`);
		await A.ctx.close();
	}

	// ═══ OPPO Find N6 FOLDED (390×896) — the phone More sheet's tip ═════════════════════════════════
	if (want('j9')) {
		for (const theme of ['dark', 'light']) {
			const A = await h.setupPage(browser, 'folded-' + theme, {
				context: { viewport: { width: 390, height: 896 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.9 },
				storage: { theme, toastsInDrawerOnly: 'true', toursSeen: '{"editor-touch":true,"editor":true}' }
			});
			const P = A.page;
			const T = `[folded ${theme}] `;
			h.check(await P.evaluate(() => document.documentElement.classList.contains('phone-shell')), T + 'premise: folded, the phone shell is drawn');
			await P.locator('#ps-more').tap();
			await P.waitForTimeout(600);
			h.check(await P.locator('#ps-more-hint').isVisible(), T + 'premise: More shows "Hold and drag items…"');
			const x = P.locator('#ps-more-hint-close');
			h.check((await x.count()) === 1 && (await x.isVisible()), T + 'J9: the tip carries an ×');
			const box = await x.boundingBox();
			h.check(!!box && box.width >= 40 && box.height >= 40, T + `J9: …a finger-sized one (${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
			await shot(P, `j9-tip-${theme}`);
			await x.tap();
			await P.waitForTimeout(300);
			h.check((await P.locator('#ps-more-hint').count()) === 0, T + 'J9: tapping × closes the tip');
			h.check((await P.evaluate(() => localStorage.getItem('tipsDismissed') ?? '')).includes('phone-more-drag'), T + 'J9: …and remembers it');
			await shot(P, `j9-tip-closed-${theme}`);
			await h.freshReload(A);
			await P.locator('#restore-session-dismiss').tap({ timeout: 4000 }).catch(() => {});
			await P.locator('#ps-more').tap();
			await P.waitForTimeout(600);
			h.check((await P.locator('.ps-sheet, #ps-more-sheet').count()) > 0 && (await P.locator('#ps-more-hint').count()) === 0, T + 'J9: after a reload the More sheet opens without the tip');
			// Settings ▸ Interface ▸ Reset tips
			await P.evaluate(() => window.__stores.phoneShell.phoneSheet.set(null));
			await P.waitForTimeout(300);
			await P.evaluate(() => window.__stores.settingsOpen.set(true));
			await P.waitForTimeout(800);
			const nav = P.locator('.sn-label', { hasText: /^Interface$/ });
			if (await nav.count()) await nav.first().tap().catch(() => {});
			await P.waitForTimeout(500);
			const reset = P.locator('#setting-tips-reset');
			h.check((await reset.count()) === 1 && (await P.locator('#row-tips-reset').isVisible()), T + 'J9: Settings ▸ Interface has a Reset tips row');
			await reset.scrollIntoViewIfNeeded().catch(() => {});
			await reset.tap();
			await P.waitForTimeout(300);
			h.check((await P.evaluate(() => localStorage.getItem('tipsDismissed'))) === null && (await reset.isDisabled()), T + 'J9: Reset tips forgets the closed tips (and greys out)');
			await P.evaluate(() => window.__stores.settingsOpen.set(false));
			await P.waitForTimeout(500);
			await P.locator('#ps-more').tap();
			await P.waitForTimeout(600);
			h.check(await P.locator('#ps-more-hint').isVisible(), T + 'J9: the tip is back in More');
			h.check(h.pageErrors(A).length === 0, T + `no page errors (${h.pageErrors(A).join(' / ')})`);
			await A.ctx.close();
		}
	}

	await h.finish(browser);
});
