// PROTOTYPE, throwaway. Splits prototype/data.json the way the real page will load:
//   data-main.json  everything for the main page: the last 12 months in full, and only kind/date/repo for older items
//                   (enough for every count, chart and repo row);
//   years/<y>.json  one file per older year with its items in full (titles, links), fetched when that year is opened.
// Years follow the owner's time zone: ACTIVITY_TIMEZONE, else this machine's.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('.', import.meta.url);
const TZ = process.env.ACTIVITY_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const D = JSON.parse(readFileSync(new URL('data.json', dir)));
const year = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(new Date(iso));
const utc = iso => new Date(iso).toISOString();
const cutoff = new Date(Date.parse(D.generatedAt) - 365 * 864e5).toISOString();

// commits counted once, as the collector does
const bySha = {};
for (const c of D.commits) {
  const rank = x => !x.fork ? 0 : x.repo.startsWith(D.profile.login + '/') ? 1 : 2, cur = bySha[c.sha];
  if (!cur || rank(c) < rank(cur)) bySha[c.sha] = { ...c, at: utc(c.at) };
}
const commits = Object.values(bySha);
const items = D.items.map(i => ({ ...i, at: utc(i.at) }));

const main = { ...D, items: [], commits: [], split: { tz: TZ, cutoff, years: [] } };
const years = {};
for (const i of items) {
  if (i.at >= cutoff) main.items.push(i);
  else { main.items.push({ kind: i.kind, at: i.at, repo: i.repo }); (years[year(i.at)] ??= { items: [], commits: [] }).items.push(i); }
}
for (const c of commits) {
  if (c.at >= cutoff) main.commits.push(c);
  else { main.commits.push({ sha: c.sha, at: c.at, repo: c.repo, fork: c.fork }); (years[year(c.at)] ??= { items: [], commits: [] }).commits.push(c); }
}
main.split.years = Object.keys(years).sort();
// only the external repos a row on the page needs; each older year's calendar travels with that year
const shown = new Set([...items, ...commits.map(c => ({ ...c, kind: 'commit' }))].filter(i => ['commit', 'pr', 'issue', 'discussion', 'discussion_reply'].includes(i.kind)).map(i => i.repo));
for (const r of D.repos) if (r.parent) shown.add(r.parent.nameWithOwner);
main.externalRepos = Object.fromEntries(Object.entries(D.externalRepos ?? {}).filter(([n]) => shown.has(n)));
main.years = Object.fromEntries(Object.entries(D.years).map(([y, v]) => [y, { total: v.total, private: v.private }]));
for (const [y, v] of Object.entries(D.years)) (years[y] ??= { items: [], commits: [] }).calendar = v.calendar;

rmSync(new URL('years', dir), { recursive: true, force: true });
mkdirSync(new URL('years', dir));
const kb = s => `${(s.length / 1024).toFixed(0)} KB raw, ${(gzipSync(s).length / 1024).toFixed(0)} KB gzipped`;
const mainJson = JSON.stringify(main);
writeFileSync(new URL('data-main.json', dir), mainJson);
console.log(`data.json (everything): ${kb(JSON.stringify(D))}`);
console.log(`data-main.json:         ${kb(mainJson)}`);
for (const [y, v] of Object.entries(years)) {
  const s = JSON.stringify(v);
  writeFileSync(new URL(`years/${y}.json`, dir), s);
  console.log(`years/${y}.json:        ${kb(s)}`);
}
