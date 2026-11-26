// PROTOTYPE, throwaway. Fetches the owner's PUBLIC GitHub data into prototype/data.json for the page mockup.
// Uses your local `gh` login. That token may see private repos, so every private repo and item is dropped here,
// and the script fails if anything private survives. data.json is gitignored.
// Usage: node prototype/fetch-data.mjs [login]   (default: the gh user)
//        node prototype/fetch-data.mjs --external-only   (add external repo details to an existing data.json)
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const TOKEN = execSync('gh auth token').toString().trim();
const H = { Authorization: `bearer ${TOKEN}`, 'User-Agent': 'activity-prototype' };
const EXTERNAL_ONLY = process.argv.includes('--external-only');
const LOGIN = process.argv.filter(a => !a.startsWith('--'))[2] || (await (await fetch('https://api.github.com/user', { headers: H })).json()).login;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const privateRepos = new Set();
let dropped = 0;

async function gql(query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors || !r.ok) { if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; } throw new Error(JSON.stringify(j.errors || j)); }
    return j.data;
  }
}
async function rest(path) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.github.com${path}`, { headers: { ...H, Accept: 'application/vnd.github+json' } });
    if (r.status === 403 || r.status === 429) { await sleep(20000); continue; }
    if (!r.ok) { if (attempt < 3) { await sleep(2000); continue; } throw new Error(`${r.status} ${path}`); }
    return r.json();
  }
}
const keep = (repo) => { if (!repo || repo.isPrivate || repo.private) { if (repo) privateRepos.add(repo.nameWithOwner || repo.full_name); dropped++; return false; } return true; };


// ---------- details of external repos (description, stars, licence, language) ----------
async function externalDetails(names) {
  const out = {};
  for (let i = 0; i < names.length; i += 25) {
    const batch = names.slice(i, i + 25);
    const q = batch.map((n, j) => { const [o, r] = n.split('/'); return `r${j}: repository(owner:${JSON.stringify(o)}, name:${JSON.stringify(r)}) { nameWithOwner isPrivate description stargazerCount licenseInfo { spdxId } primaryLanguage { name } }`; }).join('\n');
    const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: H, body: JSON.stringify({ query: `{ ${q} }` }) });
    const j = await r.json();   // deleted or renamed repos come back null with an error: skip them
    for (const v of Object.values(j.data || {})) if (v && keep(v)) out[v.nameWithOwner] = v;
  }
  return out;
}
if (EXTERNAL_ONLY) {
  const path = new URL('./data.json', import.meta.url), d = JSON.parse(readFileSync(path));
  const names = [...new Set([...d.items, ...d.commits].map(x => x.repo).filter(n => !n.startsWith(d.profile.login + '/')))];
  d.externalRepos = await externalDetails(names);
  const json = JSON.stringify(d);
  if (json.includes('"isPrivate":true')) { console.error('ABORT: private data survived'); process.exit(1); }
  writeFileSync(path, json); console.log(`added details for ${Object.keys(d.externalRepos).length} of ${names.length} external repos`); process.exit(0);
}

// ---------- profile, pins, repos ----------
const REPO = 'nameWithOwner isPrivate isFork isArchived description createdAt pushedAt stargazerCount parent { nameWithOwner } licenseInfo { spdxId } primaryLanguage { name color }';
let profile, repos = [];
for (let after = null; ;) {
  const d = await gql(`query($login:String!,$after:String){ user(login:$login){ login createdAt bio location company
    pinnedItems(first:6, types:REPOSITORY){ nodes { ... on Repository { ${REPO} } } }
    contributionsCollection { contributionYears }
    repositories(first:100, after:$after, ownerAffiliations:OWNER, orderBy:{field:PUSHED_AT,direction:DESC}){ pageInfo{hasNextPage endCursor} nodes{ ${REPO} } } } }`, { login: LOGIN, after });
  profile ??= d.user;
  repos.push(...d.user.repositories.nodes);
  if (!d.user.repositories.pageInfo.hasNextPage) break;
  after = d.user.repositories.pageInfo.endCursor;
}
repos = repos.filter(keep);
const pins = profile.pinnedItems.nodes.filter(keep);
const orgs = (await rest(`/users/${LOGIN}/orgs`)).map(o => o.login);
console.log(`repos: ${repos.length}, pins: ${pins.length}, public orgs: ${orgs.length}`);

// ---------- full-history connections ----------
const R = 'repository { nameWithOwner isPrivate }';
const CONN = {
  pr:                 [`pullRequests`,                  `createdAt title url state ${R}`],
  issue:              [`issues`,                        `createdAt title url state ${R}`],
  discussion:         [`repositoryDiscussions`,         `createdAt title url ${R}`],
  discussion_reply:   [`repositoryDiscussionComments`,  `createdAt url discussion { title ${R} }`],
  issue_comment:      [`issueComments`,                 `createdAt url issue { title ${R} }`],
  commit_comment:     [`commitComments`,                `createdAt url commit { oid } ${R}`],
};
const items = [];
for (const [kind, [conn, fields]] of Object.entries(CONN)) {
  let n = 0;
  for (let after = null; ;) {
    const d = await gql(`query($login:String!,$after:String){ user(login:$login){ ${conn}(first:100, after:$after){ pageInfo{hasNextPage endCursor} nodes{ ${fields} } } } }`, { login: LOGIN, after });
    for (const x of d.user[conn].nodes) {
      const repo = x.repository || x.discussion?.repository || x.issue?.repository;
      if (!keep(repo)) continue;
      const title = x.title || x.discussion?.title || x.issue?.title || (x.commit ? `comment on ${x.commit.oid.slice(0, 7)}` : '');
      items.push({ kind, at: x.createdAt, repo: repo.nameWithOwner, title, url: x.url, state: x.state });
      n++;
    }
    if (!d.user[conn].pageInfo.hasNextPage) break;
    after = d.user[conn].pageInfo.endCursor;
  }
  console.log(`${kind}: ${n}`);
}

// ---------- per year: calendar, totals, reviews, repos created/forked ----------
const years = {};
for (const y of profile.contributionsCollection.contributionYears) {
  const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){ contributionsCollection(from:$from,to:$to){
      totalCommitContributions totalIssueContributions totalPullRequestContributions totalPullRequestReviewContributions restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      pullRequestReviewContributions(first:100){ nodes { occurredAt pullRequest { title url ${R} } } }
      repositoryContributions(first:100){ nodes { occurredAt repository { nameWithOwner isPrivate isFork url } } } } } }`,
    { login: LOGIN, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` });
  const c = d.user.contributionsCollection;
  years[y] = {
    calendar: c.contributionCalendar.weeks.flatMap(w => w.contributionDays).map(x => [x.date, x.contributionCount]),
    total: c.contributionCalendar.totalContributions, private: c.restrictedContributionsCount,
  };
  for (const r of c.pullRequestReviewContributions.nodes) if (keep(r.pullRequest.repository))
    items.push({ kind: 'review', at: r.occurredAt, repo: r.pullRequest.repository.nameWithOwner, title: r.pullRequest.title, url: r.pullRequest.url });
  for (const r of c.repositoryContributions.nodes) if (keep(r.repository))
    items.push({ kind: r.repository.isFork ? 'fork' : 'new_repo', at: r.occurredAt, repo: r.repository.nameWithOwner, title: r.repository.nameWithOwner, url: r.repository.url });
}
// last 12 months calendar (rolling)
const last = (await gql(`query($login:String!){ user(login:$login){ contributionsCollection { restrictedContributionsCount contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`, { login: LOGIN })).user.contributionsCollection;
const lastYear = { calendar: last.contributionCalendar.weeks.flatMap(w => w.contributionDays).map(x => [x.date, x.contributionCount]), total: last.contributionCalendar.totalContributions, private: last.restrictedContributionsCount };
console.log(`years: ${Object.keys(years).length}, reviews: ${items.filter(i => i.kind === 'review').length}`);

// ---------- commits via search, sliced so no slice hits the 1000 cap ----------
const commits = [];
async function searchSlice(from, to) {
  const q = encodeURIComponent(`author:${LOGIN} author-date:${from}..${to}`);
  const first = await rest(`/search/commits?q=${q}&per_page=100&page=1`);
  await sleep(2100);
  if (first.total_count >= 1000 && from !== to) {
    const a = new Date(from), b = new Date(to), mid = new Date((a.getTime() + b.getTime()) / 2).toISOString().slice(0, 10);
    const next = new Date(new Date(mid).getTime() + 864e5).toISOString().slice(0, 10);
    await searchSlice(from, mid); await searchSlice(next, to); return;
  }
  const pages = Math.ceil(Math.min(first.total_count, 1000) / 100);
  const all = [...first.items];
  for (let p = 2; p <= pages; p++) { all.push(...(await rest(`/search/commits?q=${q}&per_page=100&page=${p}`)).items); await sleep(2100); }
  for (const c of all) if (keep(c.repository))
    commits.push({ sha: c.sha, at: c.commit.author.date, repo: c.repository.full_name, fork: c.repository.fork, msg: c.commit.message.split('\n')[0], url: c.html_url });
}
for (const y of profile.contributionsCollection.contributionYears.slice().reverse()) await searchSlice(`${y}-01-01`, `${y}-12-31`);
console.log(`commits (before dedup): ${commits.length}`);

const externalRepos = await externalDetails([...new Set([...items, ...commits].map(x => x.repo).filter(n => !n.startsWith(LOGIN + '/')))]);

// ---------- safety check, then write ----------
const out = { generatedAt: new Date().toISOString(), profile: { login: profile.login, createdAt: profile.createdAt, bio: profile.bio, location: profile.location, company: profile.company, orgs }, pins, repos, externalRepos, items, commits, years, lastYear };
const json = JSON.stringify(out);
const leaks = [...privateRepos].filter(n => n && json.includes(n));
if (leaks.length || json.includes('"isPrivate":true') || json.includes('"private":true')) { console.error(`ABORT: private data survived (${leaks.length} names)`); process.exit(1); }
writeFileSync(new URL('./data.json', import.meta.url), json);
console.log(`wrote prototype/data.json (${(json.length / 1024).toFixed(0)} KB); dropped ${dropped} private repos/items (${privateRepos.size} distinct repos, not named)`);
