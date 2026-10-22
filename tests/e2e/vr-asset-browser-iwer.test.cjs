// 52-browser — V4 on an EMULATED QUEST (IWER, iwer.cjs): the Asset Browser on the wrist, the drag-to-place
// ghost on the laser, and light hand tracking. Every row starts from the person's own gesture (Play, a real
// trigger / grip / stick on IWER's Touch Plus controllers, a real pinch on IWER's hands).
//   G. the laser ghost (absorbs f-vr-place): a prefab tile arms placeDrag's RAY mode — the ghost rides the
//      pointer hand's laser to the floor, the stick turns it 15° a flick, the TRIGGER places it as ONE
//      replicated undo step and it stays armed, a GRIP cancels with nothing spawned; in MINIATURE (the
//      world rig shrunk to 1:10 and moved) the ghost draws in the shrunk frame and the object lands at the
//      scene-unit spot under the laser
// Run: APP_URL=https://theprototype.app:5484/ node tests/e2e/vr-asset-browser-iwer.test.cjs   (ONLY=G,… to pick rows)
const h = require('./helpers.cjs');
const iwer = require('./iwer.cjs');

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (row) => !ONLY.length || ONLY.includes(row);

h.run(async () => {
	const browser = await h.launch({ args: h.GPU_ARGS });
	const A = await h.setupPage(browser, 'A', { init: iwer.initScript(), context: { viewport: { width: 1280, height: 720 } } });
	const page = A.page;
	const g = (fn, arg) => page.evaluate(fn, arg);
	const read = (name) => g((n) => { let v; window.__stores[n].subscribe((x) => (v = x))(); return v; }, name);
	const settle = (n = 6) => iwer.frames(page, n);
	const near = (a, b, tol = 0.02) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
	const count = () => g(() => new Promise((r) => window.__stores.objectsGroup.subscribe((grp) => r(grp.children.length))()));

	console.log('\n=== 0. enter VR on IWER ===');
	h.check(await iwer.installed(page), 'IWER owns navigator.xr before the app boots');
	const st0 = await iwer.enter(page);
	h.check(st0.presenting && st0.same, `Play presents the IWER session (${JSON.stringify(st0)})`);
	const menuHand = await read('vrMenuHand');
	const pointer = menuHand === 'right' ? 'left' : 'right';
	console.log(`menu hand ${menuHand}, pointer ${pointer}`);
	await iwer.pose(page, 'head', [0, 1.6, 0]);
	await iwer.pose(page, menuHand, [menuHand === 'left' ? -0.25 : 0.25, 1.1, -0.2]);

	/** where the pointer hand's laser meets the objectsGroup frame's ground (y = 0), in that frame */
	const laserGround = () =>
		g((hand) => {
			const T = window.__stores.THREE;
			let r, grp;
			window.__stores.globalRenderer.subscribe((v) => (r = v))();
			window.__stores.objectsGroup.subscribe((v) => (grp = v))();
			const c = [0, 1].map((i) => r.xr.getController(i)).find((x) => x.userData.handedness === hand);
			c.updateMatrixWorld(true);
			grp.updateWorldMatrix(true, false);
			const inv = grp.matrixWorld.clone().invert();
			const o = new T.Vector3().setFromMatrixPosition(c.matrixWorld);
			const d = new T.Vector3(0, 0, -1).applyMatrix4(new T.Matrix4().extractRotation(c.matrixWorld)).normalize();
			const local = new T.Ray(o, d).applyMatrix4(inv);
			const p = local.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
			return p ? p.toArray() : null;
		}, pointer);

	// ---- G. the laser ghost ------------------------------------------------------------------------
	if (want('G')) {
		console.log('\n=== G. the drag-to-place ghost on the laser ===');
		// a prefab to place (Edit ▸ Save prefab), the scene emptied after so the laser meets the floor
		await g(async () => {
			window.__stores.commandsHandler.sceneCommand('/create box');
			const group = await new Promise((r) => window.__stores.objectsGroup.subscribe(r)());
			const box = group.children[group.children.length - 1];
			box.name = 'GhostCrate';
			window.__stores.objectActions.selectObject(box);
			window.__stores.vrControls.executeVRMenuAction('obj:prefab');
		});
		await h.eventually(() => g(() => { let l; window.__stores.prefabs.prefabs.subscribe((x) => (l = x))(); return l.length; }), (n) => n >= 1, 'premise: a prefab in the library', 8000);
		await g(async () => {
			const group = await new Promise((r) => window.__stores.objectsGroup.subscribe(r)());
			const box = group.children.find((c) => c.name === 'GhostCrate');
			window.__stores.objectActions.selectObject(box);
			window.__stores.objectActions.deleteSelection?.();
		});
		await settle();
		const n0 = await count();
		// open Add ▸ Prefabs and pick the tile (the panel's own action)
		await g(() => {
			window.__stores.vrMenuOpen.set(true);
			window.__stores.vrControls.executeVRMenuAction('prefabs');
			let l;
			window.__stores.prefabs.prefabs.subscribe((x) => (l = x))();
			window.__stores.vrControls.executeVRMenuAction('prefabs:select:' + l[0].id);
		});
		// the pointer hand aims down at the floor ~1.4 m ahead
		await iwer.pose(page, pointer, [pointer === 'left' ? -0.15 : 0.15, 1.2, -0.3], { pitch: -0.7 });
		await settle(8);
		const aim = await laserGround();
		const gh = await g(() => window.__stores.placeGhost.ghostInfo());
		const st = await g(() => window.__stores.placeDrag.state());
		h.check(st?.mode === 'ray' && gh.visible, `a prefab tile arms the laser ghost (mode ${st?.mode}, visible ${gh.visible})`);
		h.check(!!aim && near([gh.items[0].position[0], gh.items[0].position[2]], [aim[0], aim[2]], 0.03), `the ghost rides the laser to the floor (${gh.items[0]?.position.map((v) => v.toFixed(2))} vs ${aim?.map((v) => v.toFixed(2))})`);
		const lift = -(st?.items?.[0]?.dims?.box?.[1] ?? NaN);
		h.check(!!st?.items?.[0]?.dims?.known && Math.abs(gh.items[0].position[1] - lift) < 0.01, `it rests ON the floor: the measured prefab's bottom on y 0 (centre ${gh.items[0].position[1].toFixed(3)}, lift ${lift})`);

		// the stick turns it: a flick right = -15°
		await iwer.stick(page, pointer, 0.9, 0);
		await settle(4);
		await iwer.stick(page, pointer, 0, 0);
		await settle(4);
		const rot = (await g(() => window.__stores.placeDrag.state()))?.rotation;
		h.check(rot === 345, `a stick flick right turns the ghost 15° clockwise (rotation ${rot})`);
		const turnsDuring = await g(() => window.__stores.vrPlace.vrPlaceDebug().rotations);
		h.check(turnsDuring === 1, `one flick is one step (${turnsDuring})`);

		// the TRIGGER places it (the session's own selectstart), ONE undo step, and it stays armed
		const undo0 = await g(() => window.__stores.history.undoStack?.length ?? window.__stores.history.historyDepth?.() ?? null);
		await iwer.tap(page, pointer, 'trigger');
		await h.eventually(count, (n) => n === n0 + 1, 'the trigger places the prefab through the replicated path', 6000);
		const placed = await g(async () => {
			const group = await new Promise((r) => window.__stores.objectsGroup.subscribe(r)());
			const o = group.children[group.children.length - 1];
			return { name: o.name, pos: o.position.toArray(), yaw: o.rotation.y };
		});
		h.check(placed.name === 'GhostCrate', `the placed object is the prefab (${placed.name})`);
		h.check(near([placed.pos[0], placed.pos[2]], [gh.items[0].position[0], gh.items[0].position[2]], 0.05), `it lands at the ghost spot (${placed.pos.map((v) => v.toFixed(2))})`);
		h.check(Math.abs(Math.abs(placed.yaw) - Math.PI / 12) < 0.01, `it lands turned as the ghost was (${((placed.yaw * 180) / Math.PI).toFixed(1)}°)`);
		const still = await g(() => window.__stores.vrPlace.vrPlaceDebug());
		h.check(still.active && still.placed === 1, `still armed for the next one (${JSON.stringify(still)})`);
		await g(() => window.__stores.history.undo());
		h.check((await count()) === n0, 'ONE undo removes the placement');
		if (undo0 != null) console.log('undo depth before', undo0);

		// MINIATURE: shrink the world rig to 1:10 and move it — the ghost draws in the shrunk frame and the
		// object lands at the scene-unit spot under the laser
		await g(() => {
			let rig;
			window.__stores.worldRig.subscribe((v) => (rig = v))();
			rig.scale.setScalar(0.1);
			rig.position.set(0.1, 0.8, -0.6);
			rig.updateMatrixWorld(true);
		});
		await iwer.pose(page, pointer, [pointer === 'left' ? -0.15 : 0.15, 1.2, -0.3], { pitch: -0.9 });
		await settle(8);
		const aimMini = await laserGround();
		const ghMini = await g(() => window.__stores.placeGhost.ghostInfo());
		const frameScale = ghMini.frame ? Math.hypot(ghMini.frame[0], ghMini.frame[1], ghMini.frame[2]) : 1;
		h.check(Math.abs(frameScale - 0.1) < 1e-3, `in miniature the ghost draws in the 1:10 frame (scale ${frameScale.toFixed(3)})`);
		h.check(!!aimMini && near([ghMini.items[0].position[0], ghMini.items[0].position[2]], [aimMini[0], aimMini[2]], 0.3), `the ghost sits under the laser in scene units (${ghMini.items[0]?.position.map((v) => v.toFixed(2))} vs ${aimMini?.map((v) => v.toFixed(2))})`);
		await iwer.tap(page, pointer, 'trigger');
		await h.eventually(count, (n) => n === n0 + 1, 'the trigger places in miniature too', 6000);
		const mini = await g(async () => {
			const group = await new Promise((r) => window.__stores.objectsGroup.subscribe(r)());
			const o = group.children[group.children.length - 1];
			return { pos: o.position.toArray(), scale: o.scale.toArray() };
		});
		h.check(near([mini.pos[0], mini.pos[2]], [ghMini.items[0].position[0], ghMini.items[0].position[2]], 0.05), `the miniature placement lands at the ghost's scene-unit spot (${mini.pos.map((v) => v.toFixed(2))})`);
		h.check(near(mini.scale, [1, 1, 1], 1e-6), 'and at full scene size (the rig, not the object, is small)');
		await g(() => {
			let rig;
			window.__stores.worldRig.subscribe((v) => (rig = v))();
			rig.scale.setScalar(1);
			rig.position.set(0, 0, 0);
			rig.updateMatrixWorld(true);
		});

		// a GRIP cancels: nothing spawns, the ghost goes
		const before = await count();
		await iwer.tap(page, menuHand, 'squeeze');
		await settle(4);
		const after = await g(() => ({ active: window.__stores.vrPlace.vrPlaceDebug().active, ghost: !!window.__stores.placeGhost.ghostRoot(), last: window.__stores.vrPlace.vrPlaceDebug().lastEnd }));
		h.check(!after.active && !after.ghost && after.last === 'grip', `a grip cancels the ghost (${JSON.stringify(after)})`);
		h.check((await count()) === before, 'and nothing spawned');
		h.check((await g(() => { let v; window.__stores.vrControls.vrPrefabGhost.subscribe((x) => (v = x))(); return v; })) === null, 'the prefab window is no longer armed');
	}

	await iwer.exit(page);
	await h.finish(browser);
});
