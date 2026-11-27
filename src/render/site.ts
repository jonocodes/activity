// Turns the render model into the site's files. No rules live here, only presentation; see src/model.ts.
import { readFileSync } from 'node:fs';
import type { Model, FeedRow, FeedItem, Week, RepoRow, YearSection, Kind } from '../model.ts';
import { h, raw, esc, type Html } from './html.ts';

const LABEL: Record<Kind, string> = { commit: 'commit', pr: 'pull request', issue: 'issue', discussion: 'discussion', discussion_reply: 'reply', review: 'review',
  new_repo: 'new repo', fork: 'fork', issue_comment: 'comment', commit_comment: 'commit comment' };
const GROUP: Record<Kind, string> = { commit: '{n} commits', pr: 'opened {n} pull requests', issue: 'opened {n} issues', discussion: 'started {n} discussions',
  discussion_reply: '{n} discussion replies', review: 'reviewed {n} pull requests', new_repo: 'created {n} repos', fork: 'forked {n} repos', issue_comment: '{n} comments', commit_comment: '{n} commit comments' };
const asset = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/** Every file of the site, by path relative to the site root. */
export function renderSite(m: Model): Record<string, string> {
  const files: Record<string, string> = { 'site.css': asset('./site.css'), 'site.js': asset('./site.js'), 'index.html': page(m, '', m.title, mainBody(m)).value };
  m.years.forEach((y, i) => { files[`${y.year}/index.html`] = page(m, '../', `${y.year} · ${m.title}`, yearPage(m, y, m.years[i + 1]?.year, m.years[i - 1]?.year)).value; });
  files['summary.json'] = JSON.stringify({ owner: m.owner, builtAt: m.builtAt, kinds: m.kindCounts, items: Object.values(m.kindCounts).reduce((s, n) => s + (n ?? 0), 0) }, null, 2) + '\n';
  return files;
}

// ---------- page shell ----------
const page = (m: Model, base: string, title: string, body: Html) => h`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${base}site.css">
<script defer src="${base}site.js"></script>
</head>
<body>
<main class="wrap">
${body}
<footer>Built ${time(m, m.builtAt, true)} from public GitHub activity. Dates are in ${m.timezone}.</footer>
</main>
</body>
</html>
`;

function mainBody(m: Model): Html {
  const on = (s: Model['sections'][number]) => m.sections.includes(s);
  const tabs = ([['feed', 'Feed'], ['projects', 'Projects'], ['contributing', 'Contributing to']] as const).filter(([s]) => on(s));
  return h`<h1>${m.title}</h1>
${on('profile') ? profile(m) : null}
${on('stats') ? stats(m) : null}
${on('overview') ? overview(m) : null}
${on('heatmap') ? h`<div aria-label="Contributions, last 12 months">${heatmap(m.heatmap)}</div>` : null}
${on('habits') ? habits(m) : null}
${tabs.length > 1 ? h`<nav class="tabs">${tabs.map(([id, label]) => h`<a href="#${id}">${label}</a>`)}</nav>` : null}
${on('feed') ? feedPanel(m) : null}
${on('projects') ? projectsPanel(m) : null}
${on('contributing') ? contributingPanel(m) : null}`;
}

// ---------- top of the page ----------
function profile(m: Model) {
  const p = m.profile;
  return h`<p class="profile">${[
    p.bio && h`<span>${p.bio}</span>`, h`<span>on GitHub since ${p.since}</span>`, p.location && h`<span>${p.location}</span>`, p.company && h`<span>${p.company}</span>`,
    p.orgs.length > 0 && h`<span>orgs: ${p.orgs.map((o, i) => h`${i ? ', ' : ''}<a href="https://github.com/${o}">${o}</a>`)}</span>`,
    h`<span><a href="${p.achievementsUrl}">achievements</a></span>`]}</p>`;
}
function stats(m: Model) {
  const s = m.stats, n = (v: number, l: string) => h`<div><span class="n">${v.toLocaleString('en-US')}</span><span class="l">${l}</span></div>`;
  return h`<div class="stats">${n(s.allTime.commits, 'commits')}${n(s.allTime.prs, 'pull requests')}${n(s.allTime.issues, 'issues')}${n(s.allTime.discussions, 'discussions')}${n(s.allTime.reposCreated, 'repos created')}
<div class="sep"></div>${n(s.last12.contributions, 'contributions, last 12 months')}${n(s.last12.currentStreak, 'day streak now')}${n(s.last12.longestStreak, 'longest streak')}${s.privateLast12 ? n(s.privateLast12, 'private, last 12 months') : null}</div>`;
}
const meterList = (title: string, entries: [string, number, string][]) => {
  const max = Math.max(1, ...entries.map(e => e[1]));
  return h`<div class="meter"><h4>${title}</h4>${entries.map(([name, v, label]) => h`<div class="m"><span>${name}</span><span class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="v">${label}</span></div>`)}</div>`;
};
function overview(m: Model) {
  const o = m.overview;
  if (!o.licences.length && !o.languages.length) return null;
  return h`<div class="overview">${o.licences.length ? meterList('Licences, own repos', o.licences.map(l => [l.name, l.count, String(l.count)])) : h`<div></div>`}${o.languages.length ? meterList('Languages, by commits', o.languages.map(l => [l.name, l.commits, `${Math.round(l.share * 100)}%`])) : null}</div>`;
}
function habits(m: Model) {
  const cols = (values: number[], labels: string[]) => {
    const w = 24 * values.length, hgt = 60, max = Math.max(1, ...values), bw = 24 - 4;
    return raw(`<svg viewBox="0 0 ${w} ${hgt + 14}" width="100%" role="img">${values.map((v, i) => { const bh = v ? Math.max(2, v / max * hgt) : 0;
      return `<rect x="${i * 24 + 2}" y="${hgt - bh}" width="${bw}" height="${bh}" rx="2" fill="var(--viz)"><title>${esc(labels[i])}: ${v}</title></rect><text x="${i * 24 + 12}" y="${hgt + 12}" font-size="9" text-anchor="middle" fill="var(--muted)">${esc(labels[i].slice(0, values.length > 7 ? 2 : 3))}</text>`; }).join('')}</svg>`);
  };
  return h`<div class="habits"><div class="chart"><h4>Weekdays</h4>${cols(m.habits.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}</div><div class="chart"><h4>Hours</h4>${cols(m.habits.hours, m.habits.hours.map((_, i) => String(i).padStart(2, '0')))}</div></div>`;
}
function heatmap(days: { date: string; count: number }[]) {
  if (!days.length) return null;
  const max = Math.max(1, ...days.map(d => d.count)), cell = 11, gap = 2, first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const rects = days.map((d, i) => { const idx = i + first, x = Math.floor(idx / 7) * (cell + gap), y = (idx % 7) * (cell + gap);
    const op = d.count === 0 ? .08 : [.3, .5, .75, 1][Math.min(3, Math.floor(4 * Math.sqrt(d.count / max) - .001))];
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="var(--heat)" fill-opacity="${op}"><title>${d.date}: ${d.count}</title></rect>`; }).join('');
  return raw(`<svg class="heat" viewBox="0 0 ${Math.ceil((days.length + first) / 7) * (cell + gap)} ${7 * (cell + gap)}" role="img">${rects}</svg>`);
}

// ---------- feed ----------
function feedPanel(m: Model) {
  return h`<section id="feed" data-panel data-counts="${JSON.stringify(m.kindCounts)}" data-labels="${JSON.stringify(LABEL)}">
<h2>Feed</h2>
<h2 class="since">Last 12 months</h2>
${weeks(m, m.feed.weeks) ?? h`<p class="muted">Nothing in the last 12 months.</p>`}
${m.years.map(y => h`<details class="year"><summary>${y.year} <span class="muted small">· ${yearItems(y).toLocaleString('en-US')} items</span></summary><div class="year-body"><a href="${y.year}/">Open ${y.year}</a></div></details>`)}
</section>`;
}
const yearItems = (y: YearSection) => y.weeks.reduce((s, w) => s + w.rows.reduce((t, r) => t + (r.group ? r.items.length : 1), 0), 0);
function weeks(m: Model, list: Week[]) {
  if (!list.length) return null;
  return h`${list.map(w => h`<div class="week"><h3>Week of ${weekLabel(w.start)}</h3><ul class="rows">${w.rows.map(r => feedRow(m, r))}</ul></div>`)}`;
}
function feedRow(m: Model, r: FeedRow) {
  if (!r.group) return h`<li class="row" data-kind="${r.kind}" data-repo="${r.repo}">${tag(r.kind)}<span class="t"><span class="repo">${short(m, r.repo)}</span> · <a href="${r.url}">${r.title}</a></span><span class="muted small">${time(m, r.at)}</span></li>`;
  return h`<li class="row group" data-kind="${r.kind}" data-repo="${r.repo}"><details><summary>${tag(r.kind)}<span class="t"><span class="repo">${short(m, r.repo)}</span> · ${GROUP[r.kind].replace('{n}', String(r.items.length))}</span><span class="muted small">${time(m, r.at)}</span></summary>
<ul>${r.items.map((i: FeedItem) => h`<li><a href="${i.url}">${i.title}</a> <span class="muted small">${time(m, i.at)}</span></li>`)}</ul></details></li>`;
}

// ---------- a year's own page (and the fragment the main page loads) ----------
function yearPage(m: Model, y: YearSection, prev?: number, next?: number) {
  return h`<p><a href="../">← ${m.title}</a>${prev ? h` · <a href="../${prev}/">${prev}</a>` : null}${next ? h` · <a href="../${next}/">${next}</a>` : null}</p>
<h1>${y.year}</h1>
<div id="year-body">
<p class="muted small">${y.totals.contributions.toLocaleString('en-US')} contributions · ${y.totals.commits} commits · ${y.totals.prs} pull requests · ${y.totals.issues} issues · ${y.totals.discussions} discussions · ${y.totals.newRepos} new repos${y.mostActive.length ? h`<br>Most active in: ${y.mostActive.map((a, i) => h`${i ? ', ' : ''}<a href="https://github.com/${a.repo}">${short(m, a.repo)}</a> (${a.count})`)}` : null}</p>
${heatmap(y.calendar)}
${weeks(m, y.weeks.map(w => ({ ...w, rows: w.rows })))}
</div>`;
}

// ---------- projects and contributing to ----------
function projectsPanel(m: Model) {
  const p = m.projects;
  return h`<section id="projects" data-panel>
<h2>Projects</h2>
${p.favorites.length ? h`<h2>Favorites</h2>${p.favorites.map(r => repoRow(m, r, 'depth'))}` : null}
<h2>My projects</h2>
${p.mine.map(r => repoRow(m, r, 'depth'))}
${p.idleForks ? h`<p class="note">${p.idleForks} forks without work of yours aren't listed; forks you've worked in count on their upstream's row under Contributing to.</p>` : null}
</section>`;
}
function contributingPanel(m: Model) {
  const c = m.contributing;
  if (!c.rows.length) return h`<section id="contributing" data-panel><h2>Contributing to</h2><p class="muted">No work in other people's repos yet.</p></section>`;
  const axis = c.axis!, from = Date.parse(axis.from), to = Date.parse(axis.to);
  return h`<section id="contributing" data-panel>
<h2>Contributing to</h2>
<div class="kpis"><div><span class="n">${c.repos}</span><span class="l">repos</span></div><div><span class="n">${c.owners}</span><span class="l">owners and orgs</span></div><div><span class="n">${c.firstYear}</span><span class="l">first contribution</span></div></div>
${perYear(c.perYear)}
<div class="axis"><span></span>${axisSvg(from, to)}</div>
${c.rows.map(r => repoRow(m, r, 'breadth', [from, to]))}
</section>`;
}
function repoRow(m: Model, r: RepoRow, mode: 'depth' | 'breadth', axis?: [number, number]) {
  const counts = ([['commits', 'commit'], ['prs', 'pull request'], ['issues', 'issue'], ['discussions', 'discussion']] as const)
    .filter(([k]) => mode === 'depth' || r.counts[k]).map(([k, l], i) => h`${i ? ' · ' : ''}<b>${r.counts[k]}</b> ${l}${r.counts[k] === 1 ? '' : 's'}`);
  const filter = [r.repo, ...r.forks].join(' ');
  return h`<div class="proj${mode === 'breadth' ? ' wide' : ''}" data-filter="${filter}">
<div><a class="name" href="${r.url}">${short(m, r.repo)}</a>${r.licence ? h`<span class="badge">${r.licence}</span>` : null}${r.archived ? h`<span class="badge">archived</span>` : null}${r.forkOf ? h`<span class="badge">fork of ${r.forkOf}</span>` : null}${r.upstreamDeleted ? h`<span class="badge">fork of a deleted repo</span>` : null}${r.stars ? h`<span class="muted small"> ★ ${r.stars.toLocaleString('en-US')}</span>` : null}${r.forks.length ? h`<span class="muted small"> · incl. commits in <a href="https://github.com/${r.forks[0]}">your fork</a></span>` : null}</div>
${r.description ? h`<div class="small">${r.description}</div>` : null}
<div class="counts">${counts} · last active ${r.lastActive ? time(m, r.lastActive) : '—'}</div>
<div class="chart">${mode === 'depth' ? monthBars(r.monthly) : dotStrip(m, r, axis!)}</div>
</div>`;
}

// ---------- small charts (one colour; every number here is ours, every title is escaped) ----------
function monthBars(months: number[], w = 150, hgt = 26) {
  const max = Math.max(1, ...months), bw = w / 24 - 2;
  return raw(`<svg width="${w}" height="${hgt}" role="img" aria-label="commits per month, last 24 months">${months.map((v, i) => { const x = (i * (bw + 2)).toFixed(1), bh = v ? Math.max(3, v / max * (hgt - 2)) : 0;
    return `<rect x="${x}" y="${hgt - 2}" width="${bw.toFixed(1)}" height="2" fill="var(--viz-track)"/>${v ? `<rect x="${x}" y="${(hgt - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="var(--viz)"><title>${v} commits</title></rect>` : ''}`; }).join('')}</svg>`);
}
function dotStrip(m: Model, r: RepoRow, [from, to]: [number, number], w = 300, hgt = 18) {
  const x = (t: string) => ((Date.parse(t) - from) / Math.max(1, to - from)) * (w - 8) + 4;
  return raw(`<svg class="tl" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="activity over time"><line x1="0" x2="${w}" y1="${hgt / 2}" y2="${hgt / 2}" stroke="var(--line)"/>${r.dots.map(d =>
    `<circle cx="${x(d.at).toFixed(1)}" cy="${hgt / 2}" r="4" fill="var(--viz)" fill-opacity=".75" stroke="var(--bg)" stroke-width="1"><title>${esc(LABEL[d.kind])} · ${esc(dateLabel(m, d.at))}</title></circle>`).join('')}</svg>`);
}
function axisSvg(from: number, to: number, w = 300) {
  const y0 = new Date(from).getUTCFullYear(), y1 = new Date(to).getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0 + 1) / 7));
  const x = (t: number) => ((t - from) / Math.max(1, to - from)) * (w - 8) + 4;
  let ticks = ''; for (let y = y0 + 1; y <= y1; y += step) ticks += `<text x="${x(Date.UTC(y, 0, 1)).toFixed(1)}" y="10" font-size="10" fill="var(--muted)" text-anchor="middle">${y}</text>`;
  return raw(`<svg class="tl" viewBox="0 0 ${w} 14" aria-hidden="true">${ticks}</svg>`);
}
function perYear(years: { year: number; repos: number }[]) {
  if (!years.length) return null;
  const w = 868, hgt = 90, bw = w / years.length - 4, max = Math.max(1, ...years.map(y => y.repos));
  return h`<div class="chart"><h4>Other people's repos worked in, per year</h4>${raw(`<svg viewBox="0 0 ${w} ${hgt}" width="100%" role="img">${years.map((y, i) => { const x = i * (bw + 4), bh = y.repos ? Math.max(3, y.repos / max * (hgt - 30)) : 0;
    return (y.repos ? `<rect x="${x.toFixed(1)}" y="${(hgt - 16 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="var(--viz)"><title>${y.year}: ${y.repos} repos</title></rect><text x="${(x + bw / 2).toFixed(1)}" y="${(hgt - 20 - bh).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--muted)">${y.repos}</text>` : '')
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${hgt - 3}" font-size="10" text-anchor="middle" fill="var(--muted)">${String(y.year).slice(2)}</text>`; }).join('')}</svg>`)}</div>`;
}

// ---------- small helpers ----------
const tag = (k: Kind) => h`<span class="tag k-${k}">${LABEL[k]}</span>`;
const short = (m: Model, repo: string) => repo.startsWith(`${m.owner}/`) ? repo.slice(m.owner.length + 1) : repo;
const weekLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function dateLabel(m: Model, iso: string, withTime = false) {
  const sameYear = new Date(iso).toLocaleDateString('en-US', { timeZone: m.timezone, year: 'numeric' }) === new Date(m.builtAt).toLocaleDateString('en-US', { timeZone: m.timezone, year: 'numeric' });
  return new Date(iso).toLocaleString('en-US', { timeZone: m.timezone, month: 'short', day: 'numeric', ...(sameYear && !withTime ? {} : { year: 'numeric' }), ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) });
}
/** A plain date in the owner's time zone; site.js turns ones under a week old into "5 h ago" when viewed. */
const time = (m: Model, iso: string, withTime = false) => h`<time datetime="${iso}">${dateLabel(m, iso, withTime)}</time>`;
