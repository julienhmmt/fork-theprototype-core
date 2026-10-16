<script module>
	// what the I4 settings search matches this section by, beyond its row names
	export const keywords = ['export', 'publish', 'itch', 'itch.io', 'zip', 'html', 'badge', 'made with', 'fullscreen', 'fps', 'quality', 'vr', 'cdn', 'packs', 'embed', 'static host', 'ktx2', 'compress', 'quest', 'optimize', 'lod'];
	import { registerSettingsKeywords } from '$lib/settingsSearch';
	registerSettingsKeywords('show the made with theprototype badge', ['show made with theprototype badge', 'badge', 'logo']);
</script>

<script>
	// 36-export — THE EXPORT DEFAULTS, one section in its own file: the Publish / Export modal's
	// Settings tab renders it, and Settings ▸ Export registers it with one line. Every row persists
	// per device (exportStores.exportPrefs, safeStorage) and seeds the next export; the build reads
	// them, so changing one here changes what the next zip does.
	//
	// The badge row is ON and DISABLED on purpose — there is no way to switch it off, here or anywhere
	// (see MadeWithBadge.svelte); the row exists so the rule is visible where a person would look.
	// 37-settings (R21): rows on the redesign kit (toggles, a segmented Quality); same key.
	import SettingRow from '../ui/SettingRow.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import Segmented from '../ui/Segmented.svelte';
	import { exportPrefs, setExportPrefs } from '$lib/export/exportStores.js';
	import { saveOptions, setSaveOptions, EXPORT_PRESET_OPTIONS } from '$lib/saveOptions';

	const QUALITY = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'high', label: 'High' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'low', label: 'Low' }
	];
</script>

<div id="export-settings-section" class="contents" data-keywords={keywords.join(' ')}>
	<SettingRow id="row-export-badge" label="Show the Made with ThePrototype badge" badge="Always on" description="A small logo in the corner of play links, embeds and exported games. Please keep it.">
		<Toggle id="export-badge" label="Show the Made with ThePrototype badge (always on)" checked={true} disabled={true} />
	</SettingRow>
	<SettingRow id="row-export-fullscreen" label="Start fullscreen" description="The first Play press also asks the browser for fullscreen.">
		<Toggle id="export-start-fullscreen" label="Start fullscreen" checked={$exportPrefs.startFullscreen} onchange={(on) => setExportPrefs({ startFullscreen: on })} />
	</SettingRow>
	<SettingRow id="row-export-fps" label="Show FPS" description="The game starts with its frame counter on; players can switch it in the game menu.">
		<Toggle id="export-show-fps" label="Show FPS" checked={$exportPrefs.showFps} onchange={(on) => setExportPrefs({ showFps: on })} />
	</SettingRow>
	<SettingRow id="row-export-quality" label="Quality" description="The quality a player starts at. Auto steps down when frames run slow." wide>
		<Segmented id="export-quality" label="Quality" options={QUALITY} value={$exportPrefs.quality} onchange={(v) => setExportPrefs({ quality: v })} />
	</SettingRow>
	<SettingRow id="row-export-vr" label="Include VR button" description="On a headset browser the start card offers Enter VR.">
		<Toggle id="export-vr-button" label="Include VR button" checked={$exportPrefs.vrButton} onchange={(on) => setExportPrefs({ vrButton: on })} />
	</SettingRow>
	<SettingRow id="row-export-cdn" label="Use CDN for packs" description="A smaller zip: kit pieces load from the packs CDN, so the game needs internet.">
		<Toggle id="export-cdn-packs" label="Use CDN for packs" checked={$exportPrefs.useCdnForPacks} onchange={(on) => setExportPrefs({ useCdnForPacks: on })} />
	</SettingRow>
	<!-- 46 P3: the deferred "Compress textures" row became the export PRESET — one choice for this
	     bundle's scene, a Scene (.tpscene) save and a GLTF export, remembered on this device -->
	<SettingRow id="row-export-optimize" label="Optimize for" description="For Quest / web: KTX2-compressed textures at most 2048 px and an LOD chain — a smaller download and a fraction of the GPU memory on a headset." wide>
		<Segmented id="export-optimize" label="Optimize for" options={EXPORT_PRESET_OPTIONS} value={$saveOptions.exportPreset} onchange={(v) => setSaveOptions({ exportPreset: /** @type {any} */ (v) })} />
	</SettingRow>
</div>

<style>
	.contents {
		display: contents;
	}
</style>
