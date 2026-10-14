<script>
	// 42 I5 — Settings ▸ Interface ▸ Windows & chrome: the phone's three chrome switches, the same
	// stores as the switches at the bottom of More (where a phone user meets them). Its own file so
	// the settings page stays a one-line union. LOCAL (this device), $lib/ui/phonePrefs.
	import SettingRow from '../../ui/SettingRow.svelte';
	import Toggle from '../../ui/Toggle.svelte';
	import { phoneSelectionStrip, phoneDockTabs, phoneGrabHandle } from '$lib/ui/phonePrefs.js';
</script>

<SettingRow
	id="row-phone-strip"
	label="Phone selection toolbar"
	description="On a phone, Move, Rotate, Scale and Inspect float over a selection. Turn off when those tools sit on your bottom bar."
	badge="This device"
	keywords="phone mobile selection toolbar strip floating tools move rotate scale inspect popup bottom bar more"
>
	<Toggle id="setting-phone-strip" label="Phone selection toolbar" bind:checked={$phoneSelectionStrip} />
</SettingRow>
<SettingRow
	id="row-phone-dock-tabs"
	label="Phone dock tab row"
	description="On a phone, the row of tabs above docked windows. The bottom bar and More still switch between them."
	badge="This device"
	keywords="phone mobile dock docked tabs tab row hide windows strip more"
>
	<Toggle id="setting-phone-dock-tabs" label="Phone dock tab row" bind:checked={$phoneDockTabs} />
</SettingRow>
<SettingRow
	id="row-phone-grab"
	label="Phone grab handle"
	description="On a phone, the grab bar on docked windows and sheets. Off: drag the top edge to resize."
	badge="This device"
	keywords="phone mobile grab handle grabber bar drag resize drawer sheet dock edge more"
>
	<Toggle id="setting-phone-grab" label="Phone grab handle" bind:checked={$phoneGrabHandle} />
</SettingRow>
