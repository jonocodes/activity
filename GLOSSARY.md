# Activity

One static page of everything a person has done on GitHub, rebuilt every hour. These are the words the docs, code and tests use for it.

## People and places

**Owner**:
The GitHub account the page is about. The owner of a repo is always written out as "repo owner".
_Avoid_: user, author, me

**Repo**:
A GitHub repository. "Projects" is only the label of a view on the page, not a separate concept.
_Avoid_: project

**Own repo**:
A repo whose repo owner is the owner.

**External repo**:
A repo owned by someone else that the owner has items in.
_Avoid_: upstream (reserved for a fork's parent), contributed repo

**Favorite**:
A repo the owner chose to highlight, in an order the owner chose. Unrelated to GitHub's pins.
_Avoid_: pin, pinned, featured

**Fork**:
An own repo created as a copy of another repo.

**Upstream**:
The repo a fork was copied from: its parent.

## What gets shown

**Item**:
One thing the owner did that can appear in the feed: a commit, pull request, issue, discussion, discussion reply, review, comment, new repo or fork.
_Avoid_: event, activity, entry, contribution

**Contribution**:
GitHub's own unit, counted per day on the contribution calendar. GitHub's counting rules differ from items (for example, work in forks doesn't count), so the two are never mixed.
_Avoid_: using it for items

**Group**:
Several items of one kind, in one repo, on one day of the owner's, shown as a single row.
_Avoid_: burst, batch, collapsed row

**Source**:
Where items come from: GitHub first; Hacker News or Codeberg later.

## Running it

**Run**:
One execution of the hourly workflow: collect, render, deploy.
