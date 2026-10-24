import { describe, it, expect } from 'vitest';
import {
	quietPeerError,
	unavailablePeerId,
	LEAVE_QUIET_MS,
	ICE_DROP_GRACE_MS,
	UNAVAILABLE_STRIKES
} from '../../src/lib/peerDrop.js';

// F-3: a dropped peer leaves Users within seconds and a leave never toasts "Connection error".
describe('F-3 peer drop policy', () => {
	const now = 1_000_000;
	it('keeps leave/drop symptoms off the screen while a leave or redial is in flight', () => {
		for (const type of ['webrtc', 'disconnected', 'negotiation-failed', 'connection-closed']) {
			expect(quietPeerError(type, { lastLeaveAt: now - 1000, reconnecting: 0, now })).toBe(true);
			expect(quietPeerError(type, { lastLeaveAt: 0, reconnecting: 1, now })).toBe(true);
		}
	});
	it('still shows them when nothing is leaving (a real failure is news)', () => {
		expect(quietPeerError('webrtc', { lastLeaveAt: now - LEAVE_QUIET_MS - 1, reconnecting: 0, now })).toBe(false);
		expect(quietPeerError('webrtc', { lastLeaveAt: 0, reconnecting: 0, now })).toBe(false);
	});
	it('never hides errors that are not leave symptoms', () => {
		for (const type of ['browser-incompatible', 'invalid-id', 'ssl-unavailable', 'unavailable-id'])
			expect(quietPeerError(type, { lastLeaveAt: now, reconnecting: 3, now })).toBe(false);
	});
	it('reads the id from the END of the peerjs message (the old regex answered "Could")', () => {
		expect(unavailablePeerId('Could not connect to peer e6f54')).toBe('e6f54');
		expect(unavailablePeerId('Could not connect to peer a1b2c ')).toBe('a1b2c');
		expect(unavailablePeerId('something else')).toBe('');
		expect(unavailablePeerId(undefined)).toBe('');
	});
	it('drops a dead peer in seconds, not the old 30 s+', () => {
		// ICE grace + the strikes' share of the 0.5/1/2 s backoff
		const backoff = [500, 1000, 2000, 4000, 8000].slice(0, UNAVAILABLE_STRIKES).reduce((a, b) => a + b, 0);
		expect(ICE_DROP_GRACE_MS + backoff).toBeLessThanOrEqual(10000);
	});
});
