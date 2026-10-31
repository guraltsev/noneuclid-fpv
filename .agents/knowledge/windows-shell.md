# Shell on the maintainer's Windows machine

- On 2026-10-30 the Bash (Git Bash) tool returned no output at all, even for `ls` or `git status`, with no error.
  PowerShell worked. Symptom: an empty result that looks like success. Use PowerShell for anything whose output matters.
- Git prints "LF will be replaced by CRLF" warnings on add and commit; they are harmless here.
- In Windows PowerShell 5.1, `@(@('old','new'))` flattens to one array of two strings, so a `foreach ($p in ...)` over
  it yields strings and `$p[0]`/`$p[1]` are their first two characters. A bulk `Replace($p[0], $p[1])` then swaps one
  character for another across the whole file (on 2026-10-31 every `(` in a document became `s`). Write a list of pairs
  with a leading comma per pair, `@( ,@('a','b') ,@('c','d') )`, and check `git diff --stat` before going on.
