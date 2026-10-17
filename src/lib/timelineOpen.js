// 48 S1: open the Timeline on a sequence — the openHudEditor deep-link shape, through
// dynamic imports so a node card (or any leaf) keeps no static edge into the dock.

/** @param {string} [sequenceId] */
export async function openTimeline(sequenceId) {
	const [appStore, dock, seqs] = await Promise.all([
		import('../stores/appStore.js'),
		import('./bottomDock.js'),
		import('./sequences.js')
	]);
	if (sequenceId) seqs.activeSequence.set(sequenceId);
	appStore.timelineClose.set(false);
	dock.activateDock('timeline');
}
