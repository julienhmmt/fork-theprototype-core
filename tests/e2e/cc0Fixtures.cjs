// 47-cc0 — the Asset Browser's network, recorded. The LIST documents are real answers recorded
// from api.polyhaven.com and ambientcg.com on 2026-10-16 and trimmed to a few rows
// (fixtures/cc0/*.json); the FILES behind them are tiny bytes built here (a one-quad glTF with a
// texture, a 4x2 Radiance .hdr, an ambientCG-shaped zip of PNG maps), served in the same shapes and
// at the same hosts the real sites use. Everything goes through `page.route`, so the suite never
// touches the network (CI has none) — the live checks are the lane's manual ones (STATUS).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { zipSync } = require('fflate');

const DIR = path.join(__dirname, 'fixtures', 'cc0');
const json = (/** @type {string} */ f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

/** a solid-colour RGBA PNG, w x h @param {number} w @param {number} h @param {number[]} rgba */
function png(w, h, rgba) {
	const row = Buffer.alloc(1 + w * 4);
	for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
	const raw = Buffer.concat(Array.from({ length: h }, () => row));
	const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(zlib.crc32(td) >>> 0);
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** a flat (non-RLE: width < 8) Radiance RGBE image, 4 x 2 */
function hdr() {
	const head = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n', 'ascii');
	const px = Buffer.alloc(4 * 2 * 4);
	for (let i = 0; i < 8; i++) px.set([200, 180, 140, 129], i * 4);
	return Buffer.concat([head, px]);
}

/** a one-quad glTF (positions, uvs, indices in a .bin) with a base-colour texture beside it */
function quadModel(id) {
	const pos = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]);
	const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
	const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
	const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(uv.buffer), Buffer.from(idx.buffer)]);
	const tex = `textures/${id}_diff_1k.png`;
	const gltf = {
		asset: { version: '2.0', generator: 'cc0 fixture' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name: id }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
		materials: [{ name: id, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
		textures: [{ source: 0 }],
		images: [{ uri: tex }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 0, 0.5] },
			{ bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
			{ bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' }
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: 48 },
			{ buffer: 0, byteOffset: 48, byteLength: 32 },
			{ buffer: 0, byteOffset: 80, byteLength: 12 }
		],
		buffers: [{ uri: `${id}.bin`, byteLength: bin.length }]
	};
	return { gltf: Buffer.from(JSON.stringify(gltf)), bin, tex, texBytes: png(8, 8, [168, 112, 60, 255]) };
}

const DL = 'https://dl.polyhaven.org/file/ph-assets';
const ACG_CDN = 'https://acg-download.struffelproductions.com/file/ambientCG-Web/download';

/**
 * Build the whole fake network once per suite.
 * @returns {{routes: (page: any, state?: any) => Promise<void>, state: any, counts: Record<string, number>, ids: any}}
 */
function makeCc0Network() {
	const models = json('ph-models.json');
	const hdris = json('ph-hdris.json');
	const textures = json('ph-textures.json');
	const acg = json('acg-assets-wood.json');
	const ids = { model: Object.keys(models)[0], hdri: Object.keys(hdris)[0], texture: Object.keys(textures)[0], material: acg.assets[0].id };
	/** @type {Record<string, {body: Buffer, type: string}>} */
	const files = {};
	/** @type {Record<string, any>} */
	const filesDocs = {};
	for (const id of Object.keys(models)) {
		const m = quadModel(id);
		const base = `${DL}/Models/gltf/1k/${id}`;
		files[`${base}/${id}_1k.gltf`] = { body: m.gltf, type: 'model/gltf+json' };
		files[`${base}/${id}.bin`] = { body: m.bin, type: 'application/octet-stream' };
		files[`${base}/${m.tex}`] = { body: m.texBytes, type: 'image/png' };
		filesDocs[id] = {
			gltf: {
				'1k': { gltf: { url: `${base}/${id}_1k.gltf`, size: m.gltf.length, include: { [`${id}.bin`]: { url: `${base}/${id}.bin`, size: m.bin.length }, [m.tex]: { url: `${base}/${m.tex}`, size: m.texBytes.length } } } },
				// a 2k that would not fit the Library: the "Pick 1k" refusal
				'2k': { gltf: { url: `${base}/${id}_2k.gltf`, size: 4000, include: { [`${id}.bin`]: { url: `${base}/${id}.bin`, size: 30 * 1024 * 1024 } } } }
			}
		};
	}
	for (const id of Object.keys(hdris)) {
		for (const r of ['1k', '2k']) {
			const url = `${DL}/HDRIs/hdr/${r}/${id}_${r}.hdr`;
			files[url] = { body: hdr(), type: 'application/octet-stream' };
		}
		filesDocs[id] = { hdri: { '1k': { hdr: { url: `${DL}/HDRIs/hdr/1k/${id}_1k.hdr`, size: hdr().length } }, '2k': { hdr: { url: `${DL}/HDRIs/hdr/2k/${id}_2k.hdr`, size: hdr().length } } } };
	}
	for (const id of Object.keys(textures)) {
		const at = (/** @type {string} */ k, /** @type {number[]} */ c) => {
			const url = `${DL}/Textures/png/1k/${id}/${id}_${k}_1k.png`;
			files[url] = { body: png(8, 8, c), type: 'image/png' };
			return { '1k': { png: { url, size: files[url].body.length } } };
		};
		filesDocs[id] = { Diffuse: at('diff', [90, 120, 70, 255]), nor_gl: at('nor_gl', [128, 128, 255, 255]), Rough: at('rough', [200, 200, 200, 255]) };
	}
	for (const a of acg.assets) {
		const zipName = `${a.id}_1K-JPG.zip`;
		const pre = `${a.id}_1K-JPG`;
		const zip = Buffer.from(
			zipSync({
				[`${pre}.usdc`]: new Uint8Array(4),
				[`${pre}_Color.png`]: png(8, 8, [150, 100, 50, 255]),
				[`${pre}_NormalGL.png`]: png(8, 8, [128, 128, 255, 255]),
				[`${pre}_NormalDX.png`]: png(8, 8, [128, 127, 255, 255]),
				[`${pre}_Roughness.png`]: png(8, 8, [178, 178, 178, 255]),
				[`${a.id}.png`]: png(4, 4, [0, 0, 0, 255])
			})
		);
		files[`${ACG_CDN}/${a.id}_fx/${zipName}`] = { body: zip, type: 'application/zip' };
	}
	const thumb = png(16, 16, [120, 140, 160, 255]);
	/** @type {Record<string, number>} */
	const counts = {};
	const state = { phStatus: 200, relayStatus: 200, cdnStatus: 200, offline: false };
	const bump = (/** @type {string} */ k) => (counts[k] = (counts[k] ?? 0) + 1);

	/** @param {any} page */
	async function routes(page) {
		const ok = (/** @type {any} */ route, /** @type {any} */ body, type = 'application/json', extra = {}) =>
			route.fulfill({ status: 200, contentType: type, headers: { 'access-control-allow-origin': '*', ...extra }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
		// offline: every request fails the way a dropped connection does (setOffline alone does not
		// stop page.route from answering)
		const guard = (/** @type {any} */ fn) => (/** @type {any} */ route) => (state.offline ? route.abort('internetdisconnected') : fn(route));
		const fail = (/** @type {any} */ route, /** @type {number} */ status) => route.fulfill({ status, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'fixture error ' + status });
		// nothing else from either site, ever (the suite is network-free). Registered FIRST:
		// Playwright tries routes newest-first, so the specific handlers below win over it.
		await page.route(/https:\/\/([\w-]+\.)?(polyhaven\.(com|org)|ambientcg\.com)\//, (route) => fail(route, 599));
		await page.route('https://api.polyhaven.com/**', guard((route) => {
			const u = new URL(route.request().url());
			bump('ph-api');
			if (state.phStatus !== 200) return fail(route, state.phStatus);
			const t = u.searchParams.get('t');
			if (u.pathname === '/assets') return ok(route, t === 'models' ? models : t === 'hdris' ? hdris : t === 'textures' ? textures : {});
			const cat = /^\/categories\/(\w+)$/.exec(u.pathname);
			if (cat) return ok(route, json(`ph-categories-${cat[1]}.json`));
			const f = /^\/files\/([\w.-]+)$/.exec(u.pathname);
			if (f && filesDocs[f[1]]) return ok(route, filesDocs[f[1]]);
			return fail(route, 404);
		}));
		await page.route('https://dl.polyhaven.org/**', guard((route) => {
			bump('ph-dl');
			const hit = files[route.request().url()];
			if (!hit) return fail(route, 404);
			return ok(route, hit.body, hit.type, { 'content-length': String(hit.body.length) });
		}));
		await page.route('https://cdn.polyhaven.com/**', (route) => ok(route, thumb, 'image/png'));
		await page.route('https://acg-media.struffelproductions.com/**', (route) => ok(route, thumb, 'image/png'));
		await page.route('**/cc0/acg/**', guard((route) => {
			const u = new URL(route.request().url());
			bump('relay');
			if (state.relayStatus !== 200) return fail(route, state.relayStatus);
			if (u.pathname.endsWith('/acg/assets')) {
				bump('relay-assets:' + (u.searchParams.get('q') ?? '') + ':' + (u.searchParams.get('category') ?? ''));
				return ok(route, acg);
			}
			if (u.pathname.endsWith('/acg/categories')) return ok(route, json('acg-categories.json'));
			if (u.pathname.endsWith('/acg/resolve')) {
				const file = u.searchParams.get('file') ?? '';
				const id = file.replace(/_\dK-JPG\.zip$/, '');
				return ok(route, { url: `${ACG_CDN}/${id}_fx/${file}` });
			}
			return fail(route, 404);
		}));
		await page.route('https://acg-download.struffelproductions.com/**', guard((route) => {
			bump('acg-cdn');
			if (state.cdnStatus !== 200) return fail(route, state.cdnStatus);
			const hit = files[route.request().url()];
			if (!hit) return fail(route, 404);
			return ok(route, hit.body, hit.type, { 'content-length': String(hit.body.length) });
		}));
	}
	return { routes, state, counts, ids };
}

module.exports = { makeCc0Network, png };
