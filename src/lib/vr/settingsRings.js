// VR controls — the radial menu's SETTINGS rings (36-vr, U3), built from the one settings table: Settings ▸
// holds a ▸ sector per page (Comfort, Body, Controls, Display, Editing), the microphone as one cycling
// sector, All settings (the panel) and Exit VR; each page's ring holds one sector per setting. A sector
// shows the setting's name, its icon and its current value; a press flips / cycles / steps it and the
// ring STAYS OPEN so you watch the value change. A range (Height) is two sectors, − and +.
import { registerVRMenuEntry } from '../vrRadialMenu';
import { VR_SETTING_PAGES, vrSettingsOf, vrSettingRow, settingValueText, activateVRSetting } from './settingsSchema.js';
// 53 (A7): one-handed — the buttons that stay on the OTHER controller get root sectors
import { get } from 'svelte/store';
import { editorMode } from '../../stores/sceneStore';
import { oneHandedHand } from './bindings.js';
import { toggleVRMode } from './modes.js';
import { gameFeelActive } from '../gameFeel';
import { shellMenuAvailable, toggleShellMenu } from '../gameShell';
import { setShellVrRows } from '../shellVrRows';

/** 53 (A7): the comfort rows a headset's game menu repeats on its Accessibility page */
const SHELL_VR_ROWS = ['vignette', 'stance', 'oneHanded', 'recenter'];

/** sector order inside the Settings ring: the pages first, then Microphone, All settings, Exit VR */
const PAGE_ORDER = ['comfort', 'body', 'controls', 'display', 'editing'];

export function registerSettingsRings() {
	PAGE_ORDER.forEach((pageId, order) => {
		const page = VR_SETTING_PAGES.find((p) => p.id === pageId);
		if (!page) return;
		const ring = 'settings:' + pageId;
		registerVRMenuEntry({ id: 'nav:' + ring, group: 'settings', label: page.label, icon: page.icon, order, ring });
		let i = 0;
		for (const row of vrSettingsOf(pageId)) {
			if (row.kind === 'range') {
				for (const dir of [-1, 1]) {
					registerVRMenuEntry({
						id: `set:${row.id}:${dir < 0 ? '-' : '+'}`,
						group: ring,
						label: `${row.label} ${dir < 0 ? '−' : '+'}`,
						icon: dir < 0 ? 'arrow-down' : 'arrow-up',
						value: () => settingValueText(row),
						order: i++,
						action: () => activateVRSetting(row.id, dir)
					});
				}
				continue;
			}
			registerVRMenuEntry({
				id: 'set:' + row.id,
				group: ring,
				label: row.label,
				icon: row.icon,
				value: row.kind === 'action' ? undefined : () => settingValueText(row),
				order: i++,
				active: row.kind === 'toggle' ? () => !!row.get?.() : undefined,
				// a row that opens a panel closes the ring (the R9 rule); every other row keeps it up
				closes: row.id === 'remap',
				action: () => activateVRSetting(row.id, 1)
			});
		}
	});
	// 53 (A7): the game menu's Accessibility page in a headset repeats the comfort rows (one write path:
	// the settings table's own activate)
	setShellVrRows({
		rows: () =>
			SHELL_VR_ROWS.flatMap((id) => {
				const row = vrSettingRow(id);
				return row ? [row] : [];
			}).map((row) => ({
					id: 'vr:' + row.id,
					label: row.label,
					type: row.kind === 'action' ? 'action' : row.kind === 'toggle' ? 'toggle' : 'choice',
					value: row.get?.(),
					display: row.kind === 'action' ? row.label : settingValueText(row)
				})),
		press: (id, dir) => {
			if (!SHELL_VR_ROWS.includes(id)) return false;
			activateVRSetting(id, dir);
			return true;
		}
	});
	// 53 (A7): ONE-HANDED, the mode and game-menu buttons live on the other controller — so the root
	// ring offers them (Ping is in Tools ▸ already); hidden when both hands are in play
	registerVRMenuEntry({
		id: 'onehand:mode',
		label: () => (get(editorMode) === 'interact' ? 'Edit mode' : 'Interact'),
		icon: () => (get(editorMode) === 'interact' ? 'pencil' : 'hand'),
		order: 7.5,
		visible: () => !!oneHandedHand(),
		closes: true,
		action: () => toggleVRMode()
	});
	registerVRMenuEntry({
		id: 'onehand:pause',
		label: 'Game menu',
		icon: 'gamepad-2',
		order: 7.6,
		visible: () => !!oneHandedHand() && gameFeelActive() && shellMenuAvailable(),
		closes: true,
		action: () => toggleShellMenu()
	});
	// the one Voice setting is a single cycling sector on the Settings ring itself (a ring of one
	// sector would be a dead end)
	const mic = vrSettingRow('mic');
	if (mic)
		registerVRMenuEntry({
			id: 'set:mic',
			group: 'settings',
			label: mic.label,
			icon: mic.icon,
			value: () => settingValueText(mic),
			order: 10,
			action: () => activateVRSetting('mic', 1)
		});
}
