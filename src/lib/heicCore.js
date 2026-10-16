// 46-media H1 — HEIC/HEIF PHOTOS, the pure half (heic.js is the decoder wiring). A LEAF: no
// imports, so explorer.js, materialsHandler and the unit test can all read it for free.
//
// What a HEIC is to this app: a PHOTO, usually from a phone, that no browser but Safari can draw.
// So it is decoded ONCE, on the machine it was dropped on, into an ordinary JPEG, and from then on
// it IS a JPEG — that is what lands in the Library, what peers receive by content hash, and what a
// texture is made from. No peer ever needs the decoder, and the decoder (libheif, ~1.5 MB of
// wasm) is fetched only the first time somebody actually brings a HEIC.

/** The extensions a HEIC/HEIF still image arrives with (`hif` is Canon's). */
export const HEIC_EXTENSIONS = ['heic', 'heif', 'hif'];

/** The MIME types a browser or OS may report for one (often it reports NONE — see isHeicFileLike). */
export const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];

/** ISO-BMFF brands that make a file HEVC-coded HEIF. `mif1`/`msf1` are the generic HEIF brands,
 * shared with AVIF — those count only when an HEVC brand is listed beside them. */
const HEVC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
const GENERIC_BRANDS = ['mif1', 'msf1'];

/** @param {string} name */
export function extOf(name) {
	const m = /\.([^./\\]+)$/.exec(String(name ?? ''));
	return m ? m[1].toLowerCase() : '';
}

/** A file's NAME or TYPE says HEIC. @param {{name?: string, type?: string}} file */
export function isHeicFileLike(file) {
	if (!file) return false;
	if (HEIC_EXTENSIONS.includes(extOf(file.name ?? ''))) return true;
	return HEIC_TYPES.includes(String(file.type ?? '').toLowerCase());
}

/**
 * The BYTES say HEIC: an `ftyp` box whose major brand is an HEVC brand, or a generic HEIF brand
 * with an HEVC brand among the compatible ones (an AVIF lists `avif` there and is refused — the
 * browser draws those itself). Needs the first ~32 bytes.
 * @param {Uint8Array} bytes
 */
export function sniffHeic(bytes) {
	if (!bytes || bytes.length < 16) return false;
	const str = (/** @type {number} */ at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
	if (str(4) !== 'ftyp') return false;
	const size = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	const end = Math.min(bytes.length, size >= 16 ? size : 16);
	const major = str(8);
	if (HEVC_BRANDS.includes(major)) return true;
	if (!GENERIC_BRANDS.includes(major)) return false;
	for (let at = 16; at + 4 <= end; at += 4) if (HEVC_BRANDS.includes(str(at))) return true;
	return false;
}

/** The name the decoded photo takes: `IMG_0042.HEIC` -> `IMG_0042.jpg`. @param {string} name */
export function decodedName(name) {
	const base = String(name ?? '').replace(/\.(heic|heif|hif)$/i, '');
	return (base || 'photo') + '.jpg';
}

/** The largest side a decoded photo keeps (a 48 MP phone photo is 8064 px; WebGL's common texture
 * limit is 16384, and the Library caps an item at 25 MB). */
export const HEIC_MAX_SIDE = 8192;

/** Scale (w, h) down so the longer side is at most `max`, never up. @param {number} w @param {number} h @param {number} [max] */
export function fitWithin(w, h, max = HEIC_MAX_SIDE) {
	const s = Math.min(1, max / Math.max(1, w, h));
	return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scale: s };
}
