// A tiny HTML builder. Every interpolated value is escaped unless it is already Html (built by `h` or marked `raw`).
// Titles and commit messages come from anyone on GitHub, so escaping is the default, never opt-in.

export class Html { readonly value: string; constructor(value: string) { this.value = value; } toString() { return this.value; } }

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

type Part = Html | string | number | boolean | null | undefined | Part[];
const flat = (p: Part): string => p instanceof Html ? p.value : Array.isArray(p) ? p.map(flat).join('') : p === null || p === undefined || p === false ? '' : esc(p);

/** h`<p>${title}</p>` escapes `title`; arrays and nested h`` are joined as HTML; null, undefined and false render nothing. */
export function h(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0];
  parts.forEach((p, i) => { out += flat(p) + strings[i + 1]; });
  return new Html(out);
}
/** Trusted markup only (our own SVG numbers, never data from GitHub). */
export const raw = (s: string) => new Html(s);
