// F-3 (roadmap 55 "Fixes for 54", test flight T5): a peer that vanished without a goodbye
// (a killed process, a crashed tab) must leave Users within seconds, and a leave must never
// surface as a raw "Connection error". Imports NOTHING: the rules are numbers and a set, so
// they are unit-testable with no peer; peerHandler owns the timers and the conns.
//
// Three facts the fix rests on (peerjs 1.5.5, Chromium):
//  - a peer that dies without closing its SCTP association leaves our data channel "open":
//    ICE goes `disconnected` after a few silent seconds and may sit there for 30 s or more
//    before `failed` (or never), so the conn's 'close' never fires and the row is a ghost.
//  - a dial to an id the signaling server no longer holds answers EXPIRE -> a PEER-level
//    `peer-unavailable` error, and the conn it named stays un-open (peerjs does not close
//    it), so the reconnect loop waited out the 10 s dial grace per try, toasting each time.
//  - candidates/descriptions arriving for a connection we just closed fail as a PEER-level
//    `webrtc` error, which the catch-all turned into "Connection error: webrtc".

/** how long ICE may sit in `disconnected` before we treat the link as dropped. Chromium
 * recovers a lossy-but-alive link well inside this; a dropped one goes to the reconnect
 * window (the B5 path), so a live peer is redialled, never lost. */
export const ICE_DROP_GRACE_MS = 5000;

/** "this id is not on the signaling server" answers, while redialling a dropped peer,
 * before we stop waiting for them. Three spans ~3.5 s of the backoff (0.5 + 1 + 2 s): long
 * enough for a signaling blip on their side, short enough that a dead peer is gone in
 * seconds. */
export const UNAVAILABLE_STRIKES = 3;

/** after a leave, a drop or a redial, peer-level noise for this long is a symptom of
 * that, never news. */
export const LEAVE_QUIET_MS = 20000;

const QUIET_TYPES = new Set(['webrtc', 'disconnected', 'negotiation-failed', 'connection-closed']);

/**
 * Should a peer-level error of `type` stay off the screen? Only the leave/drop symptoms,
 * and only while a leave or a redial is in flight (or just was).
 * @param {string} type peerjs error type
 * @param {{ lastLeaveAt: number, reconnecting: number, now: number }} ctx
 */
export function quietPeerError(type, { lastLeaveAt, reconnecting, now }) {
	if (!QUIET_TYPES.has(type)) return false;
	return reconnecting > 0 || now - lastLeaveAt < LEAVE_QUIET_MS;
}

/**
 * Pull the peer id out of a peerjs `peer-unavailable` message
 * ("Could not connect to peer abc12"). The id is the LAST word: the first-match regex this
 * replaces answered "Could" for every message, so the request it meant to end never ended.
 * @param {unknown} message
 */
export function unavailablePeerId(message) {
	return String(message ?? '').match(/peer\s+([0-9a-z][0-9a-z_-]{2,})\s*$/i)?.[1] ?? '';
}
