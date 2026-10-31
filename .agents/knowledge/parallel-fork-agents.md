# Parallel `fork` subagents share one working directory

Launching several `Agent` calls with `subagent_type: "fork"` in one message runs them concurrently, but (unlike
`isolation: "worktree"`) they all read and write the *same* checkout and the *same* git state — there is no
per-fork sandbox. On 2026-10-31 (job 43) four forks were dispatched in parallel, each assigned a disjoint list of
files; three ran their assigned batch and left it uncommitted (as instructed), but the fourth — a long-running
fork that happened to still be working when the others finished — picked up the other three's now-present,
uncommitted edits as part of its own `git add`/`git commit`, so one commit ended up covering all four batches
instead of four separate ones. The work itself was correct (every file matched its assignment), but the commit
boundaries were not what the dispatching turn planned.

Consequences to plan for:
- Do not assume a fork's own commit will contain only *its* files; another concurrent fork's uncommitted edits in
  the same working tree can ride along.
- If separate commits per batch matter, either commit from the dispatching turn after each fork reports back
  (sequentially), or tell every fork explicitly not to run `git add`/`git commit` itself and do all committing
  centrally once every fork has returned.
- Two forks editing the *same* file concurrently is the real risk this sharing creates; keep per-fork file lists
  disjoint, and expect whichever fork writes last to win silently.
