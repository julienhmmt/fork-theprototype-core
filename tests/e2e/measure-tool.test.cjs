// 47 M1 — the Measure tool: snapped points, chains with a running total and the angle between
// segments, pinned dimension labels that follow the camera and stay on THIS peer, and the touch
// tap path on a phone.
//
// A is a desktop page driven with a REAL mouse; B is an OPPO Find N6 FOLDED phone (touch, DPR 3)
// driven with real CDP touch events. The fixture is a 2 x 1 x 1 box at (0, 0.5, 0), so its top
// corners are (±1, 1, ±0.5): the top front edge is exactly 2 m, the right edge exactly 1 m, and
// the two meet at 90°. Every click aims a few pixels INSIDE the corner it means (the ray must hit
// the box) — so a reading of exactly 2.000 m is the snap's doing, and the counterfactual (snap
// switched off, same pixels) proves it reads something else.
const h = require('./helpers.cjs');

const N6_FOLDED = { hasTouch: true, isMobile: true, deviceScaleFactor: 3, viewport: { width: 380, height: 792 } };
const CORNER_FL = [-1, 1, 0.5]; // top front-left
const CORNER_FR = [1, 1, 0.5]; // top front-right
const CORNER_BR = [1, 1, -0.5]; // top back-right
const TOP_CENTRE = [0, 1, 0];
const VIEW = { pos: [3, 3.5, 4.5], target: [0, 0.5, 0] };
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (page) =>
	page.evaluate(() => {
		const m = window.__stores.measure;
		const read = (s) => {
			let v;
			s.subscribe((x) => (v = x))();
			return v;
		};
		const cur = read(m.measurement);
		const pins = read(m.pinnedMeasurements);
		const labels = [...document.querySelectorAll('#measure-labels .measure-label')].map((el) => ({
			key: el.dataset.key,
			kind: el.dataset.kind,
			pinned: el.dataset.pinned === '1',
			text: el.textContent.trim(),
			x: parseFloat(el.style.left),
			y: parseFloat(el.style.top)
		}));
		return { cur, pins, labels, mode: read(m.measureMode) };
	});

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** the pixel a few px from `corner` toward `toward` (both projected) */
async function aimInside(page, corner, toward = TOP_CENTRE, px = 6) {
	const c = await h.projectPoint(page, corner);
	const t = await h.projectPoint(page, toward);
	const len = Math.hypot(t.x - c.x, t.y - c.y) || 1;
	return { x: c.x + ((t.x - c.x) / len) * px, y: c.y + ((t.y - c.y) / len) * px };
}

async function setView(page, view) {
	await page.evaluate((v) => window.__stores.objectActions.flyTo(v.pos, v.target, 0), view);
	await page.waitForTimeout(600);
}

/** what is under a pixel — a click that lands on chrome is not a viewport click */
const underIsCanvas = (page, p) => underOf(page, p).then((u) => u === 'CANVAS');
/** what is under a pixel: 'CANVAS' for the renderer's own, else a short description */
const underOf = (page, p) =>
	page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		let r;
		window.__stores.globalRenderer.subscribe((v) => (r = v))();
		if (el === r.domElement) return 'CANVAS';
		return el ? `${el.tagName}#${el.id}.${String(el.className?.baseVal ?? el.className).slice(0, 60)}` : 'nothing';
	}, p);

async function click(page, p) {
	await page.mouse.move(p.x - 3, p.y - 3);
	await page.mouse.move(p.x, p.y, { steps: 3 });
	await page.waitForTimeout(120);
	await page.mouse.down();
	await page.mouse.up();
	await page.waitForTimeout(550); // past the double-click-pins window
}

async function tap(cdp, p, holdMs = 90) {
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
	await nap(holdMs);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await nap(550);
}

h.run(async () => {
	// the GPU backend: on the software one a frame can land between the press and the release,
	// and a click held past 400 ms is (rightly) an orbit, not a click
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A', { context: { viewport: { width: 1440, height: 900 } } });
	const B = await h.setupPage(browser, 'B', { context: N6_FOLDED });
	await h.connect(A, B);

	// --- the fixture: a 2 x 1 x 1 box, posed on A and replicated ---
	const uuid = await A.page.evaluate(async () => {
		const w = window.__stores;
		w.commandsHandler.sceneCommand('/create Box 2 1 1');
		const g = await new Promise((r) => w.objectsGroup.subscribe(r)());
		return g.children[g.children.length - 1].uuid;
	});
	await A.page.waitForTimeout(1500); // /create re-seats after it returns
	await A.page.evaluate((id) => {
		const w = window.__stores;
		let g; w.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', id);
		o.position.set(0, 0.5, 0);
		o.rotation.set(0, 0, 0);
		o.updateMatrixWorld(true);
		let p; w.peers.subscribe((v) => (p = v))();
		p.send({ type: 'move', uuid: id, pos: [0, 0.5, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
		w.objectActions.deselectObject?.();
	}, uuid);
	const boxOn = (page) =>
		page.evaluate((id) => {
			let g; window.__stores.objectsGroup.subscribe((v) => (g = v))();
			const o = g.getObjectByProperty('uuid', id);
			if (!o) return null;
			return { x: o.position.x, y: o.position.y, z: o.position.z };
		}, uuid);
	await h.eventually(() => boxOn(B.page), (p) => p && Math.abs(p.y - 0.5) < 1e-6 && Math.abs(p.x) < 1e-6, 'premise: B holds the posed box', 20000);
	const size = await A.page.evaluate((id) => {
		let g; window.__stores.objectsGroup.subscribe((v) => (g = v))();
		const o = g.getObjectByProperty('uuid', id);
		o.geometry.computeBoundingBox();
		const bb = o.geometry.boundingBox;
		return [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
	}, uuid);
	h.check(Math.abs(size[0] - 2) < 1e-6 && Math.abs(size[1] - 1) < 1e-6 && Math.abs(size[2] - 1) < 1e-6, `premise: the box is 2 x 1 x 1 (${size.map((n) => n.toFixed(3))})`);

	// --- 1. counterfactual first: snapping OFF, the same pixels do NOT read the box size ---
	await setView(A.page, VIEW);
	await A.page.evaluate(() => {
		const m = window.__stores.measure;
		m.measureSnap.set(false);
		m.startMeasure();
	});
	const pFL = await aimInside(A.page, CORNER_FL);
	const pFR = await aimInside(A.page, CORNER_FR);
	h.check((await underIsCanvas(A.page, pFL)) && (await underIsCanvas(A.page, pFR)), 'premise: both aim points are bare viewport');
	await click(A.page, pFL);
	await click(A.page, pFR);
	let s = await state(A.page);
	const raw = s.cur ? dist(s.cur.points[0], s.cur.points[1]) : NaN;
	h.check(s.cur?.points.length === 2 && Math.abs(raw - 2) > 0.01, `COUNTERFACTUAL: unsnapped clicks a few px inside the corners do not read 2 m (${raw.toFixed(4)})`);

	// --- 2. snapped two-point distance equals the box size ---
	await A.page.evaluate(() => {
		const m = window.__stores.measure;
		m.clearMeasurements();
		m.measureSnap.set(true);
	});
	await click(A.page, pFL);
	await click(A.page, pFR);
	s = await state(A.page);
	const snapped = s.cur ? dist(s.cur.points[0], s.cur.points[1]) : NaN;
	h.check(s.cur?.snaps?.every((t) => t === 'vertex'), `both points snapped to a vertex (${JSON.stringify(s.cur?.snaps)})`);
	h.check(Math.abs(snapped - 2) < 1e-5, `snapped distance equals the box width: ${snapped.toFixed(6)} m`);
	h.check(s.labels.length === 1 && s.labels[0].kind === 'segment' && s.labels[0].text === '2.000 m', `the DOM shows ONE label, 2.000 m — no 0 m preview while the cursor rests on the point (${s.labels.map((l) => l.text).join(' | ')})`);
	const readout = await A.page.locator('#measure-last').textContent().catch(() => '');
	h.check(readout?.trim() === '2.000 m', `the toolbox readout reads 2.000 m ("${readout}")`);

	// --- 3. a chain of 3 points: running total + the angle between the segments ---
	const pBR = await aimInside(A.page, CORNER_BR);
	h.check(await underIsCanvas(A.page, pBR), 'premise: the third aim point is bare viewport');
	await click(A.page, pBR);
	s = await state(A.page);
	const seg2 = s.cur?.points.length === 3 ? dist(s.cur.points[1], s.cur.points[2]) : NaN;
	h.check(Math.abs(seg2 - 1) < 1e-5, `the second segment is the box depth: ${seg2.toFixed(6)} m`);
	const total = s.labels.find((l) => l.kind === 'total');
	const angle = s.labels.find((l) => l.kind === 'angle');
	h.check(total?.text === 'Total 3.000 m', `the chain shows its total (${total?.text})`);
	h.check(angle?.text === '90.0°', `the chain shows the angle between the segments (${angle?.text})`);
	const tTotal = (await A.page.locator('#measure-total').textContent().catch(() => '')).trim();
	const tAngle = (await A.page.locator('#measure-angle').textContent().catch(() => '')).trim();
	h.check(tTotal === '3.000 m' && tAngle === '90.0°', `the toolbox agrees (total ${tTotal}, angle ${tAngle})`);
	// Backspace drops the last point, a third click puts it back
	await A.page.locator('#measure-undo-point').click();
	s = await state(A.page);
	// (the cursor still rests on the removed point, so the live PREVIEW draws a third point again —
	// the committed chain is what the toolbox reads)
	h.check(s.cur?.points.length === 2 && (await A.page.locator('#measure-total').count()) === 0, 'Undo point removes the last point and its total');
	await click(A.page, pBR);

	// --- 4. pin: the labels stay, follow the camera, and are not on the second peer ---
	await A.page.locator('#measure-pin').click();
	await A.page.waitForTimeout(300);
	s = await state(A.page);
	h.check(s.pins.length === 1 && s.cur === null, `Pin keeps the chain and starts a fresh one (pins ${s.pins.length})`);
	const pinned = s.labels.filter((l) => l.pinned);
	h.check(pinned.length === 4, `the pinned chain keeps its 4 labels — 2 lengths, the angle, the total (${pinned.map((l) => l.text).join(' | ')})`);
	const before = pinned.find((l) => l.kind === 'segment' && l.text === '2.000 m');
	await A.page.locator('#measure-done').click();
	await A.page.waitForTimeout(300);
	s = await state(A.page);
	h.check(!s.mode && s.labels.filter((l) => l.pinned).length === 4, 'stopping the tool keeps the pinned dimensions on screen');
	await setView(A.page, { pos: [-4, 2.2, 3.2], target: [0, 0.5, 0] });
	s = await state(A.page);
	const after = s.labels.find((l) => l.key === before?.key);
	const expected = await h.projectPoint(A.page, [0, 1, 0.5]); // the front edge's midpoint
	h.check(!!after && Math.hypot(after.x - before.x, after.y - before.y) > 40, `the pinned label moved with the camera (${before && before.x.toFixed(0)},${before && before.y.toFixed(0)} -> ${after && after.x.toFixed(0)},${after && after.y.toFixed(0)})`);
	h.check(!!after && Math.hypot(after.x - expected.x, after.y - expected.y) < 1.5, `…and sits on the edge's midpoint in the new view (off by ${after ? Math.hypot(after.x - expected.x, after.y - expected.y).toFixed(2) : '—'} px)`);
	const onB = await state(B.page);
	h.check(onB.pins.length === 0 && onB.labels.length === 0, `the second peer has no measurement and no label (pins ${onB.pins.length}, labels ${onB.labels.length})`);

	// --- 5. the touch tap path: B (phone) measures with two finger taps ---
	// a portrait 380-px screen sees a narrow horizontal field: stand back so the whole box fits
	await setView(B.page, { pos: [6, 7, 9], target: [0, 0.5, 0] });
	await B.page.evaluate(() => window.__stores.measure.startMeasure());
	await B.page.waitForTimeout(500);
	const cdp = await B.ctx.newCDPSession(B.page);
	const qFL = await aimInside(B.page, CORNER_FL, TOP_CENTRE, 5);
	const qFR = await aimInside(B.page, CORNER_FR, TOP_CENTRE, 5);
	// the start toast can sit over the box on a 380-px screen for its few seconds
	await h.eventually(async () => [await underOf(B.page, qFL), await underOf(B.page, qFR)], (u) => u.every((x) => x === 'CANVAS'), 'premise: both tap points are bare viewport on the phone', 12000);
	await tap(cdp, qFL);
	await tap(cdp, qFR);
	s = await state(B.page);
	const tapped = s.cur?.points.length === 2 ? dist(s.cur.points[0], s.cur.points[1]) : NaN;
	h.check(Math.abs(tapped - 2) < 1e-5, `two finger taps measure the snapped 2 m edge on the phone (${tapped.toFixed(6)}, snaps ${JSON.stringify(s.cur?.snaps)})`);
	const pinBox = await B.page.locator('#measure-pin').boundingBox();
	h.check(!!pinBox, 'the phone shows the Measure sheet with its Pin command');
	if (pinBox) await tap(cdp, { x: pinBox.x + pinBox.width / 2, y: pinBox.y + pinBox.height / 2 });
	s = await state(B.page);
	h.check(s.pins.length === 1, `a tap on Pin pins it on the phone (pins ${s.pins.length})`);
	const backOnA = await state(A.page);
	h.check(backOnA.pins.length === 1, `…and A still holds only its own pin (${backOnA.pins.length})`);

	// --- 6. Clear measurements ---
	await A.page.evaluate(() => window.__stores.measure.clearMeasurements());
	await A.page.waitForTimeout(300);
	s = await state(A.page);
	h.check(s.pins.length === 0 && s.labels.length === 0, 'Clear measurements removes every pinned label');

	await h.finish(browser);
});
