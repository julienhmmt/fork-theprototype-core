<script module>
	// 53 — what the settings search matches beyond the row names (`data-keywords` on the root)
	export const keywords = ['accessibility', 'a11y', 'low vision', 'zoom', 'bigger', 'larger', 'smaller', 'text size', 'font size', 'magnify', 'motion', 'animation', 'vestibular', 'reduce motion', 'captions', 'subtitles', 'deaf', 'hard of hearing', 'hearing', 'high contrast', 'contrast', 'colour blind', 'color blind', 'theme'];
</script>

<script>
	// 53 — Settings ▸ Accessibility. 53-scale creates the section (UI scale; reduced motion and the
	// editor's Captions switch follow); the other roadmap-53 lanes add their rows here with one
	// `<SettingRow>` each (53-int unions them). Everything on this page is LOCAL to this device.
	import Section from '../../ui/Section.svelte';
	import SettingRow from '../../ui/SettingRow.svelte';
	import ThemedSelect from '../../ui/ThemedSelect.svelte';
	import Segmented from '../../ui/Segmented.svelte';
	import { uiScale, UI_SCALES, DEFAULT_UI_SCALE } from '$lib/uiScale';
	import { motionPref, MOTION_PREFS, systemReducedMotion, normalizeMotion } from '$lib/motion';
	import Toggle from '../../ui/Toggle.svelte';
	import { editorCaptions } from '$lib/captionsPref';
	import { theme } from '$lib/themes';

	// 53-int (53-contrast Q1): the High contrast THEME as one switch here — no new state and no new
	// key, it writes the same `$theme` Settings ▸ Interface ▸ Theme does. Off goes back to the theme
	// that was on before (remembered for this page's life), else Dark, the default.
	/** @type {string|null} */
	let themeBeforeContrast = null;
	function setHighContrast(/** @type {boolean} */ on) {
		if (on) {
			if ($theme !== 'contrast') themeBeforeContrast = $theme;
			theme.set('contrast');
		} else if ($theme === 'contrast') {
			theme.set(themeBeforeContrast && themeBeforeContrast !== 'contrast' ? themeBeforeContrast : 'dark');
		}
	}

	const scaleItems = UI_SCALES.map((p) => ({ value: p, name: p === DEFAULT_UI_SCALE ? `${p} % (default)` : `${p} %` }));
</script>

<div class="settings-page-body" data-keywords={keywords.join(' ')}>
	<Section variant="card" label="Size" badge="This device">
		<SettingRow
			id="row-ui-scale"
			label="UI scale"
			description="Makes every panel, menu, toolbar and the phone layout bigger or smaller. The 3D view is not scaled."
			keywords="zoom size bigger larger smaller text font magnify"
		>
			<ThemedSelect id="ui-scale" items={scaleItems} value={$uiScale} onchange={(v) => uiScale.set(v)} />
		</SettingRow>
	</Section>
	<Section variant="card" label="Colour" badge="This device">
		<SettingRow
			id="row-high-contrast"
			label="High contrast"
			description="Switches to the High contrast theme: black panels, bright text and thicker outlines and handles. The same choice as Interface ▸ Theme; status colours are colour-blind safe in every theme."
			keywords="high contrast theme low vision colour blind color blind contrast"
		>
			<Toggle id="high-contrast" label="High contrast" checked={$theme === 'contrast'} onchange={setHighContrast} />
		</SettingRow>
	</Section>
	<Section variant="card" label="Movement" badge="This device">
		<SettingRow
			id="row-motion"
			label="Motion"
			description={`Reduce makes sheet swipes, dock slides, toasts, the camera's fly-to and pulsing indicators instant. Follow system uses your device's setting (now: ${$systemReducedMotion ? 'reduced' : 'full motion'}).`}
			keywords="reduce motion animation animations transitions vestibular dizzy instant prefers-reduced-motion"
		>
			<Segmented id="motion" label="Motion" options={MOTION_PREFS} value={$motionPref} onchange={(v) => motionPref.set(normalizeMotion(v))} />
		</SettingRow>
	</Section>
	<Section variant="card" label="Hearing" badge="This device">
		<SettingRow
			id="row-captions"
			label="Show captions"
			description="Shows a caption line for sounds that have one — Timeline audio clips and Sound nodes — everywhere, the editor included. Players can also turn captions on in a game's menu ▸ Accessibility."
			keywords="captions subtitles deaf hard of hearing sound audio timeline"
		>
			<Toggle id="editor-captions" label="Show captions" bind:checked={$editorCaptions} />
		</SettingRow>
	</Section>
</div>
