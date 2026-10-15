<script>
	// 38 R5 — an Inspector on/off row: the label on the left, the kit Toggle on the right
	// (SPEC §2: every on/off is a Toggle). It takes the SAME props the flowbite Checkbox it
	// replaces took — `checked` (bindable), `id`, `disabled`, `title`, `onchange`, the label as
	// children — and hands `onchange` an event-shaped object whose `currentTarget.checked` /
	// `target.checked` is the new state, so every call site keeps its handler unchanged
	// (SPEC §0). The `id` lands on the Toggle button, which the `<label for>` activates; any
	// other attribute (data-tour …) lands on the row. `indeterminate` (37 R1 multi-edit: the
	// selected objects differ) shows the Toggle's mixed state, as the checkbox's dash did.
	import Toggle from '../../ui/Toggle.svelte';
	import { autoFieldScope, fieldClip } from '$lib/fieldMenu';

	/** @type {{checked?: boolean, indeterminate?: boolean, id?: string, disabled?: boolean, title?: string, onchange?: (e: {currentTarget: {checked: boolean}, target: {checked: boolean}}) => void, children?: import('svelte').Snippet} & Record<string, any>} */
	let { checked = $bindable(false), indeterminate = false, id = undefined, disabled = false, title = undefined, onchange = () => {}, children = undefined, ...rest } = $props();

	const uid = 'ins-toggle-' + Math.random().toString(36).slice(2, 9);
	const tid = $derived(id ?? uid);
	const labelId = $derived(tid + '-label');

	/** @param {boolean} next */
	function changed(next) {
		const state = { checked: next };
		onchange({ currentTarget: state, target: state });
	}

	// 43 J3: an on/off row is a clipboard field (copy / paste true-false) inside the Inspector
	const clipScope = autoFieldScope();
	/** @type {HTMLElement|null} */
	let labelEl = $state(null);
	/** @returns {any} */
	function clipSpec() {
		if (!clipScope) return null;
		return {
			kind: 'bool',
			name: (labelEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Toggle',
			get: () => !!checked,
			// the same two steps a click takes: the bound value, then the row's own handler
			set: (/** @type {boolean} */ next) => {
				if (disabled || next === !!checked) return;
				checked = next;
				changed(next);
			},
			disabled
		};
	}
	$effect(() => clipScope?.section?.add(clipSpec));
</script>

<div class="tp-ui it" class:it-disabled={disabled} {title} {...rest} use:fieldClip={clipSpec}>
	<label class="it-label" id={labelId} for={tid} bind:this={labelEl}>{@render children?.()}</label>
	<Toggle id={tid} bind:checked mixed={indeterminate} {disabled} labelledby={labelId} onchange={changed} />
</div>

<style>
	.it {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: var(--row-h); /* density token: 36 / 32 Compact / 44 touch */
	}
	.it-label {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-desc);
		line-height: 1.35;
		color: var(--text-2);
		cursor: pointer;
	}
	.it-disabled .it-label {
		opacity: 0.55;
		cursor: default;
	}
	@media (max-width: 639.98px) {
		.it-label {
			font-size: var(--fs-body);
		}
	}
</style>
