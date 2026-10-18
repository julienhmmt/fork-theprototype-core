// 48 D1 — THE NODE GRAPH DEBUGGER'S PURE HALF (imports nothing: the unit layer runs it).
//
// The runtime half lives in flowRuntime (the tick it pauses) and flowDebug.js (the stores the panel
// reads). Everything here is a pure function of its arguments, so the rules a debugger is judged
// on — which event reaches a breakpoint, what Step does next, how a value reads on a wire — are
// pinned by tests/unit/flowDebugCore.test.js without a browser.
//
// THE MODEL in one paragraph. The graph has no "execution": values are a pure function of
// (graph, time, trigger log), and an EVENT is a stamp in the replicated trigger log. So the
// debugger pauses by FREEZING two inputs of that function for the local view — the clock and a
// copy of the log — while the live log keeps receiving every event (yours and other players'),
// which also queue here. Step folds the next queued event into the copy (through the very
// function the live log uses) or advances the clock to the next scheduled Delay/Sequence moment.

/** the cap on queued events; past it the oldest are dropped (the panel says how many) */
export const QUEUE_CAP = 500;

/**
 * Which event SOURCES reach a breakpoint, built once per (graph, breakpoints) pair.
 * A node "is reached" by an event when it fires itself, or when an edge out of the firing node
 * (on the firing handle, if the event names one) ends at it.
 * @param {Iterable<string>} breakpoints node ids
 * @param {{source: string, target: string, sourceHandle?: string|null}[]} edges
 * @returns {Map<string, {handle: string|null, bp: string}[]>} source id -> the breakpoints its edges reach
 */
export function breakpointReach(breakpoints, edges) {
	const bps = new Set(breakpoints);
	/** @type {Map<string, {handle: string|null, bp: string}[]>} */
	const reach = new Map();
	if (!bps.size) return reach;
	for (const edge of edges) {
		if (!bps.has(edge.target)) continue;
		const list = reach.get(edge.source) ?? [];
		list.push({ handle: edge.sourceHandle ?? null, bp: edge.target });
		reach.set(edge.source, list);
	}
	return reach;
}

/**
 * The breakpoint an event lands on, or null. `walkId` is the node that fired, `walkHandle` the
 * output it fired on (null = every output — the log's own rule in applyNodeTrigger).
 * @param {Set<string>} breakpoints
 * @param {Map<string, {handle: string|null, bp: string}[]>} reach
 * @param {string} walkId @param {string|null} walkHandle
 * @returns {string|null}
 */
export function breakpointHit(breakpoints, reach, walkId, walkHandle) {
	if (breakpoints.has(walkId)) return walkId;
	const list = reach.get(walkId);
	if (!list) return null;
	for (const entry of list) if (walkHandle === null || entry.handle === walkHandle) return entry.bp;
	return null;
}

/**
 * What Step does next. Events are taken in ARRIVAL order (that is the order the live log took
 * them in); a scheduled moment (a Delay / Sequence step) that falls before the next event's stamp
 * goes first, because in a running game it would have fired first.
 * @param {{t: number}[]} queue @param {number|null} nextMoment the earliest scheduled moment after the debug clock
 * @returns {{kind: 'event'} | {kind: 'moment', at: number} | {kind: 'wait'}}
 */
export function chooseStep(queue, nextMoment) {
	const head = queue[0];
	if (typeof nextMoment === 'number' && (!head || nextMoment <= head.t))
		return { kind: 'moment', at: nextMoment };
	if (head) return { kind: 'event' };
	return { kind: 'wait' };
}

/**
 * Append an event, dropping the oldest past the cap. Returns how many were dropped.
 * @template T @param {T[]} queue @param {T} event @param {number} [cap]
 */
export function enqueue(queue, event, cap = QUEUE_CAP) {
	queue.push(event);
	let dropped = 0;
	while (queue.length > cap) {
		queue.shift();
		dropped++;
	}
	return dropped;
}

/** @param {number} v */
function fmtNumber(v) {
	if (!Number.isFinite(v)) return String(v);
	if (Number.isInteger(v)) return String(v);
	const abs = Math.abs(v);
	if (abs >= 1000) return v.toFixed(0);
	if (abs >= 1) return String(Number(v.toFixed(2)));
	return String(Number(v.toPrecision(2)));
}

/**
 * How a value reads on a wire or in the watch list — short, one line, never throws.
 * @param {any} v @param {(uuid: string) => string|null} [nameOf] an object uuid -> its name
 * @returns {string}
 */
export function formatValue(v, nameOf) {
	if (v === undefined) return '—';
	if (v === null) return 'null';
	if (typeof v === 'number') return fmtNumber(v);
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'string') {
		const name = nameOf?.(v);
		if (name) return name;
		return v.length > 24 ? '"' + v.slice(0, 23) + '…"' : '"' + v + '"';
	}
	if (Array.isArray(v)) {
		if (v.length <= 4 && v.every((x) => typeof x === 'number'))
			return '(' + v.map(fmtNumber).join(', ') + ')';
		return '[' + v.length + ']';
	}
	if (typeof v === 'object') {
		if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number')
			return '(' + [v.x, v.y, v.z].map(fmtNumber).join(', ') + ')';
		if (typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number')
			return 'rgb(' + [v.r, v.g, v.b].map((c) => Math.round(c * 255)).join(', ') + ')';
		if (v.__handles && typeof v.__handles === 'object')
			return '{' + Object.keys(v.__handles).length + ' outputs}';
		return '{…}';
	}
	return String(v);
}

/**
 * An event wire's reading: the pulse window at the debug clock, or how long ago it fired.
 * @param {number|null} stamp @param {number} time @param {number} [pulse]
 * @returns {{fired: boolean, high: boolean, text: string}}
 */
export function formatPulse(stamp, time, pulse = 0.3) {
	if (typeof stamp !== 'number') return { fired: false, high: false, text: 'never' };
	let age = time - stamp;
	// the trigger clock is seconds-of-the-day: a stamp from just before midnight is not 24 h in the future
	if (age < -43200) age += 86400;
	if (age < 0) return { fired: true, high: false, text: 'queued' };
	const high = age < pulse;
	return {
		fired: true,
		high,
		text: high
			? '● pulse'
			: fmtNumber(age < 10 ? Number(age.toFixed(1)) : Math.round(age)) + ' s ago'
	};
}

/** a watch entry's identity (two equal entries are one watch) @param {{kind: string, key: string, handle?: string|null}} w */
export function watchKey(w) {
	return w.kind + ':' + w.key + (w.handle ? '#' + w.handle : '');
}

/**
 * Clean a persisted watch list: known kinds, non-empty keys, no duplicates, capped.
 * @param {any} list @returns {{kind: 'var'|'player'|'node', key: string, handle?: string}[]}
 */
export function normalizeWatches(list) {
	if (!Array.isArray(list)) return [];
	/** @type {{kind: 'var'|'player'|'node', key: string, handle?: string}[]} */
	const out = [];
	const seen = new Set();
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue;
		const kind =
			raw.kind === 'player' || raw.kind === 'node' ? raw.kind : raw.kind === 'var' ? 'var' : null;
		const key = typeof raw.key === 'string' ? raw.key.trim().slice(0, 80) : '';
		if (!kind || !key) continue;
		/** @type {{kind: 'var'|'player'|'node', key: string, handle?: string}} */
		const w = { kind, key };
		if (kind === 'node' && typeof raw.handle === 'string' && raw.handle)
			w.handle = raw.handle.slice(0, 40);
		const id = watchKey(w);
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(w);
		if (out.length >= 40) break;
	}
	return out;
}

/**
 * Clean a persisted breakpoint list (node ids, unique, capped).
 * @param {any} list @returns {string[]}
 */
export function normalizeBreakpoints(list) {
	if (!Array.isArray(list)) return [];
	const out = [];
	const seen = new Set();
	for (const id of list) {
		if (typeof id !== 'string' || !id || id.length > 120 || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
		if (out.length >= 100) break;
	}
	return out;
}
