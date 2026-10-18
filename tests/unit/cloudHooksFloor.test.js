// 48-int: the capability floor answers every late-joiner REQUEST a viewer-role peer sends —
// a cloud build's just-approved joiner is a viewer until its role grant lands
import { describe, it, expect, afterEach } from 'vitest';
import { canApply, setCapabilityProvider } from '../../src/lib/cloudHooks.js';

describe('cloudHooks ALWAYS_ALLOWED floor', () => {
	afterEach(() => setCapabilityProvider(null));

	it('lets a viewer request the sequences (48 S2 getseqs), as it does nodes and triggers', () => {
		setCapabilityProvider(() => false);
		for (const t of ['getseqs', 'getnodes', 'gettriggers', 'getobjects']) expect(canApply('v', t)).toBe(true);
	});

	it('keeps the seqs REPLY gateable (content, not protocol)', () => {
		setCapabilityProvider(() => false);
		expect(canApply('v', 'seqs')).toBe(false);
		expect(canApply('v', 'seq')).toBe(false);
	});

	it('allows everything with no provider (the OSS build)', () => {
		expect(canApply('v', 'seqs')).toBe(true);
	});
});
