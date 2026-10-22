// 49 J4 — the 3D labels read their font data from THIS deployment, not a CDN. Installed once by
// side-effect import from App.svelte, before any <Text> mounts: troika ignores the setting once
// it has requested its first font.
//
// troika-three-text (threlte's <Text>) resolves glyphs through unicode-font-resolver, whose data
// it fetched from cdn.jsdelivr.net at run time — labels broke offline or behind a blocker, and a
// failed fetch was an uncaught page error (48 G1). The copy under static/ is written by
// scripts/fetch-troika-fonts.cjs (latin/European scripts + the VR panels' symbols); a glyph
// outside it falls back to the resolver's own CDN, as every glyph used to.
//
// Resolved against document.baseURI, so an exported game (relative paths, any folder) finds the
// copy its zip carries.
// @ts-ignore - troika-three-text ships no type declarations (threlte's <Text> dependency)
import { configureTextBuilder } from 'troika-three-text';

/** the data's folder, relative to the app's base */
export const UNICODE_FONTS_PATH = 'fonts/unicode-font-resolver';

/** the absolute URL troika is pointed at ('' outside a browser) */
export function unicodeFontsUrl() {
	if (typeof document === 'undefined') return '';
	return new URL(UNICODE_FONTS_PATH, document.baseURI).href.replace(/\/$/, '');
}

if (typeof document !== 'undefined') configureTextBuilder({ unicodeFontsURL: unicodeFontsUrl() });
