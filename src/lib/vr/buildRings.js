// 52 — the VR build-tool radial entries: Tools ▸ Measure + the Measure ring (V1), Selected ▸ Arrange with its
// Align / Distribute / Drop rings (V2), Selected ▸ Edit measurement. vrRadialMenu calls these from its
// registerBuiltins with its own `registerVRMenuEntry` (handed in, not imported: this file is reached from
// vrRadialMenu, and an import back would close a cycle). The tools themselves load on first use (dynamic
// imports): the measure runtime and align.js sit in history's family, which the radial must not pull in eagerly.
import { get } from 'svelte/store';
import { selectedObjects, selectedObject, vrToolMode } from '../../stores/sceneStore';

const selCount = () => /** @type {string[]} */ (get(selectedObjects))?.length ?? 0;
const vrMeasure = () => import('./measure.js');
const measureOn = () => get(vrToolMode) === 'measure';
/** is the (single) selection a kept measurement? (measureItems.isMeasurement, read inline — no import) */
const measurementSelected = () => selCount() === 1 && Array.isArray(/** @type {any} */ (get(selectedObject))?.userData?.measure?.points);

/** @param {(entry: any) => void} register vrRadialMenu.registerVRMenuEntry */
export function registerMeasureRings(register) {
	// Tools ▸ Measure — a trigger tool beside Select / Box select / Draw
	register({
		id: 'measure:tool',
		group: 'tools',
		label: 'Measure',
		icon: 'ruler',
		order: 2.5,
		closes: true,
		active: measureOn,
		action: () => void vrMeasure().then((m) => (measureOn() ? m.stopVRMeasure() : m.startVRMeasure()))
	});
	// the Measure ring — the radial opens on it while the tool is up (vr/measure.js)
	register({
		id: 'measure:keep',
		group: 'measure',
		label: 'Keep',
		icon: 'check',
		order: 0,
		closes: true,
		action: () => void vrMeasure().then((m) => m.vrKeepMeasurement())
	});
	register({
		id: 'measure:undo',
		group: 'measure',
		label: 'Undo point',
		icon: 'undo-2',
		order: 1,
		action: () => void vrMeasure().then((m) => m.vrUndoMeasurePoint())
	});
	register({
		id: 'measure:discard',
		group: 'measure',
		label: 'Discard',
		icon: 'trash-2',
		order: 2,
		closes: true,
		action: () => void vrMeasure().then((m) => m.vrDiscardMeasurement())
	});
	register({
		id: 'measure:snap',
		group: 'measure',
		label: 'Snap',
		icon: 'magnet',
		order: 3,
		active: () => measureSnapOn,
		action: () => void import('../measure').then((m) => m.measureSnap.update((on) => !on))
	});
	register({
		id: 'measure:done',
		group: 'measure',
		label: 'Done',
		icon: 'log-out',
		order: 4,
		closes: true,
		action: () => void vrMeasure().then((m) => m.stopVRMeasure())
	});
	// Selected ▸ Edit measurement — a kept measurement's points from the headset (the desktop's Tab)
	register({
		id: 'obj:editmeasure',
		group: 'object',
		label: 'Edit measurement',
		icon: 'ruler',
		order: 1,
		closes: true,
		visible: measurementSelected,
		action: () => {
			const uuid = /** @type {any} */ (get(selectedObject))?.uuid;
			if (uuid) void vrMeasure().then((m) => m.editVRMeasurement(uuid));
		}
	});
}

/** the Snap sector's dot reads this (the measure module loads lazily, so its store is mirrored once loaded) */
let measureSnapOn = true;
void (typeof window !== 'undefined' &&
	import('../measure').then((m) => m.measureSnap.subscribe((on) => (measureSnapOn = !!on))).catch(() => {}));
