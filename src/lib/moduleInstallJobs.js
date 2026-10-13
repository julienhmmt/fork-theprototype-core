// 41b H9 — Browse installs are INDEPENDENT JOBS, one per module id.
//
// The manager held ONE `galleryBusy` id: a second Install click overwrote it, so the first card
// went back to "Install" while its download was still running (and the first install to finish
// cleared the second card's state too). A failure was written to the ONE shared status line,
// which only the User tab draws, and the next install overwrote it — so a module that failed
// (Waves: nine files) simply looked as if a later click had cancelled it.
//
// Now: a per-id promise map (a second click on a running install joins it, never starts a
// rival) and a per-id store the card renders — `installing` until the promise settles, then
// gone on success or `error` with a short reason, the raw message as `detail`, and Retry.

import { writable } from 'svelte/store';
import { installUrl } from './userModules';

/**
 * @typedef {{state: 'installing', text: string, detail?: string}
 *   | {state: 'error', reason: string, detail: string, url: string}} InstallJob
 */

/** id -> the card's install state; absent = no job @type {import('svelte/store').Writable<Record<string, InstallJob>>} */
export const installJobs = writable({});

/** id -> the running install @type {Map<string, Promise<boolean>>} */
const running = new Map();

/** @param {string} id @param {InstallJob | null} job */
function put(id, job) {
	installJobs.update((all) => {
		const next = { ...all };
		if (job) next[id] = job;
		else delete next[id];
		return next;
	});
}

/**
 * The reason a person can act on, from installUrl's raw message (the whole message stays in
 * Details). Pure, exported for the unit test.
 * @param {string} message
 */
export function installFailureReason(message) {
	const text = String(message ?? '');
	if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(text))
		return 'Could not reach the module server — check your connection and retry.';
	const http = text.match(/^(\S+) returned (\d{3})/);
	if (http) return 'Download failed: ' + http[1] + ' (HTTP ' + http[2] + ').';
	if (/manifest/i.test(text) && /id, name and version|JSON|Unexpected token/i.test(text))
		return 'The module’s manifest is invalid.';
	if (/did not register|failed to run|must default-export/i.test(text)) return 'The module downloaded but failed to start.';
	const first = text.split(' — ')[0].trim();
	return first.length > 0 && first.length <= 120 ? first : 'The install failed.';
}

/**
 * Install (or update) one module from its URL as its own job. A second call for an id whose
 * install is still running returns that SAME promise.
 * @param {string} id @param {string} url @returns {Promise<boolean>}
 */
export function installModuleJob(id, url) {
	const live = running.get(id);
	if (live) return live;
	put(id, { state: 'installing', text: 'Installing…' });
	// a holder, not a `let`: the type checker would narrow a closure-written `let` to null
	/** @type {{last: {kind: string, text: string, detail?: string} | null}} */
	const seen = { last: null };
	const job = installUrl(url, {
		onStatus(kind, text, detail) {
			seen.last = { kind, text, detail };
			if (kind === 'busy') put(id, { state: 'installing', text, detail });
		}
	})
		.catch((error) => {
			seen.last = { kind: 'error', text: 'Install failed', detail: error instanceof Error ? error.message : String(error) };
			return false;
		})
		.then((ok) => {
			const last = seen.last;
			if (ok || !last || last.kind === 'idle' || last.kind === 'ok') {
				// done, or cancelled at the format question — nothing to show on the card
				put(id, null);
			} else {
				const raw = last.detail || last.text || 'Install failed';
				put(id, { state: 'error', reason: installFailureReason(raw), detail: raw, url });
			}
			return ok;
		})
		.finally(() => running.delete(id));
	running.set(id, job);
	return job;
}

/** Forget a failed job (the card goes back to Install) @param {string} id */
export function dismissInstallJob(id) {
	if (!running.has(id)) put(id, null);
}
