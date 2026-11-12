# Branch sync

Lets a second machine follow the branch of the first when [Syncthing](https://syncthing.net/) carries the working tree
but not `.git`.

## The problem

Syncthing copies the files of a repository to every machine, but `.git` is (rightly) kept local on each one. After the
first machine runs `git checkout feature` and commits, the second machine has the new files but its own `.git` still
believes it is on `main` with the old index, so `git status` shows every changed file as a modification.

## Installing

```sh
python gittools/current-branch/install.py <your-repository>   # or, from an installed copy: python .gittools/current-branch/install.py
```

Copies the folder to `.gittools/current-branch` and installs the hook. Flags: `--hook`/`--no-hook`, `--force`, `--yes`
(no questions). `current_branch.py install` and `uninstall` below manage just the hook.

**Running it again is safe.** A hook of ours that is out of date, or that the tool wrote under its old name
(`branch-sync`), is replaced. A hook that is someone else's is kept, and the lines to add to it by hand are printed. An
existing `.git-current-branch` is kept (it may have come from the other machine), and a missing entry in
`.git/info/exclude` is put back. If `.gittools/branch-sync/` from the old name is still there, the installer points it
out and tells you how to remove it; it never deletes it. To remove the tool again: `current_branch.py uninstall`, then
delete `.git-current-branch`.

## What the tool does

1. **Record.** A `post-checkout` hook writes the name of the current branch to `.git-current-branch` in the repository root.
   The installer adds that file to `.git/info/exclude`, so git ignores it, but, being an ordinary file, it is synced by
   Syncthing.
2. **Follow.** On the other machine, `reset` reads that file, fetches the branch from the remote and *mixed-resets*
   the local `.git` to the remote tip: `HEAD` and the index move, **the working tree is never touched**. Because the
   synced files already equal that commit, `git status` is clean again.

Requirements: Python 3.11+ (standard library only) and `git`. The first machine must push the branch to the remote
before the second one runs `reset`.

## Commands

All commands are run as `python .gittools/current-branch/current_branch.py [--repo PATH] <command>`. `--repo` is a path
anywhere inside the repository (default: the current directory) and goes **before** the command.

| Command | Effect |
| --- | --- |
| `install` | Write the `post-checkout` hook (executable), exclude the branch file from git, and create the branch file from the current checkout **only if it does not exist** (an existing file came from the other machine and is what `reset` should follow). Refuses if a different hook is already there. Safe to repeat. |
| `uninstall` | Delete the hook if this tool wrote it; prints a note if there is none; refuses if it is someone else's. The branch file is left in place. |
| `status` | Print `recorded:` (contents of the branch file, or `(none)`) and `local:` (checked-out branch, or `HEAD` when detached). Never fails because of a missing file. |
| `reset [--remote NAME] [--dry-run]` | Follow the recorded branch (below). `--remote` defaults to `origin`. `--dry-run` prints the plan and changes nothing, not even by fetching. |

Exit codes: `0` success; `1` an error reported as `current-branch: <message>` on stderr; `2` a command-line usage error
(argparse).

### What `reset` does, in order

1. Reads and validates the branch name (see failure modes).
2. `git fetch <remote> +refs/heads/<name>:refs/remotes/<remote>/<name>` (forced update of the remote-tracking ref).
3. If a local branch `<name>` exists at a different commit than the remote tip, saves the old tip at
   `refs/current-branch/backup/<name>` (overwriting any earlier backup of that branch) and prints it.
4. Points `HEAD` at `refs/heads/<name>` (`git symbolic-ref`) and runs `git reset --mixed <tip>`. This creates or moves
   the local branch and rewrites the index; no file in the working tree is read for writing.
5. Sets `branch.<name>.remote` and `branch.<name>.merge`, so that plain `git pull`/`git push` work.

Recover an old tip with `git branch rescue refs/current-branch/backup/<name>`.

## Walk-through with two machines

```sh
# Machine A (has the branch) ------------------------------------------------
python .gittools/current-branch/install.py                  # once per clone
git checkout -b feature                                   # hook writes "feature" to the branch file
git commit -am "work" && git push -u origin feature

# Syncthing moves the files and the branch file to machine B.

# Machine B -----------------------------------------------------------------
python .gittools/current-branch/install.py                  # once per clone (keeps the synced branch file)
python .gittools/current-branch/current_branch.py status       # recorded: feature / local: main
python .gittools/current-branch/current_branch.py reset --dry-run
python .gittools/current-branch/current_branch.py reset
git status                                                # clean, on feature
```

Run `reset` after each time machine A switches branch or pushes new commits and Syncthing has finished syncing.
Machine B may also run `install`, so that its own checkouts are recorded, but then the two machines overwrite each
other's branch file: use the tool in one direction at a time.

## Files the tool owns

- **Hook** `post-checkout`, located with `git rev-parse --git-path hooks/post-checkout`, so a custom `core.hooksPath`
  is honoured. It is a POSIX `sh` script whose second line is the marker `# current-branch post-checkout hook`. It finds
  the repository root with `git rev-parse --show-toplevel`, and writes the output of `git symbolic-ref --quiet --short HEAD` (or the word `HEAD` when detached) plus a
  newline to the branch file. It runs on every checkout, including file checkouts.
- **Foreign hooks.** A hook counts as ours only if it contains the marker. `install` and `uninstall` refuse to touch any
  other `post-checkout` hook (exit `1`, hook unchanged). To combine, call this logic from your own hook by hand.
- **Branch file** `.git-current-branch` in the repository root: one line, a branch name or `HEAD`. `install` adds
  `/.git-current-branch` to `.git/info/exclude` (once), so git never lists or tracks it. `.gittools/current-branch/`
  holds only the tool's source.
- **Backup refs** `refs/current-branch/backup/<branch>`: created only by `reset`, only when it would orphan commits.

## Safety

- The working tree is never modified by `reset`; only `.git` changes (`HEAD`, the index, the local branch, the
  remote-tracking ref, config keys, the backup ref).
- Unpublished local commits are kept reachable through the backup ref.
- Foreign hooks are never overwritten or removed; the branch file is never overwritten by `install`.
- The branch name is validated with `git check-ref-format --branch` before use.
- `--dry-run` performs no network access and no writes.

## Failure modes

| Message (stderr, exit `1`) | Cause and fix |
| --- | --- |
| `not inside a git repository.` | Wrong `--repo`/directory. |
| `a different post-checkout hook exists, not overwriting: …` | Another hook is present; merge by hand or remove it. |
| `post-checkout hook is not ours, not removing: …` | Same, for `uninstall`. |
| `…/.git-current-branch is missing; run a checkout or install on the machine that has the branch.` | Syncthing has not delivered the file, or the hook has not run on machine A (`install`, then check out the branch again). |
| `the branch file records a detached HEAD; check out a branch first.` | Machine A is on a detached HEAD (or the file is empty); check out a branch there. |
| `the branch file holds an invalid branch name: …` | The file is corrupt or half-synced; wait for Syncthing or fix it. |
| `git fetch … failed: …` | The remote is unreachable or the branch was not pushed from machine A; push it, or pass `--remote`. |

If the file seems stale, remember that it changes only on a checkout, not on a commit.

## Windows notes

Git for Windows runs hooks with its bundled `sh`, so the hook works unchanged; the `chmod` is harmless there. The hook
and the branch file are written with LF line endings. Run the tool with `python` (or `py`) from PowerShell or Git Bash.
The sandbox may not have `sh` on `PATH` for other tools, which does not matter because git itself launches the hook.

## Quality checks

From the repository root (configuration in [pyproject.toml](../../pyproject.toml)):

```sh
python -m pytest _tests/current-branch
ruff check gittools/current-branch _tests/current-branch
ruff format --check gittools/current-branch _tests/current-branch
python -m mypy --strict gittools/current-branch
```

The tests build throwaway repositories (a bare remote and two clones) and cover: the hook recording a checkout, refusal
to overwrite a foreign hook, `reset` moving `HEAD` and the index but not the working tree, the backup of an unpublished
tip, and failure when the branch file is missing. The `status` and `uninstall` commands, `--dry-run` and a detached
`HEAD` have no tests yet.
