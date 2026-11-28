// Settings: optional ACTIVITY_* env vars. In Actions they arrive as one JSON of all repo variables (ACTIVITY_VARS,
// from `toJSON(vars)`); a real env var wins. See docs/design.md, "Settings".

export const SECTIONS = ['profile', 'stats', 'overview', 'heatmap', 'feed', 'projects', 'contributing', 'habits'] as const;
export type Section = typeof SECTIONS[number];

export interface Settings {
  user: string;
  /** Plain text: the browser tab, links back to the main page. */
  title: string;
  /** A custom ACTIVITY_TITLE as lines of segments (*starred* words are accented); null for the default "<user> on GitHub". */
  headline: HeadlineSegment[][] | null;
  timezone: string;
  favorites: string[];
  sections: Section[];
  feedComments: boolean;
  /** owner/repo this page is built from, linked in the footer; GITHUB_REPOSITORY in Actions */
  sourceRepo: string | null;
}

export interface HeadlineSegment { text: string; accent: boolean }

export class SettingsError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) { super(`settings: ${problems.join('; ')}`); this.problems = problems; }
}

const KNOWN = ['ACTIVITY_USER', 'ACTIVITY_TITLE', 'ACTIVITY_TIMEZONE', 'ACTIVITY_FAVORITES', 'ACTIVITY_SECTIONS', 'ACTIVITY_FEED_COMMENTS'];
const INTERNAL = ['ACTIVITY_VARS'];

export function loadSettings(env: Record<string, string | undefined>): Settings {
  const problems: string[] = [];
  let vars: Record<string, unknown> = {};
  if (env.ACTIVITY_VARS) {
    try { vars = JSON.parse(env.ACTIVITY_VARS); } catch { throw new SettingsError(['ACTIVITY_VARS is not valid JSON']); }
  }
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (k.startsWith('ACTIVITY_') && v != null) merged[k] = String(v);
  for (const [k, v] of Object.entries(env)) if (k.startsWith('ACTIVITY_') && v != null && !INTERNAL.includes(k)) merged[k] = v;

  for (const k of Object.keys(merged)) if (!KNOWN.includes(k)) {
    const near = closest(k, KNOWN);
    problems.push(`${k} is not a setting${near ? ` (did you mean ${near}?)` : ''}`);
  }
  if (problems.length) throw new SettingsError(problems);

  const get = (k: string) => merged[k]?.trim() || undefined;
  const user = get('ACTIVITY_USER') ?? env.GITHUB_REPOSITORY_OWNER;
  if (!user) problems.push('ACTIVITY_USER is not set, and there is no repo owner to default to');

  const timezone = get('ACTIVITY_TIMEZONE') ?? 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { problems.push(`ACTIVITY_TIMEZONE "${timezone}" is not an IANA time zone (e.g. Europe/London)`); }

  const favorites = list(get('ACTIVITY_FAVORITES'));
  for (const f of favorites) if (!/^[\w.-]+\/[\w.-]+$/.test(f)) problems.push(`ACTIVITY_FAVORITES "${f}" is not owner/repo`);

  const sectionsRaw = get('ACTIVITY_SECTIONS');
  const sections = sectionsRaw ? list(sectionsRaw) : SECTIONS.filter(s => s !== 'habits');
  for (const s of sections) if (!(SECTIONS as readonly string[]).includes(s)) problems.push(`ACTIVITY_SECTIONS "${s}" is not one of ${SECTIONS.join(', ')}`);

  const commentsRaw = get('ACTIVITY_FEED_COMMENTS') ?? 'false';
  if (!/^(true|false)$/i.test(commentsRaw)) problems.push(`ACTIVITY_FEED_COMMENTS "${commentsRaw}" is not true or false`);

  const titleRaw = get('ACTIVITY_TITLE');
  const headline = titleRaw ? parseHeadline(titleRaw) : null;
  if (titleRaw && titleRaw.split('|').some(line => (line.match(/\*/g) ?? []).length % 2)) problems.push(`ACTIVITY_TITLE "${titleRaw}" has an unmatched * (put * on both sides of the words to color, on one line)`);

  const sourceRepo = env.GITHUB_REPOSITORY?.trim() || null;
  if (sourceRepo && !/^[\w.-]+\/[\w.-]+$/.test(sourceRepo)) problems.push(`GITHUB_REPOSITORY "${sourceRepo}" is not owner/repo`);

  if (problems.length) throw new SettingsError(problems);
  const title = headline ? headline.map(line => line.map(s => s.text).join('')).join(' ').replace(/\s+/g, ' ').trim() : `${user} on GitHub`;
  return { user: user!, title, headline, timezone, favorites, sections: sections as Section[], feedComments: /^true$/i.test(commentsRaw), sourceRepo };
}

/** "*A LOT* GOING ON | AT THE MOMENT" → two lines; "A LOT" accented. */
function parseHeadline(raw: string): HeadlineSegment[][] {
  return raw.split('|').map(line => line.trim()).filter(Boolean)
    .map(line => line.split('*').map((text, i) => ({ text, accent: i % 2 === 1 })).filter(s => s.text));
}

const list = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** The known name within two edits of a typo, if any. */
function closest(name: string, known: string[]): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  return known.map(k => [k, dist(name, k)] as const).filter(([, n]) => n <= 2).sort((a, b) => a[1] - b[1])[0]?.[0];
}
