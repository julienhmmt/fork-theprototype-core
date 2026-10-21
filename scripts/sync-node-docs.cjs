// Regenerate the docs-site flow node reference (docs/nodes.md in the theprototype-docs
// checkout) from ONE source: src/lib/nodeDocs.js for the line per node, src/lib/nodeCatalog.js
// for the groups and labels - so the table and the editor's info pane can never disagree
// (the guard test asserts the page carries the exact text). Run after editing either:
//   DOCS_REPO=../theprototype-docs node scripts/sync-node-docs.cjs
//
// 49 J4: it MERGES into the page rather than overwriting it. The tables are the generated part;
// what a writer added around them - a paragraph under the intro, a note under a group heading, a
// whole section the catalog does not have (the Kit piece table), a row linking a guide page rather
// than nodes/<type>.md - is kept. Overwriting threw those away, and the guard could not see it.
// `--check` writes nothing and exits 1 when the page is not what a run would write.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { catalogGroups } = require('./node-catalog-scan.cjs');

const root = path.join(__dirname, '..');
const DOCS = process.env.DOCS_REPO ? path.resolve(process.env.DOCS_REPO) : path.join(root, '..', 'theprototype-docs');
const CHECK = process.argv.includes('--check');

const TITLE = '# Flow Nodes';
const INTRO = `Every node the [Flow editor](node-system.md) offers, grouped exactly as the palette groups
them. Each node's one-line description is the same text the editor shows in its info pane
(and the palette's tooltip) when you select the node, so the two cannot disagree. Nodes with
their own page link to it.`;

/**
 * The page as it stands: what precedes the first group, and each `## ` section split into its
 * prose (every line that is not a table row) and the link each bold label carries.
 * @param {string} page
 */
function parsePage(page) {
	const lines = page.replace(/\r\n/g, '\n').split('\n');
	/** @type {string[]} */
	const preamble = [];
	/** @type {{heading: string, prose: string[], raw: string[]}[]} */
	const sections = [];
	/** @type {Map<string, string>} label -> link target */
	const links = new Map();
	for (const line of lines) {
		if (line.startsWith('## ')) {
			sections.push({ heading: line.slice(3).trim(), prose: [], raw: [line] });
			continue;
		}
		const cur = sections[sections.length - 1];
		if (!cur) {
			preamble.push(line);
			continue;
		}
		cur.raw.push(line);
		if (line.startsWith('|')) {
			const m = /^\|\s*\[\*\*(.+?)\*\*\]\(([^)]+)\)/.exec(line);
			if (m) links.set(m[1], m[2]);
		} else cur.prose.push(line);
	}
	return { preamble, sections, links };
}

/** drop leading and trailing blank lines @param {string[]} lines */
function trimBlank(lines) {
	const out = [...lines];
	while (out.length && !out[0].trim()) out.shift();
	while (out.length && !out[out.length - 1].trim()) out.pop();
	return out;
}

(async () => {
	const { NODE_DOCS } = await import(pathToFileURL(path.join(root, 'src', 'lib', 'nodeDocs.js')).href);
	const groups = catalogGroups(root).filter((g) => g.items.length);
	if (!fs.existsSync(path.join(DOCS, 'docs'))) {
		console.log('no docs checkout at ' + DOCS + ' - nothing written');
		process.exit(0);
	}
	const file = path.join(DOCS, 'docs', 'nodes.md');
	const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	const old = parsePage(before);
	const pages = new Set(fs.existsSync(path.join(DOCS, 'docs', 'nodes')) ? fs.readdirSync(path.join(DOCS, 'docs', 'nodes')).map((f) => f.replace(/\.md$/, '')) : []);

	// the intro, then whatever a writer added below it
	const introLines = INTRO.split('\n');
	const extra = trimBlank(old.preamble.filter((l) => l.trim() !== TITLE && !introLines.includes(l)));
	let out = TITLE + '\n\n' + INTRO + '\n\n' + (extra.length ? extra.join('\n') + '\n\n' : '');

	const generated = new Set(groups.map((g) => g.group));
	for (const g of groups) {
		const prose = trimBlank(old.sections.find((s) => s.heading === g.group)?.prose ?? []);
		out += `## ${g.group}\n\n` + (prose.length ? prose.join('\n') + '\n\n' : '') + '| Node | What it does |\n|---|---|\n';
		for (const it of g.items) {
			const target = pages.has(it.type) ? `nodes/${it.type}.md` : old.links.get(it.label);
			const name = target ? `[**${it.label}**](${target})` : `**${it.label}**`;
			out += `| ${name} | ${NODE_DOCS[it.type] ?? ''} |\n`;
		}
		out += '\n';
	}
	// sections the catalog does not generate (the Kit piece table) stay, in their order
	for (const s of old.sections) {
		if (generated.has(s.heading)) continue;
		out += trimBlank(s.raw).join('\n') + '\n\n';
	}
	out = out.replace(/\n+$/, '\n');

	const count = groups.reduce((n, g) => n + g.items.length, 0);
	if (CHECK) {
		const same = out === before.replace(/\r\n/g, '\n');
		console.log(same ? `nodes.md is current (${count} nodes in ${groups.length} groups)` : 'nodes.md is NOT what sync-node-docs would write - run it');
		process.exit(same ? 0 : 1);
	}
	fs.writeFileSync(file, out);
	console.log(`Wrote ${file} (${count} nodes in ${groups.length} groups)`);
})();
