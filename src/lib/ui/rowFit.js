// 41b H12/H13 — a settings row decides by REAL FIT whether its control sits on the label's row or
// drops under it. The rule (roadmap 41 round 2): a compact control (switch, checkbox, short dropdown,
// swatch, single button, number stepper, a segmented control that fits) stays on the label's row;
// only a control that cannot fit (wide segmented, text input, long list) moves under the label.
//
// G19 used container queries with fixed thresholds (every segmented / two-piece control under 560 px
// of row, everything but a lone switch under 420 px), which stacked a 64 px key box, a colour swatch
// and a Copy button on a phone and a two-option toggle on an unfolded N6. Here each row measures:
//   W  the row body's width
//   C  the control's max-content width (a slider has none: it counts as FLUID_MIN)
//   T  the text column it needs: TEXT_MIN, or less when the row has no description and its label is
//      shorter than that (an About "Version" row needs only its word)
// and keeps the control on the row when W - gap - C >= T. TEXT_MIN keeps G19's narrow-width fix: no
// label or description is ever squeezed into a one-word-per-line column beside a control.
//
// C is read off an invisible CLONE appended to the row as an absolutely-positioned box at
// `width: max-content` — the live row never changes size while it is measured, so nothing reflows
// and no scroller clamps. One ResizeObserver serves every row: a burst of observations is measured
// in one batch (write every probe, read every width, remove every probe — one forced layout).
// A stacked segmented control too wide even for the whole row wraps its options into two columns
// (`sr-seg-wrap`) instead of letting "Properties" spill out of its slot.

import { scaledPx } from '../uiScale'; // 53 A1: both floors are design px — the text they protect scales

/** the text column a control may leave beside it (px); ≥ the G19 suites' "no one-word column" floor */
export const TEXT_MIN = 150;
/** a slider has no intrinsic width — it counts as this wide */
export const FLUID_MIN = 200;

/** @type {ResizeObserver | null} */
let ro = null;
/** @type {Set<HTMLElement>} rows waiting for the next batch */
const pending = new Set();
let scheduled = false;
/** @type {WeakMap<Element, number>} the last width each observed box reported */
const lastW = new WeakMap();

/** @param {HTMLElement} el @param {string} probeCss */
function probeOf(el, probeCss) {
	const p = /** @type {HTMLElement} */ (el.cloneNode(true));
	// a clone must not duplicate ids (a <label for> resolves to the FIRST match) nor be reachable
	for (const n of [p, ...p.querySelectorAll('[id]')]) n.removeAttribute('id');
	p.setAttribute('aria-hidden', 'true');
	p.setAttribute('inert', '');
	p.classList.add('sr-probe');
	p.style.cssText = probeCss;
	return p;
}

const PROBE_CSS = 'position:absolute;left:0;top:0;width:max-content;max-width:none;visibility:hidden;pointer-events:none;';

/**
 * Measure a batch of rows and set `sr-fit-stack` / `sr-seg-wrap` on each. Exported for the
 * unit-free e2e probe (`window.__stores.rowFit`).
 * @param {Iterable<HTMLElement>} rows
 */
export function measureRows(rows) {
	/** @type {{row: HTMLElement, body: HTMLElement, ctrl: HTMLElement, text: HTMLElement | null, probe: HTMLElement, head: HTMLElement | null, hasDesc: boolean}[]} */
	const jobs = [];
	for (const row of rows) {
		if (!row.isConnected) continue;
		const body = /** @type {HTMLElement | null} */ (row.querySelector(':scope > .sr-body'));
		const ctrl = /** @type {HTMLElement | null} */ (body?.querySelector(':scope > .sr-control:not(.sr-probe)'));
		if (!body || !ctrl) continue;
		// hidden (a filtered search, a collapsed section): nothing to decide until it shows
		if (body.clientWidth === 0) continue;
		const text = /** @type {HTMLElement | null} */ (body.querySelector(':scope > .sr-text'));
		const hasDesc = !!text?.querySelector('.sr-desc');
		const headEl = /** @type {HTMLElement | null} */ (text?.querySelector('.sr-head') ?? null);
		jobs.push({ row, body, ctrl, text, probe: probeOf(ctrl, PROBE_CSS), head: !hasDesc && headEl ? probeOf(headEl, PROBE_CSS + 'display:flex;') : null, hasDesc });
	}
	if (!jobs.length) return;
	// write: every probe in its row (absolute, so no row changes size)
	for (const j of jobs) {
		j.body.appendChild(j.probe);
		if (j.head) j.body.appendChild(j.head);
	}
	// read
	const results = jobs.map((j) => {
		const W = j.body.clientWidth;
		let C = j.probe.getBoundingClientRect().width;
		if (j.probe.querySelector('.sl')) C = Math.max(C, scaledPx(FLUID_MIN));
		const gap = parseFloat(getComputedStyle(j.body).columnGap) || 0;
		const textMin = scaledPx(TEXT_MIN);
		const need = j.hasDesc || !j.head ? textMin : Math.min(textMin, Math.ceil(j.head.getBoundingClientRect().width) + 1);
		const onRow = W - gap - C >= need;
		const segWrap = !onRow && C > W + 0.5 && !!j.probe.querySelector('.seg');
		return { onRow, segWrap, W: Math.round(W), C: Math.round(C), need };
	});
	// write: remove the probes, apply the verdicts
	jobs.forEach((j, i) => {
		j.probe.remove();
		j.head?.remove();
		const r = results[i];
		j.row.classList.toggle('sr-fit-stack', !r.onRow);
		j.row.classList.toggle('sr-seg-wrap', r.segWrap);
		j.row.dataset.fit = r.onRow ? 'row' : r.segWrap ? 'wrap' : 'stack';
		j.row.dataset.fitW = String(r.W);
		j.row.dataset.fitC = String(r.C);
	});
}

function flush() {
	scheduled = false;
	const rows = [...pending];
	pending.clear();
	measureRows(rows);
}

/** @param {HTMLElement} row @param {boolean} [nextFrame] */
function queue(row, nextFrame = false) {
	pending.add(row);
	if (!scheduled) {
		scheduled = true;
		// on mount a microtask lands before the first paint. From inside the observer's callback the
		// verdict waits a frame: a class flipped there changes row heights at the depth just
		// delivered, which the browser reports as an undelivered-notifications loop error
		if (nextFrame) requestAnimationFrame(flush);
		else queueMicrotask(flush);
	}
}

/**
 * Svelte action: watch a settings row (`.sr`). Measures on mount, on a size change of the row or
 * its control (a select whose label changed, "Test" -> "Testing…"), and on content changes inside
 * the control.
 * @param {HTMLElement} row
 */
export function rowFit(row) {
	if (typeof ResizeObserver === 'undefined') return {};
	ro ??= new ResizeObserver((entries) => {
		for (const e of entries) {
			const t = /** @type {HTMLElement} */ (e.target);
			// only a WIDTH change can change the verdict (a stack/row flip changes heights)
			const w = Math.round(e.contentRect.width);
			if (lastW.get(t) === w) continue;
			lastW.set(t, w);
			const r = t.classList.contains('sr') ? t : /** @type {HTMLElement | null} */ (t.closest('.sr'));
			if (r) queue(r, true);
		}
	});
	ro.observe(row);
	const ctrl = row.querySelector(':scope > .sr-body > .sr-control');
	if (ctrl) ro.observe(ctrl);
	// a control's content can change without changing the control box (a stacked, start-aligned one)
	const mo = ctrl ? new MutationObserver(() => queue(row, true)) : null;
	mo?.observe(/** @type {Node} */ (ctrl), { childList: true, subtree: true, characterData: true });
	queue(row);
	return {
		destroy() {
			ro?.unobserve(row);
			if (ctrl) ro?.unobserve(ctrl);
			mo?.disconnect();
			pending.delete(row);
		}
	};
}
