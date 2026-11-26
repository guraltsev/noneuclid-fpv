---
order: 5
description: Run agenttools setup before any work in this repository.
---

## Before you start

Before any work in this repository, run `agenttools setup` in it (in every clone and worktree, on every machine and
account). It makes this checkout ready: it attaches the notes worktree to the knowledge branch, writes the local git
excludes and links, and checks the agent tools; it never changes a committed file. In Claude Code the SessionStart hook
runs it for you and reports what it did; run it yourself when that report is missing or names a problem. If it reports
a problem, tell the user, quoting it: in particular, if `agenttools` or `know` is not installed, give the user the
install command it prints and do not work around it.
