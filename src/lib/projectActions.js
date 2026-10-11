// 41b H14 — Settings ▸ Interface ▸ "Project actions": how the burger menu's PROJECT section is laid out.
//   compact  a two-column grid at list-row height — [New from template…] / [Load][Save ▾] / [Import][Export…]
//   list     the 1.32 layout: one row per action, the Project | Scene | ⚙ format row under Save
//   auto     the device default: List on the phone shell, Compact on desktop and an unfolded phone
// LOCAL (this device), like Density. A LEAF; the absent key is Auto, so a fresh device and a reset agree.
import { writable, derived } from 'svelte/store';
import { safeStorage } from './safeStorage';
import { phoneShellActive } from './ui/phoneShell.js';

export const PROJECT_ACTIONS_KEY = 'ui:projectActions';
export const PROJECT_ACTIONS = [
	{ value: 'auto', label: 'Auto' },
	{ value: 'compact', label: 'Compact' },
	{ value: 'list', label: 'List' }
];
export const DEFAULT_PROJECT_ACTIONS = 'auto';

/** @param {unknown} v @returns {string} */
export function normalizeProjectActions(v) {
	return PROJECT_ACTIONS.some((o) => o.value === v) ? /** @type {string} */ (v) : DEFAULT_PROJECT_ACTIONS;
}

/** 'auto' | 'compact' | 'list' */
export const projectActions = writable(normalizeProjectActions(safeStorage.getItem(PROJECT_ACTIONS_KEY)));

projectActions.subscribe((v) => {
	const value = normalizeProjectActions(v);
	if (value === DEFAULT_PROJECT_ACTIONS) safeStorage.removeItem(PROJECT_ACTIONS_KEY);
	else safeStorage.setItem(PROJECT_ACTIONS_KEY, value);
});

/** @param {string} pref @param {boolean} phone @returns {'compact' | 'list'} */
export function resolveProjectActions(pref, phone) {
	const v = normalizeProjectActions(pref);
	if (v === 'auto') return phone ? 'list' : 'compact';
	return /** @type {'compact' | 'list'} */ (v);
}

/** the layout the burger draws now */
export const projectActionsLayout = derived([projectActions, phoneShellActive], ([pref, phone]) => resolveProjectActions(pref, phone));
