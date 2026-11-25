# Throwaway: pull full public history for a few connections, write SQLite, report sizes.
import json, subprocess, sqlite3, os, gzip, sys
out = sys.argv[1]
CONN = {
 'issues': 'title url state createdAt repository { nameWithOwner isPrivate }',
 'pullRequests': 'title url state createdAt mergedAt additions deletions repository { nameWithOwner isPrivate }',
 'issueComments': 'url createdAt issue { title } repository { nameWithOwner isPrivate }',
 'repositoryDiscussions': 'title url createdAt repository { nameWithOwner isPrivate }',
 'repositoryDiscussionComments': 'url createdAt discussion { title repository { nameWithOwner isPrivate } }',
}
rows = []
for c, f in CONN.items():
    q = 'query($endCursor:String){ viewer { %s(first:100, after:$endCursor) { pageInfo { hasNextPage endCursor } nodes { %s } } } }' % (c, f)
    r = subprocess.run(['gh','api','graphql','--paginate','-f','query='+q,'--jq','.data.viewer.%s.nodes[]' % c], capture_output=True, text=True, check=True)
    for line in r.stdout.splitlines():
        n = json.loads(line)
        repo = n.get('repository') or n['discussion']['repository']
        if repo['isPrivate']: continue
        rows.append((c, n['createdAt'], repo['nameWithOwner'], n.get('title') or (n.get('issue') or n.get('discussion') or {}).get('title'), n['url'], n.get('state'), n.get('additions'), n.get('deletions')))
    print(c, sum(1 for x in rows if x[0]==c), file=sys.stderr)
if os.path.exists(out): os.remove(out)
db = sqlite3.connect(out)
db.execute('create table items(kind text, created_at text, repo text, title text, url text, state text, additions int, deletions int)')
db.executemany('insert into items values (?,?,?,?,?,?,?,?)', rows)
db.execute('create index items_repo on items(repo)'); db.execute('create index items_at on items(created_at)')
db.commit(); db.execute('vacuum'); db.close()
raw = open(out,'rb').read()
js = json.dumps([dict(zip(['kind','at','repo','title','url','state','add','del'], r)) for r in rows]).encode()
print(json.dumps({'rows': len(rows), 'sqlite_bytes': len(raw), 'sqlite_gz': len(gzip.compress(raw)), 'json_bytes': len(js), 'json_gz': len(gzip.compress(js))}))
