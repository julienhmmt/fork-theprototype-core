// 46 B1/B2 — THE BUDGET METER's runtime: which target this device judges against (LOCAL), the
// sampler that costs the scene (budgetMeterCore.js, pure) and the one way into Statistics ▸ Budget.
//
// ONE SOURCE: the numbers are perf/budgets.json — the very file `perf-games.cjs --check` gates every
// game and level with. Quest IS the gate's `defaults`; phone and desktop sit beside it in `targets`
// (scripts/perfBudget.cjs validates that the two cannot disagree). Imported by NAME so the bundle
// carries those two keys, not the allow-list.
//
// LOCAL, every bit of it: a target is a fact about where THIS person means to ship, and a reading is
// this tab's view of the scene — nothing here replicates, saves or undoes.
//
// The sampler runs only while something shows it (the chip, the Statistics window): `startBudgetMeter`
// is refcounted and returns its stop. A reading is a scene-graph walk (no GPU, no render), taken at
// most once a second and on a scene change (debounced), never in Play — the chip is hidden there.
import { writable, get } from 'svelte/store';
import { globalScene, objectsGroup, isLocked } from '../stores/sceneStore';
import { safeStorage } from './safeStorage';
import { statsOpen } from './sceneBudget';
import { kitInstancingEnabled } from './kitInstancing';
import { kitMeshSource } from './packRefs';
import { lodStats } from './lod';
import { ENV_ROOT } from './environment';
import { moduleGroupList } from './moduleContent';
import { MODULE_WORLD_ROOT } from './moduleWorld';
import { defaults, targets } from '../../perf/budgets.json';
import { resolveTargets, measureScene, judgeCost, TARGET_IDS } from './budgetMeterCore';

/** the three targets, Quest = the gate's defaults */
export const TARGETS = resolveTargets({ defaults, targets });

const TARGET_KEY = 'budgetTarget';

/** @returns {import('./budgetMeterCore').TargetId} */
function storedTarget() {
	try {
		const v = safeStorage.getItem(TARGET_KEY);
		return /** @type {any} */ (TARGET_IDS.includes(/** @type {any} */ (v)) ? v : 'quest');
	} catch {
		return 'quest';
	}
}

/** The device the chip judges for: 'quest' (default — the gate's target) | 'phone' | 'desktop'. LOCAL.
 * @type {import('svelte/store').Writable<import('./budgetMeterCore').TargetId>} */
export const budgetTarget = writable(storedTarget());
budgetTarget.subscribe((id) => {
	try {
		if (TARGET_IDS.includes(id)) safeStorage.setItem(TARGET_KEY, id);
	} catch {
		/* private mode: the pick lasts the session */
	}
});

/** @param {string} id */
export function setBudgetTarget(id) {
	if (TARGET_IDS.includes(/** @type {any} */ (id))) budgetTarget.set(/** @type {any} */ (id));
}

/**
 * The latest reading: the scene cost (null before the first one).
 * @type {import('svelte/store').Writable<null | (ReturnType<typeof measureScene> & {at: number})>}
 */
export const sceneCost = writable(null);

/** A POKE (a counter, so the same request twice still lands): Statistics scrolls its Budget section
 * into view and flashes it. Written by `openBudget`, read by StatsOverlay. */
export const budgetReveal = writable(0);

/** The chip's click: Statistics, on its Budget section (the phone docks it as a tab — statsOpen is
 * what every way in sets, so this lands wherever Statistics lives). */
export function openBudget() {
	sampleBudget();
	statsOpen.set(true);
	budgetReveal.update((n) => n + 1);
}

/** the roots a game draws: the objects, the environment rig, module content. Everything else at the
 * scene root (grid, gizmo, helpers, kit placeholders, edit overlays) is the editor's. */
function rootsOf(/** @type {any} */ scene, /** @type {any} */ group) {
	/** @type {{object: any, kind: 'objects'|'environment'|'module', label?: string}[]} */
	const roots = [];
	if (group) roots.push({ object: group, kind: 'objects' });
	const env = scene?.getObjectByName?.(ENV_ROOT);
	if (env) roots.push({ object: env, kind: 'environment', label: 'Environment (sky, sun, ground)' });
	const seen = new Set();
	const world = scene?.getObjectByName?.(MODULE_WORLD_ROOT);
	for (const entry of moduleGroupList()) {
		const root = scene?.getObjectByName?.(entry.name);
		if (!root || seen.has(root)) continue;
		if (root.parent !== scene && root.parent !== world) continue;
		seen.add(root);
		roots.push({ object: root, kind: 'module', label: entry.label || entry.moduleName || entry.name });
	}
	return roots;
}

/** Take a reading now (the chip opening Statistics, the suite). */
export function sampleBudget() {
	/** @type {any} */
	const group = get(objectsGroup);
	/** @type {any} */
	let scene = get(globalScene);
	if (!scene && group) {
		scene = group;
		while (scene.parent) scene = scene.parent;
	}
	if (!group && !scene) return null;
	/** @type {Set<string>} */
	let lodded = new Set();
	try {
		lodded = new Set((lodStats().meshes ?? []).filter((m) => m.levels).map((m) => m.uuid));
	} catch {
		/* LOD not started (a bare test page) */
	}
	const reading = measureScene({
		roots: rootsOf(scene, group),
		background: scene?.background,
		environment: scene?.environment,
		kitInstancing: get(kitInstancingEnabled),
		kitSourceOf: kitMeshSource,
		hasLod: (/** @type {any} */ mesh) => {
			if (lodded.has(mesh.uuid)) return true;
			for (let n = mesh; n && n !== group; n = n.parent) if (n.userData?.lod) return true;
			return false;
		}
	});
	const out = { ...reading, at: Date.now() };
	sceneCost.set(out);
	return out;
}

/** The verdict for a reading against a target id (the chip and the Budget section share it).
 * @param {any} reading @param {import('./budgetMeterCore').TargetId} id */
export function verdictFor(reading, id) {
	return judgeCost(reading?.totals ?? {}, TARGETS[id] ?? TARGETS.quest);
}

const SAMPLE_MS = 1000;
const POKE_MS = 250;
let users = 0;
/** @type {any} */ let timer = null;
/** @type {any} */ let poke = null;
/** @type {(() => void) | null} */ let unsubscribe = null;

function tick() {
	if (get(isLocked) === true) return; // Play: nobody is looking, and the scene is the game's
	sampleBudget();
}

/** Keep the reading fresh while something shows it. Refcounted; returns the stop. */
export function startBudgetMeter() {
	users++;
	if (users === 1) {
		tick();
		timer = setInterval(tick, SAMPLE_MS);
		let first = true;
		unsubscribe = objectsGroup.subscribe(() => {
			// the subscribe call itself runs the callback once — the tick above already read it
			if (first) {
				first = false;
				return;
			}
			clearTimeout(poke);
			poke = setTimeout(tick, POKE_MS);
		});
	}
	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		users = Math.max(0, users - 1);
		if (users === 0) {
			clearInterval(timer);
			clearTimeout(poke);
			unsubscribe?.();
			timer = poke = unsubscribe = null;
		}
	};
}

/** for the suite: is the sampler running, and for how many */
export function budgetMeterUsers() {
	return users;
}
