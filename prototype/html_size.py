# Throwaway: estimate pre-rendered HTML size from the probe DB + fixture commit sample.
import sqlite3, json, gzip, sys, html
db = sqlite3.connect(sys.argv[1]); fx = json.load(open(sys.argv[2]))
def row(kind, repo, title, url, at):
    return f'<div class="row" data-t="{kind}" data-r="{html.escape(repo)}"><span class="tag t-{kind}">{kind}</span><span class="t"><span class="repo">{html.escape(repo)}</span> · <a href="{url}">{html.escape(title or "")}</a></span><time datetime="{at}">{at[:10]}</time></div>\n'
items = db.execute('select kind, repo, title, url, created_at from items order by created_at desc').fetchall()
commits = [e for e in fx['events'] if e['type'] == 'commit']
# collapse same repo+day, as the feed does
seen, crow = set(), []
for c in commits:
    k = (c['repo'], c['at'][:10])
    if k not in seen: seen.add(k); crow.append(row('commit', c['repo'], f'n commits', c['url'], c['at']))
ratio = len(crow) / len(commits)
per_commit_row = sum(map(len, crow)) / len(crow)
est_commits = 2000  # public commits, estimated from search totals
def report(name, s):
    b = s.encode(); print(f'{name:38} raw={len(b)/1024:7.0f} KB  gz={len(gzip.compress(b))/1024:6.0f} KB')
all_items = ''.join(row(*r) for r in items)
year = ''.join(row(*r) for r in items if r[4] >= '2025-11-24')
commit_rows_all = ''.join(crow) * int(est_commits * ratio / len(crow))
report(f'all {len(items)} items as feed rows', all_items)
report(f'+ ~{int(est_commits*ratio)} collapsed commit rows (all time)', all_items + commit_rows_all)
report(f'last 12 months items ({year.count(chr(10))} rows)', year)
print(f'commit collapse ratio {ratio:.2f}, sample {len(commits)} commits')
