<script>
	// 38 R7: the shared ModalDialog (WindowChrome size="modal") — "Install from file…" in the
	// header, kit Tabs with counts + a filter in the strip under it, modules as LIST ROWS (name,
	// mono version, description, actions, the enable Toggle) instead of large cards. Tokens only.
	import Icon from '../ui/Icon.svelte';
	import ModalDialog from '../ui/ModalDialog.svelte';
	import Button from '../ui/Button.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import Checkbox from '../ui/Checkbox.svelte';
	import Tabs from '../ui/Tabs.svelte';
	import SearchField from '../ui/SearchField.svelte';
	import Badge from '../ui/Badge.svelte';
	import EmptyState from '../ui/EmptyState.svelte';
	import { modulesOpen, hidePanels, restorePanels, showToast } from '../../stores/appStore.js';
	import { sceneCommand } from '$lib/commandsHandler.svelte';
	import { modulePrimitiveGroups } from '$lib/moduleSDK';
	import { MODULE_CATEGORIES } from '$lib/moduleGallery';
	import { tagUnion, matchesTags } from '$lib/sceneTemplates';

	// like Settings: side panels hide while the manager is open, restore after
	$: if ($modulesOpen) {
		hidePanels();
	} else if ($modulesOpen === false) {
		restorePanels();
	}

	// C5.1: Browse filters. LEGACY-mode file, so these are `let` + `$:`, never runes —
	// one $state here would flip the whole component and break the build.
	let galleryCategory = 'all';
	/** @type {string[]} */
	let galleryTags = [];
	$: galleryByCategory =
		galleryCategory === 'all'
			? $galleryModules
			: $galleryModules.filter((/** @type {any} */ e) => (e.category ?? 'tool') === galleryCategory);
	// chips come from the entries the category left, so they can never offer a tag that
	// filters to nothing; ONE chip component's behaviour, shared with the Templates modal
	$: galleryChips = tagUnion(galleryByCategory);
	$: galleryShown = galleryByCategory.filter((/** @type {any} */ e) => matchesTags(e, galleryTags));
	// a category that no longer contains the picked tags would show an empty list with
	// no way back, so switching category drops them (the Templates-modal tab rule)
	/** @param {string} next */
	function pickGalleryCategory(next) {
		galleryCategory = next;
		galleryTags = [];
	}
	/** @param {string} tag */
	function toggleGalleryTag(tag) {
		galleryTags = galleryTags.includes(tag) ? galleryTags.filter((t) => t !== tag) : [...galleryTags, tag];
	}

	// primitives registered by a module spawn from its card (not the sidebar)
	$: primitivesByModule = $modulePrimitiveGroups
		.flatMap((group) => group.items)
		.reduce((map, item) => {
			(map[item.moduleId] ??= []).push(item);
			return map;
		}, {});
	import {
		moduleMenuItems,
		disabledModules,
		setModuleEnabled,
		isModuleLoaded,
		loadedModulesChanged
	} from '$lib/moduleSDK';
	import { coreModules } from '../../modules/index.js';
	import {
		userModules,
		installZip,
		installUrl,
		activateUserModule,
		updateUserModule,
		removeUserModule,
		reloadUserModule,
		setDevUrl,
		setDevPoll,
		devSourceOf,
		devPolling,
		installStatus,
		clearInstallStatus,
		normalizeRepoUrl,
		lastInstalled
	} from '$lib/userModules';
	import { deactivateModule } from '$lib/moduleSDK';
	import {
		galleryModules,
		galleryState,
		galleryInstallUrl,
		loadModuleGallery,
		versionNewer
	} from '$lib/moduleGallery';
	import { staleModuleList, updatingModules, updateStaleModule } from '$lib/staleModules';
	import { installJobs, installModuleJob } from '$lib/moduleInstallJobs';
	let tab = 'core';
	// 34 R1: an installed module older than this build expects — opening the manager lands
	// on the User tab, where the row with its Update button is (once per open)
	let staleLanded = false;
	$: if (!$modulesOpen) staleLanded = false;
	$: if ($modulesOpen && $staleModuleList.length && !staleLanded) {
		staleLanded = true;
		tab = 'user';
	}
	let installUrlValue = '';
	let installBusy = false;
	// 41b H9: Browse installs are per-module JOBS (moduleInstallJobs) — the old single
	// `galleryBusy` id was overwritten by every next click

	// 41b H8: a clamped description expands IN PLACE on tap (chevron, tap again collapses) —
	// touch has no hover, so no tooltip. Keys are `<tab>:<id>`, LOCAL view state.
	/** @type {Record<string, boolean>} */
	let descOpen = {};
	/** descriptions that do not fit their two lines @type {Record<string, boolean>} */
	let descClamped = {};
	/** @param {string} key */
	function toggleDesc(key) {
		descOpen = { ...descOpen, [key]: !descOpen[key] };
	}
	/** Measures whether a clamped description hides text. @param {HTMLElement} node @param {string} key */
	function clampWatch(node, key) {
		const measure = () => {
			if (descOpen[key]) return; // open = not clamped, so it cannot be measured; keep the chevron
			const over = node.scrollHeight > node.clientHeight + 1;
			if (!!descClamped[key] !== over) descClamped = { ...descClamped, [key]: over };
		};
		const ro = new ResizeObserver(measure);
		ro.observe(node);
		measure();
		return {
			/** @param {string} next */
			update(next) {
				key = next;
				measure();
			},
			destroy() {
				ro.disconnect();
			}
		};
	}

	async function runUrlInstall() {
		if (installBusy) return;
		if (!installUrlValue.trim()) {
			// the button is never disabled (see the markup), so say why nothing
			// happened — in the same place every other install outcome appears
			installStatus.set({ kind: 'error', text: 'Paste a module URL first', detail: 'Or use Choose .zip… to install a packaged module.' });
			document.getElementById('install-module-url')?.focus();
			return;
		}
		installBusy = true;
		const ok = await installUrl(installUrlValue);
		installBusy = false;
		if (ok) installUrlValue = ''; // keep a failed URL so it can be corrected
	}

	// Installing from Browse leaves you on Browse (so you can install several);
	// the User tab's count badge is what says "it went over there", and opening
	// that tab scrolls to the new card and flashes it.
	let prevUserCount = -1;
	let userTabPulse = false;
	$: pulseIfGrown($userModules.length);
	/** @param {number} count */
	function pulseIfGrown(count) {
		if (prevUserCount >= 0 && count > prevUserCount) {
			userTabPulse = true;
			setTimeout(() => (userTabPulse = false), 1600);
		}
		prevUserCount = count;
	}

	$: revealInstalled(tab, $lastInstalled);
	/** @param {string} activeTab @param {string | null} id */
	function revealInstalled(activeTab, id) {
		if (activeTab !== 'user' || !id || typeof document === 'undefined') return;
		// one frame for the card to render before scrolling to it
		setTimeout(() => {
			const card = document.getElementById('user-module-card-' + id);
			if (!card) return;
			card.scrollIntoView({ block: 'center', behavior: 'smooth' });
			card.classList.add('just-installed');
			setTimeout(() => card.classList.remove('just-installed'), 2200);
			lastInstalled.set(null);
		}, 60);
	}

	// as-you-type: is this URL already an installed module? (installing updates it)
	$: typedBase = installUrlValue.trim() ? normalizeRepoUrl(installUrlValue) : '';
	$: alreadyInstalled = typedBase
		? $userModules.find((record) => record.source === typedBase)
		: null;

	// 17-A3: installed lookup for gallery card state (dim + Update)
	$: installedById = $userModules.reduce((map, record) => {
		map[record.id] = record;
		return map;
	}, {});

	/** @param {any} entry */
	function installFromGallery(entry) {
		return installModuleJob(entry.id, galleryInstallUrl(entry));
	}

	// raw sources of every core module, bundled so users can download examples
	const sources = import.meta.glob('../../modules/*/*', { query: '?raw', import: 'default' });

	/** @param {any} mod */
	async function downloadModule(mod) {
		const { zipSync, strToU8 } = await import('fflate');
		/** @type {Record<string, Uint8Array>} */
		const files = {
			'manifest.json': strToU8(
				JSON.stringify(
					{ id: mod.id, name: mod.name, version: mod.version, description: mod.description ?? '', entry: 'module.js' },
					null,
					2
				)
			)
		};
		for (const [path, loader] of Object.entries(sources)) {
			const match = path.match(/modules\/([^/]+)\/(.+)$/);
			if (!match || match[1] !== mod.id) continue;
			files[match[2]] = strToU8(String(await loader()));
		}
		const blob = new Blob([zipSync(files)], { type: 'application/zip' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = mod.id + '.module.zip';
		link.click();
		URL.revokeObjectURL(link.href);
	}
	// 38 R7: the tab strip (counts beside the labels) and the filter, which narrows whatever
	// the active tab lists by name / id / description / author / tags. LOCAL view state.
	$: tabDefs = [
		{ id: 'core', label: 'Core', count: coreModules.length },
		{ id: 'user', label: 'User', count: $userModules.length || undefined },
		{ id: 'browse', label: 'Browse' }
	];
	/** @type {HTMLElement | undefined} */
	let mmBody;
	/** @param {string} next */
	function pickTab(next) {
		// 41b H10: each tab opens at its top. The modal has ONE scroller, so a Browse list
		// scrolled to its end left Core (a third of the height) drawn below the view.
		if (next !== tab) mmBody?.closest('.md-body')?.scrollTo({ top: 0 });
		tab = next;
		if (next === 'browse') loadModuleGallery();
	}
	let query = '';
	/** @param {any} m @param {string} q */
	function matchQ(m, q) {
		if (!q) return true;
		const hay = [m.name, m.id, m.description, m.author, ...(m.tags ?? [])].join(' ').toLowerCase();
		return hay.includes(q);
	}
	$: q = query.trim().toLowerCase();
	$: coreVisible = coreModules.filter((/** @type {any} */ m) => matchQ(m, q));
	$: userVisible = $userModules.filter((/** @type {any} */ m) => matchQ(m, q));
	$: galleryVisible = galleryShown.filter((/** @type {any} */ m) => matchQ(m, q));
</script>

<!-- the ONE hidden picker both "Install from file…" (header) and "Choose .zip…" (User tab) open;
     always mounted, so the header button works from any tab -->
<input
	type="file"
	id="install-module-zip"
	style="display: none"
	accept=".zip"
	on:change={async (e) => {
		// capture the input BEFORE awaiting: `currentTarget` is only valid
		// during dispatch and is null once the handler resumes
		const input = e.currentTarget;
		const file = input.files?.[0];
		if (file) {
			tab = 'user';
			await installZip(file);
		}
		input.value = '';
	}}
/>

<!-- 41b H8: ONE description cell for every tab — clamped to two lines; when the text does not fit,
     a chevron (and a tap on the text itself) expands it in place, and a second tap collapses it.
     Touch has no hover, so never a tooltip. -->
{#snippet moduleDesc(/** @type {string} */ key, /** @type {string} */ text)}
	<!-- clamped: the whole description is the tap target (a 44px button beside it would squeeze
	     a phone's ~190px text column), with a chevron at its end that says which way it goes -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
	<div
		class="mm-desc-wrap"
		class:mm-desc-tappable={descClamped[key]}
		role={descClamped[key] ? 'button' : undefined}
		tabindex={descClamped[key] ? 0 : undefined}
		aria-expanded={descClamped[key] ? !!descOpen[key] : undefined}
		title={descClamped[key] ? (descOpen[key] ? 'Show less' : 'Show the full description') : undefined}
		data-desc-toggle={key}
		on:click={() => descClamped[key] && toggleDesc(key)}
		on:keydown={(e) => {
			if (descClamped[key] && (e.key === 'Enter' || e.key === ' ')) {
				e.preventDefault();
				toggleDesc(key);
			}
		}}
	>
		<p class="mm-desc" class:mm-desc-open={descOpen[key]} data-desc-key={key} use:clampWatch={key}>{text}</p>
		{#if descClamped[key]}
			<span class="mm-desc-chevron" aria-hidden="true">
				<Icon name={descOpen[key] ? 'chevron-up' : 'chevron-down'} size={16} />
			</span>
		{/if}
	</div>
{/snippet}

<ModalDialog
	title="Modules"
	bind:open={$modulesOpen}
	onkeydown={(/** @type {KeyboardEvent} */ e) => {
		if (e.key === 'Escape') modulesOpen.set(false);
	}}
	width="md"
	padded={false}
	data-user-pulse={userTabPulse || undefined}
>
	{#snippet actions()}
		<Button variant="outline" size="sm" icon="upload" onclick={() => document.getElementById('install-module-zip')?.click()}>
			Install from file…
		</Button>
	{/snippet}
	{#snippet bar()}
		<Tabs
			data-wrap
			tabs={tabDefs}
			idPrefix="modules"
			label="Modules"
			value={tab}
			onchange={(/** @type {string} */ next) => pickTab(next)}
		>
			{#snippet actions()}
				<div class="mm-filter">
					<SearchField size="sm" placeholder="Filter modules" label="Filter modules" id="modules-filter" bind:value={query} />
				</div>
			{/snippet}
		</Tabs>
	{/snippet}

	<div class="mm-body" bind:this={mmBody}>
	{#if tab === 'browse'}
		<div id="module-gallery-tab" class="mm-stack">
			<p class="mm-trust">
				<Icon name="circle-alert" size={16} aria-hidden="true" />
				<span>Modules run unsandboxed in your session — install only sources you trust. This list comes from github.com/theprototype-app/modules.</span>
			</p>
			{#if $galleryState === 'loading'}
				<p class="mm-quiet">Loading the module list…</p>
			{:else if $galleryModules.length === 0}
				<EmptyState
					icon="globe"
					title="The gallery is unavailable right now"
					description="Offline? Installs by zip or URL in the User tab still work."
				/>
			{:else}
				<!-- C5.1: category filter + tag chips. A game and a tool are different
				     things to go looking for, and the list is long enough now that
				     "which of these is a game" was guesswork. -->
				<div id="gallery-filters" class="mm-chips" role="group" aria-label="Filter the gallery">
					<button
						type="button"
						class="mm-chip"
						data-gal-cat="all"
						aria-pressed={galleryCategory === 'all'}
						on:click={() => pickGalleryCategory('all')}>All</button
					>
					{#each MODULE_CATEGORIES as cat (cat)}
						<button
							type="button"
							class="mm-chip mm-chip-cat"
							data-gal-cat={cat}
							aria-pressed={galleryCategory === cat}
							on:click={() => pickGalleryCategory(cat)}>{cat}s</button
						>
					{/each}
					{#if galleryChips.length}
						<span class="mm-chip-sep" aria-hidden="true"></span>
						{#each galleryChips as tag (tag)}
							<button
								type="button"
								class="mm-chip"
								data-gal-tag={tag}
								aria-pressed={galleryTags.includes(tag)}
								on:click={() => toggleGalleryTag(tag)}>{tag}</button
							>
						{/each}
					{/if}
				</div>
				{#if galleryVisible.length === 0}
					<p id="gallery-filtered-empty" class="mm-quiet">Nothing matches that filter.</p>
				{:else}
					<div class="mm-list">
						{#each galleryVisible as entry (entry.id)}
							{@const installed = installedById[entry.id]}
							{@const job = $installJobs[entry.id]}
							{@const newer = !!installed && versionNewer(entry.version, installed.version)}
							<div
								id={'gallery-card-' + entry.id}
								class="mm-row"
								class:mm-dim={installed && !newer && !job}
								data-install-state={job?.state ?? (installed ? (newer ? 'update' : 'installed') : 'idle')}
							>
								<div class="mm-main">
									<div class="mm-title">
										<span class="mm-name">{entry.name}</span>
										<span class="mm-ver">v{entry.version}</span>
										{#if entry.author}<span class="mm-by">by {entry.author}</span>{/if}
									</div>
									{@render moduleDesc('browse:' + entry.id, entry.description)}
								</div>
								<div class="mm-actions">
									{#if job?.state === 'installing'}
										<!-- 41b H9: THIS card's own job — another card's click never resets it -->
										<Button variant="secondary" size="sm" icon="loader-circle" disabled aria-busy="true" title={job.text}>
											{installed ? 'Updating…' : 'Installing…'}
										</Button>
									{:else if job?.state === 'error'}
										<Button variant="secondary" size="sm" icon="rotate-cw" data-install-retry={entry.id} onclick={() => installFromGallery(entry)}>
											Retry
										</Button>
									{:else if !installed}
										<Button variant="secondary" size="sm" disabled={!entry.source} onclick={() => installFromGallery(entry)}>
											Install
										</Button>
									{:else if newer}
										<Button variant="secondary" size="sm" onclick={() => installFromGallery(entry)}>
											{'Update to v' + entry.version}
										</Button>
									{:else}
										<Badge tone="ok">Installed</Badge>
									{/if}
								</div>
								{#if job?.state === 'error'}
									<!-- the reason stays on THIS card until Retry; the raw message is one tap away -->
									<div class="mm-extra mm-error" role="alert" data-install-error={entry.id}>
										<span class="mm-error-line">
											<Icon name="circle-alert" size={16} aria-hidden="true" />
											<span>{job.reason}</span>
										</span>
										<details class="mm-error-details">
											<summary>Details</summary>
											<span class="mm-error-raw">{job.detail}</span>
										</details>
									</div>
								{/if}
								{#if entry.category === 'game' || entry.tags?.length}
									<div class="mm-extra mm-tags">
										{#if entry.category === 'game'}
											<Badge tone="scope" data-gal-badge={entry.id}>game</Badge>
										{/if}
										{#each entry.tags ?? [] as tag (tag)}
											<Badge tone="neutral">{tag}</Badge>
										{/each}
										{#if entry.template}
											<!-- a game ships a scene too: point at it rather than leaving the
											     player to guess which template goes with the module -->
											<Badge tone="neutral" title={'Scene: ' + entry.template}>+ scene</Badge>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{:else if tab === 'core'}
		<div class="mm-stack">
			{#if coreVisible.length === 0}
				<p class="mm-quiet">No core module matches “{query}”.</p>
			{/if}
			<div class="mm-list">
			{#key $loadedModulesChanged}
				{#each coreVisible as mod (mod.id)}
					{@const enabled = !$disabledModules.includes(mod.id)}
					{@const menuItems = isModuleLoaded(mod.id) && enabled ? $moduleMenuItems.filter((item) => item.moduleId === mod.id) : []}
					{@const prims = isModuleLoaded(mod.id) && enabled ? (primitivesByModule[mod.id] ?? []) : []}
					<div id={'module-card-' + mod.id} class="mm-row">
						<div class="mm-main">
							<div class="mm-title">
								<span class="mm-name">{mod.name}</span>
								<span class="mm-ver">v{mod.version}</span>
								{#if !enabled && isModuleLoaded(mod.id)}
									<Badge tone="warn">reload to disable</Badge>
								{/if}
							</div>
							{@render moduleDesc('core:' + mod.id, mod.description ?? '')}
						</div>
						<!-- 41b H8: download + the switch on the RIGHT of the name/description -->
						<div class="mm-actions">
							<Button variant="icon" size="sm" icon="download" label="Download as example" title="Download as example" onclick={() => downloadModule(mod)} />
							<span class="mm-sep" aria-hidden="true"></span>
							<Toggle
								id={'enable-module-' + mod.id}
								label={'Enable ' + mod.name}
								checked={enabled}
								onchange={(/** @type {boolean} */ on) => setModuleEnabled(mod, on)}
							/>
						</div>
						{#if menuItems.length || prims.length}
							<!-- the module's OWN actions (Button & door "+ Button", Pong spawn/remove) stay under the
							     name and description -->
							<div class="mm-extra">
								{#each menuItems as item}
									<Button variant="secondary" size="sm" onclick={item.action}>{item.label}</Button>
								{/each}
								{#each prims as primitive}
									<Button variant="secondary" size="sm" title={primitive.command} onclick={() => sceneCommand(primitive.command)}>
										+ {primitive.label}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			{/key}
			</div>
		</div>
	{:else}
		<div id="user-modules-tab" class="mm-stack">
			<p class="mm-trust">
				<Icon name="circle-alert" size={16} aria-hidden="true" />
				<span>Modules run code inside your session — install only from sources you trust. Every peer needs the same modules for shared behaviour to match.</span>
			</p>
			<!-- ONE install control: paste a URL and press Install, or pick a .zip. Wraps: the field
			     keeps the whole first line and the buttons drop to the next row when there is not
			     enough width. -->
			<div class="mm-install">
				<input
					id="install-module-url"
					class="mm-input"
					placeholder="Module URL — https://raw.githubusercontent.com/user/repo/main/mymodule (or a github.com/…/tree/… link)"
					bind:value={installUrlValue}
					on:input={() => clearInstallStatus()}
					on:keydown={(e) => {
						if (e.key === 'Enter') runUrlInstall();
					}}
				/>
				<!-- NO `disabled` binding here: the empty-field case is explained by the status line
				     below, so a refused-looking control buys nothing. `busy` still guards double-submits. -->
				<Button variant="primary" size="sm" onclick={runUrlInstall}>
					{installBusy ? 'Installing…' : 'Install'}
				</Button>
				<span class="mm-or">or</span>
				<Button variant="outline" size="sm" onclick={() => document.getElementById('install-module-zip')?.click()}>
					Choose .zip…
				</Button>
			</div>

			<!-- ONE status line for both install paths: progress, what landed (name, version, file
			     count, size) or WHY it failed, with the URL still in the field so it can be
			     corrected. aria-live so a screen reader hears the outcome. -->
			<div id="install-status" class="mm-status" aria-live="polite">
				{#if $installStatus.kind !== 'idle'}
					<span class="mm-status-line" data-kind={$installStatus.kind}>
						<Icon
							name={$installStatus.kind === 'busy' ? 'loader-circle' : $installStatus.kind === 'ok' ? 'check' : 'circle-alert'}
							size={16}
							aria-hidden="true"
						/>
						{$installStatus.text}
					</span>
					{#if $installStatus.detail}
						<span class="mm-status-detail">{$installStatus.detail}</span>
					{/if}
				{:else if alreadyInstalled}
					<span class="mm-quiet">
						Already installed: {alreadyInstalled.name} v{alreadyInstalled.version} — Install will update it
					</span>
				{:else if installUrlValue.trim()}
					<span class="mm-quiet">Will fetch {typedBase}/manifest.json</span>
				{/if}
			</div>

			{#if $staleModuleList.length}
				<div id="stale-modules" class="mm-stale">
					<p class="mm-stale-title">Older than this app expects</p>
					<p class="mm-quiet">An installed module never updates itself, and an old one can bring back a bug this version already fixed.</p>
					{#each $staleModuleList as stale (stale.id)}
						<div class="mm-stale-row" data-stale={stale.id}>
							<span>{stale.name} <span class="mm-ver">v{stale.installed} → v{stale.expected}</span></span>
							<Button
								variant="secondary"
								size="sm"
								id={'update-stale-' + stale.id}
								disabled={$updatingModules.includes(stale.id)}
								onclick={() => updateStaleModule(stale.id)}
							>
								{$updatingModules.includes(stale.id) ? 'Updating…' : 'Update'}
							</Button>
						</div>
					{/each}
				</div>
			{/if}
			{#if userVisible.length}
			<div class="mm-list">
			{#key $loadedModulesChanged}
				{#each userVisible as record (record.id)}
					{@const enabled = !$disabledModules.includes(record.id)}
					{@const menuItems = isModuleLoaded(record.id) && enabled ? $moduleMenuItems.filter((item) => item.moduleId === record.id) : []}
					<div id={'user-module-card-' + record.id} class="mm-row mm-row-user">
						<div class="mm-main">
							<div class="mm-title">
								<span class="mm-name">{record.name}</span>
								<span class="mm-ver">v{record.version}</span>
								<Badge tone="neutral">{record.source === 'zip' ? 'zip' : 'URL'}</Badge>
								{#if !enabled && isModuleLoaded(record.id)}
									<Badge tone="warn">reload to disable</Badge>
								{/if}
							</div>
							{@render moduleDesc('user:' + record.id, record.description)}
						</div>
						<!-- 41b H8: Remove + the enable switch on the RIGHT of the name/description -->
						<div class="mm-actions">
							<Button variant="warn-text" size="sm" onclick={() => removeUserModule(record.id)}>Remove</Button>
							<span class="mm-sep" aria-hidden="true"></span>
							<Toggle
								id={'enable-user-module-' + record.id}
								label={'Enable ' + record.name}
								checked={enabled}
								onchange={async (/** @type {boolean} */ on) => {
									if (on) {
										$disabledModules = $disabledModules.filter((id) => id !== record.id);
										await activateUserModule(record);
									} else {
										$disabledModules = [...new Set([...$disabledModules, record.id])];
										if (isModuleLoaded(record.id)) {
											deactivateModule(record.id);
											showToast('"' + record.name + '" disabled');
										}
									}
								}}
							/>
						</div>
						{#if menuItems.length || record.source !== 'zip'}
							<!-- the module's own actions + Update, under the name and description -->
							<div class="mm-extra">
								{#each menuItems as item}
									<Button variant="secondary" size="sm" onclick={item.action}>{item.label}</Button>
								{/each}
								{#if record.source !== 'zip'}
									<Button variant="outline" size="sm" onclick={() => updateUserModule(record)}>Update</Button>
								{/if}
							</div>
						{/if}
						<!-- A2 dev mode: reload fresh code from a URL without a page reload -->
						<div class="mm-dev">
							<input
								id={'dev-url-' + record.id}
								class="mm-input mm-input-sm"
								placeholder="Dev URL (serves manifest.json — defaults to the install URL)"
								aria-label={'Dev URL for ' + record.name}
								value={record.devUrl ?? (record.source !== 'zip' ? record.source : '')}
								on:change={(e) => setDevUrl(record.id, e.currentTarget.value)}
							/>
							<div class="mm-dev-actions">
								<Button
									variant="outline"
									size="sm"
									id={'dev-reload-' + record.id}
									disabled={!devSourceOf(record)}
									onclick={() => reloadUserModule(record)}
								>
									Reload
								</Button>
								<!-- a CHECKBOX, not a Toggle: the row's other switch enables/disables the
								     module, and two toggles side by side read as the same kind of control -->
								<label class="mm-auto" title="Poll the dev URL (~2s) and reload when the code changes">
									<Checkbox
										id={'dev-poll-' + record.id}
										checked={$devPolling.includes(record.id)}
										onchange={(/** @type {boolean} */ on) => setDevPoll(record, on)}
									/>
									Auto
								</label>
							</div>
							</div>
					</div>
				{/each}
			{/key}
			</div>
			{/if}
			{#if $userModules.length === 0}
				<EmptyState
					icon="package"
					title="Nothing installed yet"
					description="Download a core module as a starting point — the entry must be self-contained: no import statements, use api.THREE and api.assetUrl (see the SDK docs)."
				/>
			{:else if userVisible.length === 0}
				<p class="mm-quiet">No installed module matches “{query}”.</p>
			{/if}
		</div>
	{/if}
	</div>
</ModalDialog>

<style>
	.mm-body {
		padding: 18px 22px 24px;
	}
	.mm-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.mm-filter {
		width: 220px;
		max-width: 40vw;
	}
	/* the list: ONE card, rows divided by a 1px rule (SPEC Section card) */
	.mm-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		background: var(--surface-2);
	}
	/* 41b H8: a row is a GRID — the name/description column, the management controls on its
	   RIGHT (enable switch, download / Remove, Install), and full-width lines under the text for
	   a module's own actions, an install error, tags and the dev URL. The same on every width:
	   the old flex-wrap dropped the controls under the text on a phone. */
	.mm-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-2) 14px;
		padding: var(--setting-row-pad-y) 16px;
	}
	.mm-dim {
		opacity: 0.6;
	}
	.mm-main {
		grid-column: 1;
		min-width: 0;
	}
	.mm-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}
	.mm-name {
		font-size: var(--fs-body);
		font-weight: 500;
		color: var(--text);
	}
	.mm-ver {
		font-family: var(--font-ui-mono);
		font-size: var(--fs-badge);
		color: var(--text-faint);
	}
	.mm-by {
		font-size: var(--fs-desc);
		color: var(--text-faint);
	}
	.mm-desc-wrap {
		display: flex;
		align-items: flex-end;
		gap: var(--space-1);
		margin-top: 3px;
		border-radius: var(--radius-input);
	}
	.mm-desc-tappable {
		cursor: pointer;
	}
	.mm-desc-tappable:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.mm-desc {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		font-size: var(--fs-desc);
		line-height: 1.4;
		color: var(--text-muted);
	}
	.mm-desc-open {
		display: block;
		-webkit-line-clamp: unset;
		line-clamp: none;
		overflow: visible;
	}
	.mm-desc-chevron {
		display: inline-flex;
		flex-shrink: 0;
		padding-bottom: 1px;
		color: var(--text-faint);
	}
	.mm-tags {
		gap: var(--space-1);
	}
	.mm-actions {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	/* under the name/description: a module's own actions ("+ Button", "Pong: spawn / remove"),
	   Update, an install error, the tags */
	.mm-extra {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.mm-error {
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		font-size: var(--fs-desc);
	}
	.mm-error-line {
		display: inline-flex;
		align-items: flex-start;
		gap: 6px;
		color: var(--ink-bad);
	}
	.mm-error-line :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.mm-error-details {
		padding-left: 22px;
		color: var(--text-faint);
	}
	.mm-error-details summary {
		cursor: pointer;
		color: var(--text-muted);
	}
	.mm-error-raw {
		display: block;
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	.mm-sep {
		width: 1px;
		height: 24px;
		background: var(--border-input);
	}
	/* the dev URL row wraps: the field keeps a line of its own when Reload + Auto do not fit
	   beside it (on a phone "Auto" was pushed off the card, modules-url-auto.jpg) */
	.mm-dev {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.mm-dev .mm-input {
		flex: 1 1 12rem;
	}
	.mm-dev-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 0 0 auto;
	}
	.mm-auto {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-desc);
		color: var(--text-muted);
		cursor: pointer;
	}
	.mm-trust {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--fs-desc);
		line-height: 1.4;
		color: var(--warn-text);
	}
	.mm-trust :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.mm-quiet {
		margin: 0;
		font-size: var(--fs-desc);
		color: var(--text-muted);
	}
	.mm-install {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.mm-input {
		box-sizing: border-box;
		flex: 1 1 20rem;
		min-width: 0;
		height: var(--control-h-sm);
		padding: 0 10px;
		border: 1px solid var(--border-input);
		border-radius: var(--radius-input);
		background: var(--surface-inset);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-input);
	}
	.mm-input-sm {
		font-size: var(--fs-desc);
	}
	.mm-input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.mm-or {
		font-size: var(--fs-desc);
		color: var(--text-faint);
	}
	.mm-status {
		min-height: 1.25rem;
		margin-top: -4px;
		font-size: var(--fs-desc);
	}
	.mm-status-line {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
	}
	.mm-status-line[data-kind='ok'] {
		color: var(--ink-good);
	}
	.mm-status-line[data-kind='error'] {
		color: var(--ink-bad);
	}
	.mm-status-detail {
		display: block;
		padding-left: 22px;
		overflow-wrap: anywhere;
		color: var(--text-faint);
	}
	.mm-stale {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in srgb, var(--ink-warn) 50%, var(--border));
		border-radius: var(--radius-card);
		background: var(--surface-2);
	}
	.mm-stale-title {
		margin: 0;
		font-weight: 600;
		color: var(--warn-text);
	}
	.mm-stale-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		color: var(--text);
	}
	/* C5.1 gallery filter chips (SPEC Chips: the accent selection = accent-soft fill + accent
	   border). Hand-rolled because each chip carries the data-gal-* hook the suites address. */
	.mm-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.mm-chip {
		height: var(--control-h-sm);
		padding: 0 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: var(--fs-desc);
		cursor: pointer;
	}
	.mm-chip-cat {
		text-transform: capitalize;
	}
	.mm-chip:hover {
		background: var(--surface-hover);
	}
	.mm-chip[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}
	.mm-chip-sep {
		width: 1px;
		height: 18px;
		margin: 0 2px;
		background: var(--border-input);
	}
	/* the User tab's count just grew — a short pulse says "your module landed here" */
	:global(dialog[data-user-pulse] #modules-tab-user) {
		animation: mm-tab-pulse 0.5s ease-in-out 3;
	}
	@keyframes -global-mm-tab-pulse {
		50% {
			color: var(--accent-text);
			transform: scale(1.06);
		}
	}
	/* added imperatively by revealInstalled(), so it must be :global */
	:global(.just-installed) {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		transition: outline-color 0.4s ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(dialog[data-user-pulse] #modules-tab-user) {
			animation: none;
		}
	}
	@media (max-width: 640px) {
		.mm-body {
			padding: var(--space-4);
		}
		/* the filter takes its own line under the tabs, so no tab is clipped */
		:global(.tabs[data-wrap] .tabs-strip) {
			flex-wrap: wrap;
			row-gap: 0;
		}
		:global(.tabs[data-wrap] .tabs-actions) {
			flex-basis: 100%;
			margin-left: 0;
		}
		.mm-filter {
			width: 100%;
			max-width: none;
			padding-bottom: var(--space-2);
		}
	}
</style>
