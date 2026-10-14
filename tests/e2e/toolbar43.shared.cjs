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
// shared by toolbar-more-menu-43 / toolbar-sidebars-43 / toolbar-overflow-43 (each under the runner's 8 min)

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
		[...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
			.map((el) => ({ label: el.textContent.trim(), checked: el.className.includes('ctx-checked') }))
			.filter((r) => r.label) // a rule between sections renders as an empty row
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

/** 42 sidebars' geometry (the store the columns draw from) */
const sbGeom = (page) => page.evaluate(() => { let v; window.__stores.sidebars.geometry.subscribe((x) => (v = x))(); return { left: v.left, right: v.right, leftX: v.leftX, wide: v.wide }; });
/** open the Inspector as the right (or left) column, optionally pinned at a width */
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
	await page.waitForTimeout(700);
}
const rect = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
/** the bar's cells as drawn (ids / titles, Play as __spacer) */
const barCells = (page) => page.evaluate(() => [...document.querySelector('#controls-pill .hud-bar-row').children].map((el) => (el.querySelector('#play-button') ? '__spacer' : el.id || el.getAttribute('title'))));
const folded = (page) => page.evaluate(() => document.getElementById('toolbar-overflow')?.dataset.folded?.split(',').filter(Boolean) ?? []);
/** every bar-able button on the bar (the user's "enable all icons"), Play in the middle */
const ALL_ON = JSON.stringify({ order: ['move', 'rotate', 'scale', 'pivot', 'mode', 'objects', 'flow', 'explorer', 'animation', 'flowcode', 'uv', 'shader', 'hud', 'profiler', 'code'], hidden: [], spacerIndex: 5, seen: ['move', 'rotate', 'scale', 'pivot', 'mode', 'objects', 'flow', 'explorer', 'animation', 'flowcode', 'uv', 'shader', 'hud', 'profiler', 'code', 'ai', 'add', 'chat', 'mic', 'notes', 'notifications', 'peers', 'undo', 'redo', 'multiselect'] });

// ONLY=j2,j8menu,j9,j5,j8clamp,j8edit,j10 runs those sections alone — each row's COUNTERFACTUAL is
// then its own red on a base that lacks the others
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);

/** swap the stored toolbar record in place (no reload: 4-5 reloads in one tab kill headless Chromium) */
async function setBar(page, json, peer) {
	const live = await page.evaluate((v) => {
		if (v == null) localStorage.removeItem('controlsLayout');
		else localStorage.setItem('controlsLayout', v);
		const core = window.__stores.uiLayoutsCore;
		if (core) core.runLayoutReloaders();
		return !!core;
	}, json);
	// a build without the hook (the counterfactual base) reads the record on a reload instead
	if (!live && peer) {
		await h.freshReload(peer);
		await page.locator('#restore-session-dismiss').click({ timeout: 4000 }).catch(() => {});
	}
	await page.waitForTimeout(600);
}

/** run the sections named in `parts` (∩ ONLY) */
module.exports = (/** @type {string[]} */ parts) => {
const want = (/** @type {string} */ key) => parts.includes(key) && (!ONLY.length || ONLY.includes(key));
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
			for (const { x, y } of theme === 'dark' ? points : []) {
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
			if (theme === 'dark') h.check(tried > 60 && gaps > 10, T + `premise: the grid covered the bar and both corners (${tried} points, ${gaps} on gaps)`);
			if (theme === 'dark') h.check(bad.length === 0, T + `J8: every right-click on the toolbar box opens the toolbar menu, never the browser's (${bad.length} bad${bad.length ? ': ' + bad.slice(0, 6).join(' ; ') : ''})`);
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

		if (want('j5')) {
			// ---- J5: lifted corner buttons keep clear of a PINNED sidebar; a hidden dock drops them --------
			await P.evaluate(() => window.__stores.hudStackLift.set(true));
			await P.evaluate(() => window.__stores.explorerClose.set(false));
			await P.waitForTimeout(900);
			const inset = await P.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-inset')) || 0);
			h.check(inset > 100, T + `premise: a docked Explorer opens a bottom dock (${inset}px)`);
			await sidebar(P, { side: 'right', full: true, w: 420 });
			let g = await sbGeom(P);
			h.check(g.right.shown && g.right.full && g.right.w === 420, T + `premise: the right sidebar is pinned at 420 (${JSON.stringify(g.right)})`);
			let r = await rect(P, '#hud-stack-right');
			h.check(Math.abs(1440 - r.right - (420 + 16)) <= 2, T + `J5: lifted, the right stack sits beside the pinned sidebar (gap ${Math.round(1440 - r.right)}, want 436)`);
			h.check(Math.abs(900 - r.bottom - (inset + 16)) <= 2, T + `J5: …and above the dock (${Math.round(900 - r.bottom)} vs ${inset + 16})`);
			const reach = await P.evaluate(() => { const el = document.getElementById('chat-button'); const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && el.contains(hit); });
			h.check(reach, T + 'J5: the chat button is reachable — nothing covers it');
			let l = await rect(P, '#hud-stack-left');
			h.check(Math.abs(l.left - 16) <= 1, T + `J5: the left stack (no sidebar on its side) stays in its corner (${Math.round(l.left)})`);
			await shot(P, `j5-pinned-docked-${theme}`);
			// the dock hidden: back on the floor, still beside the sidebar
			await P.evaluate(() => window.__stores.explorerClose.set(true));
			await P.waitForTimeout(700);
			r = await rect(P, '#hud-stack-right');
			h.check(Math.abs(900 - r.bottom - 16) <= 2 && Math.abs(1440 - r.right - 436) <= 2, T + `J5: dock hidden → the stack drops back down, beside the sidebar (bottom ${Math.round(900 - r.bottom)}, right ${Math.round(1440 - r.right)})`);
			// the left side, pinned
			await sidebar(P, { side: 'left', full: true, w: 360 });
			g = await sbGeom(P);
			l = await rect(P, '#hud-stack-left');
			r = await rect(P, '#hud-stack-right');
			h.check(Math.abs(l.left - (g.leftX + 360 + 16)) <= 2 && Math.abs(1440 - r.right - 16) <= 2, T + `J5: a pinned LEFT sidebar moves the left stack (${Math.round(l.left)}) and frees the right one (${Math.round(1440 - r.right)})`);
			// unpinned: back to the corner (the brief: PINNED sidebars only)
			await sidebar(P, { side: 'left', full: false, w: 360 });
			l = await rect(P, '#hud-stack-left');
			h.check(Math.abs(l.left - 16) <= 1, T + `J5: an UNPINNED sidebar leaves the stack in its corner (${Math.round(l.left)})`);
			// the option off: the corner, as before
			await sidebar(P, { side: 'right', full: true, w: 420 });
			await P.evaluate(() => window.__stores.hudStackLift.set(false));
			await P.waitForTimeout(400);
			r = await rect(P, '#hud-stack-right');
			h.check(Math.abs(1440 - r.right - 16) <= 1, T + `J5: lift OFF → the corner as before (docked panels cover it) (${Math.round(1440 - r.right)})`);
			await sidebar(P, { open: false });
		}

		if (want('j8clamp')) {
			// ---- J8: the bar never crosses a pinned sidebar — a drag, Move toolbar's arrows ----------------
			await P.evaluate(() => window.__stores.hudStackLift.set(true));
			for (const side of ['right', 'left']) {
				await sidebar(P, { side, full: true, w: 480 });
				const g = await sbGeom(P);
				const edge = side === 'right' ? 1440 - g.right.w : g.leftX + g.left.w;
				const stack = await rect(P, `#hud-stack-${side}`);
				// drag the bar hard toward the sidebar, from a cell (a press that travels moves the bar)
				const from = await centre(P.locator('#controls-pill > div > [title="Explorer"]'));
				const to = { x: side === 'right' ? 1435 : 5, y: from.y };
				await P.mouse.move(from.x, from.y);
				await P.mouse.down();
				for (let i = 1; i <= 16; i++) await P.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y);
				await P.mouse.up();
				await P.waitForTimeout(400);
				let bar = await rect(P, '#controls-pill');
				const okDrag = side === 'right' ? bar.right <= Math.min(edge, stack.left) - 7 : bar.left >= Math.max(edge, stack.right) + 7;
				h.check(okDrag, T + `J8: dragged toward the pinned ${side} sidebar, the bar stops clear of it and of the corner buttons (bar ${Math.round(bar.left)}..${Math.round(bar.right)}, sidebar edge ${Math.round(edge)}, stack ${Math.round(stack.left)}..${Math.round(stack.right)})`);
				// Move toolbar (armed) + a burst of Shift+arrows
				await closeMenus(P);
				await cellMenu(P, 'Explorer');
				await P.getByRole('menuitem', { name: 'Move toolbar', exact: true }).click();
				await P.waitForTimeout(200);
				for (let i = 0; i < 40; i++) await P.keyboard.press(side === 'right' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
				await P.keyboard.press('Enter');
				await P.waitForTimeout(400);
				bar = await rect(P, '#controls-pill');
				const okArm = side === 'right' ? bar.right <= Math.min(edge, stack.left) - 7 : bar.left >= Math.max(edge, stack.right) + 7;
				h.check(okArm, T + `J8: Move toolbar's arrows stop at the ${side} sidebar too (bar ${Math.round(bar.left)}..${Math.round(bar.right)}, edge ${Math.round(edge)})`);
				await shot(P, `j8-clamp-${side}-${theme}`);
				await setBar(P, null, A);
			}
			await sidebar(P, { open: false });
		}

		if (want('j8edit')) {
			// ---- J8: Edit positions lays its bar BESIDE an open sidebar (pinned or not), wrapping --------
			await setBar(P, ALL_ON, A);
			for (const pinned of [false, true]) {
				for (const side of ['right', 'left']) {
					await sidebar(P, { side, full: pinned, w: 560 });
					const g = await sbGeom(P);
					const col = side === 'right' ? { left: 1440 - g.right.w, right: 1440 } : { left: g.leftX, right: g.leftX + g.left.w };
					// an UNPINNED column covers the bar's cells on its side: open the menu from the other end
					if (side === 'right') await enterEdit(P, 'Move (1)');
					else {
						await P.locator('#toolbar-customize').click({ button: 'right' });
						await P.waitForTimeout(350);
						await P.getByRole('menuitem', { name: 'Edit positions', exact: true }).click();
						await P.waitForTimeout(450);
					}
					const bar = await rect(P, '#controls-pill');
					const items = await P.evaluate(() => document.querySelectorAll('#controls-pill [data-edit-slot]').length);
					const clear = bar.right <= col.left + 1 || bar.left >= col.right - 1;
					h.check(items >= 16 && clear, T + `J8: Edit positions (${pinned ? 'pinned' : 'unpinned'} ${side} sidebar) draws all ${items} places beside it (bar ${Math.round(bar.left)}..${Math.round(bar.right)}, sidebar ${Math.round(col.left)}..${Math.round(col.right)})`);
					const apply = await rect(P, '#toolbar-edit-apply');
					h.check(apply.right <= (side === 'right' ? col.left + 1 : 1440) && apply.left >= (side === 'left' ? col.right - 1 : 0), T + `J8: …the ✓ too (${Math.round(apply.left)}..${Math.round(apply.right)})`);
					if (side === 'right' && !pinned) await shot(P, `j8-edit-beside-${theme}`);
					await P.keyboard.press('Escape');
					await P.waitForTimeout(350);
				}
			}
			// a bar parked hard right, then Edit positions with the right sidebar open: it slides only enough
			await sidebar(P, { open: false });
			await setBar(P, JSON.stringify({ ...JSON.parse(ALL_ON), posX: 1 }), A);
			await sidebar(P, { side: 'right', full: false, w: 400 });
			await enterEdit(P, 'Move (1)');
			const bar = await rect(P, '#controls-pill');
			h.check(bar.right <= 1440 - 400 + 1 && bar.right >= 1440 - 400 - 40, T + `J8: a bar parked right slides just clear of the sidebar (right edge ${Math.round(bar.right)}, sidebar at ${1440 - 400})`);
			await P.keyboard.press('Escape');
			await P.waitForTimeout(300);
			await sidebar(P, { open: false });
			await setBar(P, null, A);
		}

		if (want('j10')) {
			// ---- J10: every button enabled + a pinned sidebar — the bar folds into "»" and unfolds -------
			await P.setViewportSize({ width: 1100, height: 900 });
			await setBar(P, ALL_ON, A);
			const all = await barCells(P);
			h.check(all.length === 16 && (await P.locator('#toolbar-overflow').count()) === 0, T + `premise: all 15 buttons + Play fit an empty 1100 px screen (${all.length} cells)`);
			const record = JSON.stringify(await stored(P));
			let last = -1;
			const counts = [];
			for (const w of [440, 400, 340, 290, 250]) {
				await sidebar(P, { side: 'right', full: true, w });
				const f = await folded(P);
				const cells = await barCells(P);
				const bar = await rect(P, '#controls-pill');
				const stackL = await rect(P, '#hud-stack-left');
				const g = await sbGeom(P);
				counts.push(`${w}:${f.length}`);
				// right to left by the user's order: the folded ones are exactly the row's tail
				const tailOk = cells.length + f.length === all.length && JSON.stringify(cells) === JSON.stringify(all.slice(0, cells.length));
				const clear = bar.right <= 1100 - g.right.w - 7 && bar.left >= stackL.right + 7;
				h.check(tailOk && clear && cells.includes('__spacer'), T + `J10: sidebar ${w}px — ${f.length} folded (${f.join(',') || 'none'}), the bar clear of the sidebar and the corner (${Math.round(bar.left)}..${Math.round(bar.right)})`);
				if (w === 440) {
					h.check(f.length > 0, T + 'J10: a wide pinned sidebar folds the tail into "»"');
					await shot(P, `j10-folded-${theme}`);
					// the "»" menu: the folded buttons, then Customize; a row does what its cell does
					await clickAt(P, P.locator('#toolbar-overflow'));
					const rows = (await menuRows(P)).map((x) => x.label);
					h.check(rows[rows.length - 1] === 'Customize toolbar…' && rows.length === f.length + 1, T + `J10: "»" lists the folded buttons + Customize toolbar… (${rows.join(' | ')})`);
					await shot(P, `j10-menu-${theme}`);
					const pick = f[f.length - 1];
					const closeStore = { code: 'codeWorkspaceClose', profiler: 'profilerClose', hud: 'hudEditorClose', shader: 'shaderEditorClose', uv: 'uvEditorClose', flowcode: 'flowCodeClose', animation: 'animationClose' }[pick];
					await P.locator('[role="menu"] [role="menuitem"]').nth(f.length - 1).click();
					await P.waitForTimeout(700);
					h.check(!!closeStore && (await flag(P, closeStore)) === false, T + `J10: the "${pick}" row opens its panel (${closeStore})`);
					if (closeStore) await P.evaluate((n) => window.__stores[n].set(true), closeStore);
					await P.waitForTimeout(400);
					// right-click on "»" is the bar's menu, never the browser's
					await clickAt(P, P.locator('#toolbar-overflow'), { button: 'right' });
					h.check((await lastContext(P))?.prevented === true && (await menuOpen(P)), T + 'J10: right-click on "»" opens the toolbar menu');
					await closeMenus(P);
				}
				h.check(last < 0 || f.length <= last, T + `J10: a narrower sidebar never folds more (${counts.join(' ')})`);
				last = f.length;
			}
			h.check(last === 0 && (await P.locator('#toolbar-customize').count()) === 1, T + `J10: shrunk to 250 px every button is back, the "…" too (${counts.join(' ')})`);
			// grow again → folds again; unpin → nothing folds (only a PINNED sidebar bounds the bar)
			await sidebar(P, { side: 'right', full: true, w: 440 });
			const again = (await folded(P)).length;
			await sidebar(P, { side: 'right', full: false, w: 440 });
			const unpinned = (await folded(P)).length;
			h.check(again > 0 && unpinned === 0, T + `J10: grown again it folds (${again}); unpinned it does not (${unpinned})`);
			h.check(JSON.stringify(await stored(P)) === record, T + 'J10: the enabled set never changed (the stored record is untouched)');
			await sidebar(P, { side: 'right', full: true, w: 440 });
			await P.locator('#toolbar-customize').count();
			await cellMenu(P, 'Move (1)');
			await P.getByRole('menuitem', { name: 'Customize toolbar…', exact: true }).click();
			await P.waitForTimeout(400);
			const cust = await menuRows(P);
			const onBar = ['Profiler', 'Code', 'HUD editor'].map((lbl) => cust.find((x) => x.label === lbl)?.checked);
			h.check(onBar.every((v) => v === true), T + `J10: Customize still lists the folded buttons as ON the bar (${onBar})`);
			await closeMenus(P);
			// Edit positions shows every item, wrapping beside the sidebar
			await enterEdit(P, 'Move (1)');
			const n = await P.evaluate(() => document.querySelectorAll('#controls-pill [data-edit-slot]').length);
			const bar = await rect(P, '#controls-pill');
			h.check(n === 16 && bar.right <= 1100 - 440 + 1, T + `J10: Edit positions shows all ${n} places (no "»"), wrapped beside the sidebar (right ${Math.round(bar.right)}, height ${Math.round(bar.height)})`);
			await shot(P, `j10-edit-wrapped-${theme}`);
			await P.keyboard.press('Escape');
			await P.waitForTimeout(300);
			await sidebar(P, { open: false });
			await P.setViewportSize({ width: 1440, height: 900 });
		}

		h.check(h.pageErrors(A).length === 0, T + `no page errors (${h.pageErrors(A).join(' / ')})`);
		await A.ctx.close();
	}

	// ═══ OPPO Find N6 UNFOLDED (770×850, DPR 2.9) — REAL touch ════════════════════════════════════
	if (want('j2') || want('j8menu') || want('j5') || want('j10')) {
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
		if (want('j5')) {
			await P.evaluate(() => { window.__stores.hudStackLift.set(true); window.__stores.explorerClose.set(false); });
			await P.waitForTimeout(900);
			await sidebar(P, { side: 'right', full: true, w: 300 });
			const g = await sbGeom(P);
			const r = await rect(P, '#hud-stack-right');
			h.check(g.right.full && Math.abs(770 - r.right - (g.right.w + 16)) <= 2, T + `J5: lifted, the right stack sits beside the pinned sidebar on touch (gap ${Math.round(770 - r.right)}, sidebar ${g.right.w})`);
			await P.evaluate(() => window.__stores.explorerClose.set(true));
			await sidebar(P, { open: false });
		}
		if (want('j10')) {
			await setBar(P, ALL_ON, A);
			const before = await folded(P);
			await sidebar(P, { side: 'right', full: true, w: 300 });
			const f = await folded(P);
			const bar = await rect(P, '#controls-pill');
			const g = await sbGeom(P);
			h.check(f.length > before.length && bar.right <= 770 - g.right.w - 7, T + `J10: unfolded, a pinned sidebar folds more into "»" (${before.length} → ${f.length}) and the bar stays clear (right ${Math.round(bar.right)})`);
			const o = await centre(P.locator('#toolbar-overflow'));
			await touch('touchStart', o.x, o.y);
			await touch('touchEnd');
			await P.waitForTimeout(400);
			const rows = (await menuRows(P)).map((x) => x.label);
			h.check(rows.length === f.length + 1 && rows[rows.length - 1] === 'Customize toolbar…', T + `J10: a tap on "»" opens its menu (${rows.join(' | ')})`);
			await shot(P, 'j10-unfolded-menu');
			await closeMenus(P);
			await sidebar(P, { open: false });
			await setBar(P, null, A);
		}
		if (want('j2')) {
			// a long press on the "…" opens the toolbar menu (Hide button included), as a right-click does
			await hold(await centre(P.locator('#toolbar-customize')));
			const rows = (await menuRows(P)).map((r) => r.label);
			h.check(rows.includes('Hide button') && rows.includes('Edit positions'), T + `J2: a long press on the "…" opens the toolbar menu (${rows.join(' | ')})`);
			await closeMenus(P);
		}
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
};
