# Shell on the maintainer's Windows machine

- On 2026-10-30 the Bash (Git Bash) tool returned no output at all, even for `ls` or `git status`, with no error.
  PowerShell worked. Symptom: an empty result that looks like success. Use PowerShell for anything whose output matters.
- Git prints "LF will be replaced by CRLF" warnings on add and commit; they are harmless here.
- In Windows PowerShell 5.1, `@(@('old','new'))` flattens to one array of two strings, so a `foreach ($p in ...)` over
  it yields strings and `$p[0]`/`$p[1]` are their first two characters. A bulk `Replace($p[0], $p[1])` then swaps one
  character for another across the whole file (on 2026-10-31 every `(` in a document became `s`). Write a list of pairs
  with a leading comma per pair, `@( ,@('a','b') ,@('c','d') )`, and check `git diff --stat` before going on.
- `git add -A -- <path1> <path2> ...` with several pathspecs stages **nothing at all**, silently, if even one
  pathspec matches no file (e.g. a file already deleted or renamed away) — it is not "stage the ones that match,
  skip the rest." The command prints `fatal: pathspec '...' did not match any files` and exits nonzero, which
  looks like a normal tool error, but the real danger is trusting a *later, successful* `git add`/`git status`
  and assuming the earlier failed call had no effect — on 2026-10-31 this silently dropped several edited files
  (doc/baseline fixes) from a commit whose message claimed to include them, caught only by diffing the commit
  afterward. After any `git add` with multiple paths, re-run `git status --short` and read the first column
  (staged) vs. second (unstaged) for every path you expect, rather than assuming the add worked.
