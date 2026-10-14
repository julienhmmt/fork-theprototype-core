<script>
	// 42 I1 — Settings ▸ Interface ▸ Windows & chrome ▸ "Sticky panel headers". Its own file so the
	// settings page stays a one-line union. ON (the default) = the Configure Scene and Properties
	// headers — the title and "Filter properties" — stay on top while the properties scroll; OFF =
	// they scroll away with them. The lock button in each header flips that panel alone, so this row
	// reads MIXED when the two differ and a press sets both. LOCAL ($lib/panelHeaderPrefs).
	import SettingRow from '../../ui/SettingRow.svelte';
	import Toggle from '../../ui/Toggle.svelte';
	import { stickyPanelHeads, setAllStickyHeads } from '$lib/panelHeaderPrefs';

	const on = $derived($stickyPanelHeads.scene !== false && $stickyPanelHeads.properties !== false);
	const mixed = $derived(($stickyPanelHeads.scene !== false) !== ($stickyPanelHeads.properties !== false));
</script>

<SettingRow
	id="row-sticky-panel-heads"
	label="Sticky panel headers"
	description="Keep the Configure Scene and Properties title and “Filter properties” on top while you scroll. The lock in each header changes that panel alone."
	badge="This device"
	keywords="sticky header pin lock unlock filter properties configure scene title scroll space drawer sidebar panel"
>
	<Toggle id="sticky-panel-heads" label="Sticky panel headers" checked={on} {mixed} onchange={(/** @type {boolean} */ v) => setAllStickyHeads(mixed ? true : v)} />
</SettingRow>
