# Shell on the maintainer's Windows machine

- On 2026-10-30 the Bash (Git Bash) tool returned no output at all, even for `ls` or `git status`, with no error.
  PowerShell worked. Symptom: an empty result that looks like success. Use PowerShell for anything whose output matters.
- Git prints "LF will be replaced by CRLF" warnings on add and commit; they are harmless here.
