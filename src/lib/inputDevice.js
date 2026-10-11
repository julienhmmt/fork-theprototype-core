// What kind of input is this device likely to have? ONE home for the rule, because
// several features need the same answer and each guessed differently before.
//
// The rule is deliberately about AUTOFOCUS, not about capability: on a touch device
// focusing a text field slides the on-screen keyboard over the UI the user just
// opened, so nothing may focus a field they did not ask for. Typing still works —
// see `typeToFocus`, which hands the first keystroke from a physical (e.g.
// Bluetooth) keyboard to the field, so a tablet with a keyboard behaves like a PC.
//
// This module imports NOTHING, so any store or component can use it.

/** A touch-first pointer (phone, tablet). Cannot be emulated in desktop headless. */
export function coarsePointer() {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return !!window.matchMedia('(pointer: coarse)').matches;
}

/**
 * 41b H7: a phone or a tablet — a touch-first pointer that is NOT a headset's browser (a Quest or a
 * Pico can report a coarse pointer too, and there "play" means the headset). Where the play button
 * has made no choice yet, a handheld plays on its screen (desktop parity) rather than dropping into
 * a cardboard VR session because the browser happens to support one.
 */
export function handheldDevice() {
	if (!coarsePointer()) return false;
	const ua = typeof navigator === 'undefined' ? '' : String(navigator.userAgent ?? '');
	return !/OculusBrowser|Quest|Pico|VRShell|Wolvic|Vive/i.test(ua);
}

/**
 * May we focus a text field the user did not tap? True on pointer devices, false
 * where it would raise the on-screen keyboard unbidden.
 */
export function autofocusOk() {
	return !coarsePointer();
}

/** Would this keydown put a character in a text field? (not a shortcut/navigation)
 * @param {KeyboardEvent} event */
export function isTypingKey(event) {
	return (
		!!event &&
		typeof event.key === 'string' &&
		event.key.length === 1 &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey
	);
}

/**
 * Route the FIRST printable keystroke into `getInput()` when nothing focusable is
 * already taking it. That is what keeps type-to-filter usable on a touch device
 * with a real keyboard attached, even though we refuse to autofocus there: the
 * moment a key arrives we know a keyboard exists, so we focus the field and insert
 * the character ourselves (an unfocused field would have swallowed it).
 *
 * Registered in CAPTURE so the app's global shortcuts never see that first key.
 * @param {() => (HTMLInputElement | null | undefined)} getInput
 * @returns {() => void} teardown
 */
export function typeToFocus(getInput) {
	if (typeof window === 'undefined') return () => {};
	/** @param {KeyboardEvent} event */
	const onKey = (event) => {
		if (!isTypingKey(event)) return;
		const input = getInput();
		if (!input || document.activeElement === input) return;
		const active = document.activeElement;
		// never steal from another field the user is already using
		if (active instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
		if (active instanceof HTMLElement && active.isContentEditable) return;
		event.preventDefault();
		event.stopPropagation();
		input.focus({ preventScroll: true });
		input.value += event.key;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	};
	window.addEventListener('keydown', onKey, true);
	return () => window.removeEventListener('keydown', onKey, true);
}
