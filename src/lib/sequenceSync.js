// 48 S2 — replication + history for sequences (the hudSync shape).
//
// Lives apart from sequences.js so that module stays a leaf; this is the module whose BODY
// calls registerHistoryKind, so it must never be reachable from history's own imports.
//
// Wire: `seq` {id, doc} / `seqdelete` {id, changedAt} per edit, `seqs` {seqs} as the
// late-joiner reply to `getseqs` (requestFullState). Latest-wins on `changedAt`, refusing
// only a STRICTLY older document (an ordered DataConnection makes an equal stamp "later").
// No `handleDisconnected` cleanup: sequences are scene data, not per-peer state.

import { get } from 'svelte/store';
import { sessionNow } from './sessionClock';
import { peers } from '../stores/appStore';
import { registerHistoryKind, recordEntry } from './history';
import {
	sequences,
	sequenceOf,
	setSequence,
	registerSequenceBroadcast,
	registerSequenceHistory
} from './sequences';
import { normalizeSequence } from './sequenceCore';

// ---- outbound -------------------------------------------------------------------

/** @param {string} id @param {any} doc */
function broadcast(id, doc) {
	/** @type {any} */
	const peer = get(peers);
	if (!peer) return;
	if (doc) peer.send({ type: 'seq', id, doc: normalizeSequence(doc) });
	else peer.send({ type: 'seqdelete', id, changedAt: sessionNow() });
}

/**
 * Full-state reply for a late joiner (golden rule 3), retried until the conn is OPEN —
 * peerjs silently drops anything sent earlier (golden rule 2).
 * @param {string} peerId @param {number} [tries]
 */
export function sendSequences(peerId, tries = 0) {
	/** @type {any} */
	const peer = get(peers);
	const conn = peer?.peer?.connections?.[peerId]?.[0] ?? peer?.connections?.[peerId];
	if (!conn) return;
	const all = get(sequences);
	if (!Object.keys(all).length) return;
	if (!conn.open) {
		if (tries < 40) setTimeout(() => sendSequences(peerId, tries + 1), 250);
		return;
	}
	/** @type {Record<string, any>} */
	const seqs = {};
	for (const [id, doc] of Object.entries(all)) seqs[id] = normalizeSequence(doc);
	conn.send({ type: 'seqs', seqs });
}

// ---- inbound --------------------------------------------------------------------

/** @param {any} data */
export function applyRemoteSequence(data) {
	const id = typeof data?.id === 'string' ? data.id : '';
	if (!id || !data?.doc || typeof data.doc !== 'object') return;
	const incoming = normalizeSequence({ ...data.doc, id });
	const mine = sequenceOf(id);
	if (mine && (mine.changedAt ?? 0) > (incoming.changedAt ?? 0)) return;
	// silent: a receiver must not re-broadcast, and a remote edit is not OUR undo step
	setSequence(id, incoming, { silent: true, stamp: incoming.changedAt });
}

/** @param {any} data */
export function applyRemoteSequenceDelete(data) {
	const id = typeof data?.id === 'string' ? data.id : '';
	if (!id) return;
	const mine = sequenceOf(id);
	if (!mine || (mine.changedAt ?? 0) > (Number(data?.changedAt) || 0)) return;
	setSequence(id, null, { silent: true });
}

/** The whole map, from a `getseqs` reply. @param {any} data */
export function applyRemoteSequences(data) {
	const seqs = data?.seqs;
	if (!seqs || typeof seqs !== 'object') return;
	for (const [id, doc] of Object.entries(seqs)) applyRemoteSequence({ id, doc });
}

// ---- history --------------------------------------------------------------------

// A drag writes on every pointermove; ONE undo step and ONE broadcast per gesture.
/** @type {Map<string, any>} */
const gestures = new Map();

/** @param {string} id */
export function beginSequenceGesture(id) {
	if (!gestures.has(id)) gestures.set(id, sequenceOf(id));
}

/** @param {string} id */
export function endSequenceGesture(id) {
	if (!gestures.has(id)) return;
	const before = gestures.get(id);
	gestures.delete(id);
	const after = sequenceOf(id);
	if (sameDoc(before, after)) return;
	recordEntry({ kind: 'seq', key: id, before, after });
	broadcast(id, after);
}

/** Drop an open gesture, putting the document back as it was (Esc on a drag). @param {string} id */
export function cancelSequenceGesture(id) {
	if (!gestures.has(id)) return;
	const before = gestures.get(id);
	gestures.delete(id);
	setSequence(id, before, { silent: true });
}

/** @param {any} a @param {any} b */
function sameDoc(a, b) {
	const strip = (/** @type {any} */ d) => (d ? { ...d, changedAt: 0 } : null);
	return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

registerHistoryKind('seq', (/** @type {any} */ entry, /** @type {any} */ state) => {
	// `state` IS entry.before or entry.after — an IDENTITY comparison (the hud/anim idiom)
	const doc = state === entry.before ? entry.before : entry.after;
	// through the single write path, so an undo replicates exactly like an edit. History
	// mutes its own recording while applying, so this cannot re-record.
	setSequence(entry.key, doc ? { ...doc, changedAt: undefined } : null);
	return true;
});

// ---- wiring ---------------------------------------------------------------------

/** @type {(()=>void)[]} */
let disposers = [];

/** Install the seams. Idempotent. */
export function startSequenceSync() {
	if (disposers.length) return;
	disposers.push(
		registerSequenceBroadcast((id, doc) => {
			if (gestures.has(id)) return; // endSequenceGesture sends the settled doc once
			broadcast(id, doc);
		})
	);
	disposers.push(
		registerSequenceHistory((id, before, after) => {
			if (gestures.has(id)) return;
			if (sameDoc(before, after)) return;
			recordEntry({ kind: 'seq', key: id, before, after });
		})
	);
}

/** Test seam. */
export function stopSequenceSync() {
	for (const dispose of disposers) dispose();
	disposers = [];
	gestures.clear();
}

/** test/debug view */
export function sequenceSyncDebug() {
	return { wired: disposers.length > 0, gestures: [...gestures.keys()] };
}
