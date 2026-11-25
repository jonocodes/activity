import json, sys
g = json.load(open(sys.argv[1]))['data']['viewer']
c = json.load(open(sys.argv[2]))
me = g['login']
pub = lambda r: r and not r.get('isPrivate')
ev = []
for p in g['pullRequests']['nodes']:
    if pub(p['repository']):
        ev.append(dict(type='pr', at=p['createdAt'], repo=p['repository']['nameWithOwner'], title=p['title'], url=p['url'], state=p['state']))
for i in g['issues']['nodes']:
    if pub(i['repository']):
        ev.append(dict(type='issue', at=i['createdAt'], repo=i['repository']['nameWithOwner'], title=i['title'], url=i['url'], state=i['state']))
for d in g['repositoryDiscussions']['nodes']:
    if pub(d['repository']):
        ev.append(dict(type='discussion', at=d['createdAt'], repo=d['repository']['nameWithOwner'], title=d['title'], url=d['url']))
for d in g['repositoryDiscussionComments']['nodes']:
    r = d['discussion']['repository']
    if pub(r):
        ev.append(dict(type='discussion_comment', at=d['createdAt'], repo=r['nameWithOwner'], title=d['discussion']['title'], url=d['url']))
for d in g['issueComments']['nodes']:
    r = d['issue']['repository']
    if pub(r):
        ev.append(dict(type='comment', at=d['createdAt'], repo=r['nameWithOwner'], title=d['issue']['title'], url=d['url']))
for it in c['items']:
    if not it['repository']['private']:
        ev.append(dict(type='commit', at=it['commit']['author']['date'], repo=it['repository']['full_name'], title=it['commit']['message'].split('\n')[0], url=it['html_url'], sha=it['sha'][:7]))
for r in g['contributionsCollection']['repositoryContributions']['nodes']:
    rp = r['repository']
    if pub(rp):
        ev.append(dict(type='fork' if rp['isFork'] else 'repo', at=r['occurredAt'], repo=rp['nameWithOwner'], title=('forked from ' + rp['parent']['nameWithOwner']) if rp['isFork'] and rp['parent'] else 'created repository', url='https://github.com/' + rp['nameWithOwner']))
ev.sort(key=lambda e: e['at'], reverse=True)
repos = [r for r in g['repositories']['nodes'] if not r['isPrivate']]
cc = g['contributionsCollection']
byrepo = [dict(repo=x['repository']['nameWithOwner'], owner=x['repository']['owner']['login'], isFork=x['repository']['isFork'], lang=x['repository']['primaryLanguage'], commits=sum(n['commitCount'] for n in x['contributions']['nodes']), days=[[n['occurredAt'][:10], n['commitCount']] for n in x['contributions']['nodes']]) for x in cc['commitContributionsByRepository'] if not x['repository']['isPrivate']]
out = dict(login=me, name=g['name'], avatar=g['avatarUrl'],
  totals=dict(prs=g['pullRequests']['totalCount'], issues=g['issues']['totalCount'], discussions=g['repositoryDiscussions']['totalCount'], discussionComments=g['repositoryDiscussionComments']['totalCount'], issueComments=g['issueComments']['totalCount'], repos=len([r for r in repos if not r['isFork']]), forks=len([r for r in repos if r['isFork']]), year=dict(commits=cc['totalCommitContributions'], issues=cc['totalIssueContributions'], prs=cc['totalPullRequestContributions'], reviews=cc['totalPullRequestReviewContributions'], private=cc['restrictedContributionsCount'], calendar=cc['contributionCalendar']['totalContributions'])),
  calendar=[[d['date'], d['contributionCount']] for w in cc['contributionCalendar']['weeks'] for d in w['contributionDays']],
  repos=repos, commitsByRepo=byrepo, events=ev)
json.dump(out, sys.stdout, indent=1)
