# sitdown: `git sitdown`

Keeps each machine's `.git` aligned with a working tree that [Syncthing](https://syncthing.net/) carries between two
machines. For the owner of a repository who works at two desks: `git sitdown` when arriving at a machine, `git sitdown
done` when leaving it.

## Quick start

Once per machine (after the repository exists there; the Syncthing folder must ignore `.git`, see
[Syncthing setup](#syncthing-setup)):

```sh
python .gittools/sitdown/install.py
git config sitdown.machine home          # a different name on each machine
```

Every day:

```sh
git sitdown            # arriving at a machine: follow what the other machine did
# ... work, commit as usual ...
git sitdown done       # leaving: push every branch and record where you stopped
```

Wait for Syncthing to finish before you sit down at the other machine. `git sitdown status` shows what arriving would
do, and changes nothing. If a line says `ERROR`, look it up under [Troubleshooting](#troubleshooting-failure-modes).
The sections below go from the everyday commands to the details: [Daily use](#daily-use),
[Installing](#installing), [Syncthing setup](#syncthing-setup), [How it works](#how-it-works), then the reference.

## A typical day with two machines and a worktree

```sh
# work -------------------------------------------------------------------------------------------------------------
git worktree add .worktrees/job -b job          # an agent's worktree
git -C .worktrees/job commit -am "step 1"       # the post-commit hook writes .worktrees/job/.git-current
git commit -am "main work"                      # ... and .git-current of the root checkout
git sitdown done                                # pushes main and job, writes both records
# Syncthing carries the files, both records and the folder .worktrees/job (without its .git link).

# home -------------------------------------------------------------------------------------------------------------
git sitdown status                              # what would happen
git sitdown                                     # attaches .worktrees/job, follows both records
git status                                      # clean in both checkouts; edits made at work are still there
# ... work at home: commit on main and in .worktrees/job ...
git sitdown done                                # pushes both branches, writes the records

# work, after Syncthing has finished ---------------------------------------------------------------------------------
git sitdown                                     # both checkouts follow home
```

If either machine commits before it has run `git sitdown`, the hook refuses to overwrite the other machine's record and
git shows a warning (see [Safety](#safety)); run `git sitdown`, then go on.

## Daily use

**Leaving** a machine, in the repository:

```text
$ git sitdown done
pushed   .  feature at 48fcce434d9a to origin
note     .  1 file not committed; Syncthing carries them
pushed   .worktrees/job  job at b0a8e0949ed9 to origin
done: 2 checkouts: 2 pushed, 0 already on origin, 0 errors
```

Wait until Syncthing has finished, then sit down at the other machine.

**Looking** at what arrival would do (reads only: no fetch, no prune, no write):

```text
$ git sitdown status
would    .  fetch it from origin, follow feature at 48fcce434d9a
  record   work  feature  48fcce434d9a  post-commit  2026-11-12T14:48:28Z   (seen: no)
  local    main  6ea78fb559e4   hooks: yes
would    .worktrees/job  fetch it from origin, follow job at b0a8e0949ed9
  record   work  job  b0a8e0949ed9  post-commit  2026-11-12T14:48:29Z   (seen: no)
```

**Arriving**:

```text
$ git sitdown
switched .  main -> feature at 48fcce434d9a
note     .  1 file differs from 48fcce434d9a: uncommitted edits from work, or Syncthing is not finished
attached .worktrees/job  worktree attached to this repository at b0a8e0949ed9
reset    .worktrees/job  job at b0a8e0949ed9
sitdown: 2 checkouts: 0 in sync, 2 followed, 0 errors
```

Run again, it finds nothing to do:

```text
$ git sitdown
ok       .  feature at 48fcce434d9a, as recorded by work
ok       .worktrees/job  job at b0a8e0949ed9, as recorded by work
sitdown: 2 checkouts: 2 in sync, 0 followed, 0 errors
```

When work committed but did not push, nothing in that checkout changes and the line says what to do:

```text
ERROR    .  feature at 2fef06df76e1 from work is not on origin; run "git sitdown done" on work
```

Each line about a checkout is `word  label  message`: the word is `ok`, `attached`, `switched`, `reset`, `backup`, `removed`,
`pushed`, `note`, `would` or `ERROR`, and the label is the folder relative to the root checkout (`.` for the root). The
exit status is `1` if any line is `ERROR`, else `0`. Errors that stop the whole run (not in a repository, no such remote,
an invalid `.sitdown.toml`) are printed as `sitdown: <message>` on stderr before anything changes.

## Installing

On **each** machine, once, after the repository exists there:

```sh
python .gittools/sitdown/install.py            # or: python gittools/sitdown/install.py <repository>
git config sitdown.machine home                 # a different name on each machine
```

```text
target  ~/work
copied  .gittools/sitdown/sitdown.py
copied  .gittools/sitdown/install.py
copied  .gittools/sitdown/README.md
copied  .gittools/README.md
copied   installed copy ~/work/.git/sitdown/sitdown.py
added    hook post-checkout: ~/work/.git/hooks/post-checkout
added    hook post-commit: ~/work/.git/hooks/post-commit
added    hook post-merge: ~/work/.git/hooks/post-merge
added    hook post-rewrite: ~/work/.git/hooks/post-rewrite
added    .git-current* and .sync-conflict-*.git-current and /.sitdown.toml to ~/work/.git/info/exclude
added    .sitdown.toml
set      git config sitdown.python = C:/Python/python.exe
set      git config sitdown.tool = ~/work/.git/sitdown/sitdown.py
set      machine name 'work'; each machine needs its own name (sitdown.machine)
added    git alias: git sitdown

Installed.
Next: git sitdown done   (writes the first records and pushes; then install on the other machine)
```

`install.py` copies the folder into `.gittools/sitdown` (without caches) and runs `sitdown.py install`. The first line
names the target. Without a repository path, `.gittools/sitdown/install.py` installs into the repository that holds
it, and `gittools/sitdown/install.py` (the source) into the repository of the current folder. Flags:
`--force` (replace a git alias that is not ours, and differing files), `--no-alias` (no `git sitdown` alias), `--yes`
(accepted; nothing is asked).

**The machine name** (`sitdown.machine`, local git config) defaults to the host name. The two machines must have
different names: the guard that protects a record from the other machine compares names.

**Installing is safe to repeat, and safe on the second machine.** Everything `install` writes into the working tree
(`.gittools/`, `.sitdown.toml`, hooks in a tracked hooks folder) is fixed text, the same bytes on every machine, and a file
that is already identical is not rewritten, so Syncthing sees nothing to carry. The per-machine parts (hooks in
`.git/hooks`, the installed copy, the exclude lines, the config keys, the alias) are always installed on the machine
where `install` runs. `install` never writes or touches a record; on the second machine it ends with
`Next: git sitdown   (records from work are waiting: 2 checkouts)`.

**`core.hooksPath`.** Hooks are installed where git runs them on this machine, which honours `core.hooksPath`. If that
folder is inside the working tree (for example `.githooks`), `install` says so: Syncthing carries the hooks, and git does
if the folder is tracked; they name no machine path, so that is fine. If the other machine uses such a folder and this
one does not, `install` notes the synced hooks that this machine does not use, and installs its own in `.git/hooks`. A
relative `core.hooksPath` is resolved per worktree: a worktree whose branch lacks the folder (an orphan branch, for
example) runs no hook. `done` writes every checkout's record anyway, and `git sitdown status` shows per checkout whether
our `post-commit` hook is present (`hooks: yes`).

## Syncthing setup

The design rests on two rules of the Syncthing folder's `.stignore`. `install` checks them, reads the file the way
Syncthing does (including `#include` files, `!` lines and "the first matching line wins"), and never edits it.

1. **`.git` is ignored at every depth.** The line must be `.git`, not `/.git`. A worktree has a `.git` *file* that links
   it to the git directory of one machine; if it travelled, it would break the worktree on the other machine. `(?d).git`
   also works, and lets Syncthing delete the folder of a removed worktree by itself; without `(?d)`, `git sitdown`
   removes it (a folder that holds only the `.git` link).
2. **`.git-current` is not ignored.** A line such as `.git*` hides it; put `!.git-current` before such a line.

```text
.git
```

The Syncthing folder is the nearest folder, from the repository upwards, that holds a `.stfolder` entry. With no
`.stfolder`, or with no `.stignore` beside it, `install` prints the lines the file will need. A note never changes the
exit status. `git sitdown status` repeats the check.

Recommended lines for the repository's `.gitignore`, so that the root checkout does not list worktrees as changes:

```text
.worktrees/
store/
```

(`store/` stands for the folder of an orphan-branch store, if you have one.)

## How it works

- **Syncthing carries the files.** The working tree of every checkout (the repository folder and each worktree) moves
  between the machines continuously, uncommitted edits included. Syncthing ignores `.git` at every depth, so each
  machine keeps its own `.git`.
- **The remote carries the history.** Commits travel through `origin`, by `git push` and `git fetch`.
- **A record per checkout joins the two.** A hook keeps a small file `.git-current` at the top of every checkout. It names
  the branch and the commit that the files belong to. Syncthing carries it, git ignores it.
- **`git sitdown` follows the records.** `HEAD` and the index of each checkout move to the recorded commit. No file of
  the working tree is written, so uncommitted edits stay. Worktrees that came by Syncthing as plain folders are
  attached, worktrees that the other machine removed are removed here too.
- **`git sitdown done` leaves cleanly.** It pushes every checkout's branch and writes the records, so that the other
  machine can follow.

Requirements: Python 3.11 or newer (standard library only) and git 2.31 or newer. Linux and macOS are not tested; nothing
in the tool is specific to Windows.

## Commands

Run `git sitdown …` (the alias), or `python .git/sitdown/sitdown.py [--repo PATH] <command>`. `--repo` is a
path anywhere inside the repository (default: the current directory) and goes **before** the command.

| Command | Effect |
| --- | --- |
| `install [--force] [--no-alias]` | Installs, for this machine: the tool copy inside `.git`, the four hooks, the exclude lines, the config keys, the alias; creates `.sitdown.toml` if missing; checks `.stignore`. Writes no record. |
| `uninstall [--shared]` | Removes our hooks, our alias, the installed copy and the keys `sitdown.python` and `sitdown.tool`. Hooks in a folder inside the working tree are removed only with `--shared`, because deleting them deletes them on the other machine too. Leaves the records, the seen records, `sitdown.machine`, the exclude lines, `.sitdown.toml` and the backup refs. |
| `record --event NAME` | Writes the record of the current checkout, through the guard. The hooks call this; it prints nothing on success. |
| `sitdown [--remote R]` | Arrives: follows the records of every checkout. |
| `sitdown status [--remote R]` | Shows every checkout and what `sitdown` would do. Changes nothing. |
| `sitdown done [--remote R] [--dry-run]` | Leaves: pushes every checkout's branch and writes the records. `--dry-run` fetches, pushes and writes nothing. |

`--remote` defaults to `origin`. `--dry-run` with anything but `done` is a usage error (exit `2`). Every command works on
the whole set of checkouts, whichever checkout it is started from.

**Which checkouts.** The root checkout (the first entry of `git worktree list`); every registered worktree whose folder
exists; and every folder that matches a glob of `checkouts` in `.sitdown.toml` at the top of the root checkout:

```toml
# Folders that hold worktrees, relative to the root checkout. Registered worktrees are always included.
checkouts = [".worktrees/*"]
```

The file sits in the repository, not in `.gittools/sitdown`, which holds only the tool's sources. Syncthing carries it to
the other machine and `.git/info/exclude` keeps it out of git, so it applies to every branch.

Add the folder of an orphan-branch store to find it before it is attached: `[".worktrees/*", ".agents/knowledge.d"]`. A
match counts only if it is a folder inside the root checkout, is not the root itself, and is not named `.git`. A folder
with a `.git` *folder* is a separate repository and is skipped with a note. A bare repository with worktrees is refused.

### What `git sitdown` does, in order

1. Finds the root checkout, checks that the remote exists, reads `.sitdown.toml`, runs `git worktree prune`.
2. Fetches what the records need: one `git fetch <remote> +refs/heads/<b>:refs/remotes/<remote>/<b>` per recorded branch
   whose commit is missing here or whose remote-tracking ref does not exist. A failed fetch is remembered, not raised.
3. **Plans** every checkout; no write happens in this phase. For each: a registered worktree whose folder holds only
   `.git` is planned for removal; conflict copies, a tracked record, an unfinished rebase, merge, cherry-pick or revert,
   and `index.lock` are errors; a record equal to the seen record is `ok`; a missing commit is fetched or reported; the
   branch tip is checked against the recorded commit (backup if needed); upstream and remote-tip notes are planned.
4. **Applies** the plans, each checkout on its own (an error in one never stops the others). Removals first, then passes:
   a plan is ready when no other checkout holds its branch; passes repeat while one applies something; a plan left over is
   an error that names the holder. Per checkout, in this order: repair the link; attach; back up the old tip; move the
   branch (`git update-ref` with the old value, so git refuses if the branch moved meanwhile); `HEAD`; the index
   (`git reset --mixed`); upstream config; the seen record; then a note if files differ from the commit.
5. Prints `sitdown: <n> checkouts: <k> in sync, <m> followed, <e> errors`.

**Attaching** a folder that came by Syncthing: git refuses `worktree add` into a folder that is not empty, so the link is
made in a temporary folder inside `.git/sitdown/attach/`, its `.git` file is moved into the folder, and
`git worktree repair` points git's record of the worktree at the folder. The folder's files are never read for writing.

### What `git sitdown done` does, in order

For each checkout: the same state checks as arrival; the guard (a record from the other machine that this checkout has not
followed is an error, and nothing is pushed); a branch without commits is skipped with a note; a detached `HEAD` must
already be on the remote; a branch is pushed if it is not on the remote (with `--set-upstream`) or if the remote has only
older commits, is `ok` if it equals or is behind the remote, and is an error if it has diverged or if its upstream is not
`<remote>/<branch>`. Then the record (event `done`) and the seen record are written, and uncommitted files are counted in a
note. Nothing is ever force-pushed. The summary is
`done: <n> checkouts: <p> pushed, <k> already on <remote>, <e> errors`.

## The files and settings the tool owns

| What | Where | Notes |
| --- | --- | --- |
| Four hooks | `post-checkout`, `post-commit`, `post-merge`, `post-rewrite`, in the folder git runs hooks from | POSIX `sh`, three lines after the shebang; the second is the marker `# sitdown hook`, the third reads the Python and the tool from the local git config and calls `record`. Same text on every machine. |
| Installed copy | `<git dir>/sitdown/sitdown.py` | What the hooks and the alias run, so that a half-synced working tree never breaks a commit, and a branch without `.gittools/` still works. `git sitdown`, `status` and `done` note when `.gittools/sitdown/sitdown.py` differs from it: run `install`. |
| Record | `.git-current` at the top of every checkout | TOML: `format`, `machine`, `written`, `event`, `branch` (`""` when detached), `head` (`""` before the first commit). Written atomically through `.git-current.tmp`; only when the branch or the commit changes. Synced, never tracked. |
| Seen record | `git rev-parse --git-path sitdown-seen`, per checkout | The last record this machine wrote or followed. Never synced; disappears with a worktree's registration. |
| Settings | `.sitdown.toml` at the top of the root checkout | The `checkouts` globs. Created by `install` only if missing. Carried by Syncthing (both machines use the same settings), ignored by git through an exclude line. Never inside `.gittools/sitdown`: that folder holds only the tool's sources and is often a link to a copy that several repositories share. |
| Exclude lines | `.git/info/exclude` (shared by all worktrees) | `.git-current*` (the record, its temporary file), `.sync-conflict-*.git-current` (Syncthing's conflict copy) and `/.sitdown.toml` (the settings). `templates/.gitignore` has the same three lines. |
| Config keys | local git config | `sitdown.python`, `sitdown.tool` (absolute, forward slashes), `sitdown.machine`. |
| Alias | `alias.sitdown` in the local git config | `!"<python>" "<installed copy>" sitdown`. Absolute paths, because a `!` alias runs at the top of the current worktree, and an orphan worktree has no `.gittools/`. An alias that does not mention `sitdown.py` is kept unless `--force`. |
| Backup refs | `refs/sitdown/backup/<UTC time>/<branch>` | See below. |
| Attach folders | `<git dir>/sitdown/attach/` | Temporary; empty after an attach. |

**Recovering a backed-up tip.** When `git sitdown` moves a branch to a commit that does not contain the branch's old tip, it
first saves the tip under a backup ref and prints it:

```text
backup   .  old tip 3f2c9a0e5b7d of main kept at refs/sitdown/backup/20261112T144829Z/main
```

Backup refs are never overwritten and never deleted by the tool. To get the commits back:
`git branch rescue refs/sitdown/backup/20261112T144829Z/main`.

**Git's environment.** A `!` alias started inside a worktree exports `GIT_DIR`, and hooks export `GIT_INDEX_FILE`. The
tool removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_PREFIX` and `GIT_OBJECT_DIRECTORY`
from every git command it runs and names the checkout by its working directory.

## Safety

1. `git sitdown` writes no file of the working tree. Inside a checkout folder it writes only the `.git` link when it
   attaches. `done` and the hooks write only `.git-current` (through `.git-current.tmp`).
2. No commit becomes unreachable: a branch tip that is not an ancestor of the followed commit is saved under a backup ref
   before the branch moves.
3. Nothing is force-pushed.
4. Foreign hooks and foreign aliases are never changed.
5. `git sitdown status` and `git sitdown done --dry-run` make no network access and no write.
6. A problem in one checkout never stops the others. Every check for a checkout happens before its first write, and the
   writes are ordered so that running `git sitdown` again finishes an interrupted run.
7. A record that came from the other machine is never overwritten before this machine has followed it. A hook that finds
   such a record writes nothing and prints, on the stderr that git shows:
   `sitdown: not recording: .git-current is from work and this checkout has not followed it; run "git sitdown"`.

The tool deletes only two things: registrations of worktrees whose folder is gone (`git worktree prune`), and a worktree
whose folder holds only git's own `.git` link, after the other machine removed it. Neither removes a file of yours.

## Troubleshooting: failure modes

An `ERROR` line is printed for one checkout and the others go on; the exit status is `1`. The message texts are exact;
`<…>` stands for a value.

| Message | Cause and fix |
| --- | --- |
| `Syncthing conflict copies of the record: <names>; both machines wrote it while out of touch. Keep the right one as .git-current and delete the others` | Both machines wrote the record while out of touch. Compare the files, keep the right one as `.git-current`. |
| `.git-current is tracked by git; run "git rm --cached .git-current"` | The record was added to git. Untrack it. |
| `no .git-current here; run "git sitdown done" on the machine that has this folder` | The folder arrived without a record. Run `git sitdown done` on the other machine. |
| `cannot read .git-current: <why>` | The record is invalid or half-synced. Wait for Syncthing, or run `git sitdown done` on the other machine. |
| `.git-current has format <n>, this tool reads format 1: update the sitdown tool` | The other machine runs a newer tool. Run `install` with the newer copy. |
| `.git is a link file from the other machine (<gitdir> does not exist here); add the line .git (unanchored) to .stignore on both machines, delete this .git file, then run "git sitdown" again` | Syncthing carries `.git` in subfolders. The tool leaves the file alone: replacing it would break the worktree on the other machine. |
| `.git links to <gitdir>, which belongs to <other>; resolve this by hand` | The folder's link names another existing worktree of this repository. |
| `<operation> in progress; finish or abort it, then run "git sitdown" again` | A rebase, merge, cherry-pick or revert is unfinished in that checkout. |
| `git is busy: <path> exists; wait for it, or delete it if no git command is running` | `index.lock` exists. |
| `<branch> at <commit> is unknown here but the record names this machine (<name>); give each machine its own name: git config sitdown.machine NAME` | Two machines have the same name, so the guard cannot tell them apart. |
| `<branch> at <commit> from <machine> is not on <remote>; run "git sitdown done" on <machine>` | The other machine committed and did not push. Nothing in this checkout changes. |
| `cannot fetch <branch> from <remote>: <why>` | The remote could not be reached and the commit is not here. Check the network, then run again. |
| `branch <branch> is checked out in <other>; run "git -C <other> switch --detach", then git sitdown again` | Two checkouts swapped branches, or one still holds the branch the other must take. `switch --detach` keeps `HEAD`'s commit and writes no file. |
| `this folder is not a worktree of this repository yet; run "git sitdown" first` | `done` found a folder from `checkouts` that is not attached. |
| `.git-current is from <machine> and has not been followed here; run "git sitdown" first` | `done` would publish a branch that does not match the files. |
| `detached HEAD at <commit> is not on <remote>; create a branch, then run "git sitdown done" again` | A detached `HEAD` can only be left if its commit is on the remote. |
| `upstream of <branch> is <upstream>; "done" pushes only to <remote>/<branch>` | `branch.<b>.remote` or `.merge` names something else. |
| `diverged from <remote>/<branch>; pull or rebase, then run "git sitdown done" again` | The remote has commits this branch lacks, and the other way round. |
| `push failed: <why>` | Offline, rejected, or no permission. The record is still written; the other machine will say the commit is not on the remote. |
| `git <command> failed: <why>` | Git refused a step (for example, the branch moved between the plan and the write). Run `git sitdown` again. |

Errors that stop the whole run are printed on stderr as `sitdown: <message>`, with exit status `1`, before
anything changes:

- `not inside a git repository.`: wrong directory or `--repo`.
- `bare repositories with worktrees are not supported.`: use a repository with a working tree.
- `no remote named <remote>; pass --remote NAME.`: the remote does not exist.
- `<path> is not valid: <why>`: `.sitdown.toml` is not TOML, or `checkouts` is not a list of folder patterns.
- `.gittools/sitdown/config.toml is no longer read; run install, which copies it to .sitdown.toml`: an older
  version kept the settings inside the tool's folder. Run `python .gittools/sitdown/install.py`; it never deletes from
  the tool's folder, which may be a shared copy, so delete the old file yourself.

The warning of a hook, on the stderr that git shows, is
`not recording: .git-current is from <machine> and this checkout has not followed it; run "git sitdown"`.

Notes (`note` lines) do not change the exit status: `could not reach <remote>; followed from local objects`,
`<n> files differ from <commit>: uncommitted edits from <machine>, or Syncthing is not finished` (information, not an
error), `<remote>/<branch> is <n> commits ahead of the files; pull when ready`, `<remote>/<branch> has diverged from the
files`, `HEAD moved without a hook since the record was written; run "git sitdown done" before you leave`.

## Known gaps

- `git reset`, `git branch -f` and `git update-ref` run no hook, so a record can go stale until the next hook or `done`.
  `git sitdown status` shows when `HEAD` and the record disagree (and `git sitdown` prints a note).
- `git rebase --apply` (not the default) runs its last hook while `HEAD` is still detached, so the record says "detached"
  until the next hook or `done`. During the default rebase the record keeps the branch, and `post-rewrite` records the
  end.
- Staged but uncommitted changes on the arriving machine lose their staging: the mixed reset rewrites the index. The
  files stay.
- The tool cannot know whether Syncthing has finished. If `git sitdown` runs early, the next commit or `done` meets the
  guard when the newer record lands; run `git sitdown` again.
- Submodules are not handled. A repository folder moved on disk leaves stale paths in the config keys: run `install`.
- Two machines with the same name weaken the guard (see the failure table).

## Windows notes

Git for Windows runs hooks with its bundled `sh`, so the hooks work unchanged. Files are written with LF line endings and
config paths with forward slashes. Replacing the record can fail for a moment while Syncthing has it open; the tool
retries 5 times, 100 ms apart. Run the tool with `python` or `py` from PowerShell or Git Bash.

**Git LFS.** `git lfs install` writes its own `post-checkout`, `post-commit` and `post-merge` hooks. They are not ours, so
`install` keeps them, installs the other hooks, prints the line to add, and exits `1`. Add the line to each LFS hook
**right after its first line**, so that the LFS command stays the last command and decides the hook's exit status. The
line never exits and never fails (shown for `post-commit`):

```sh
#!/bin/sh
python=$(git config --get sitdown.python) && tool=$(git config --get sitdown.tool) && "$python" "$tool" record --event post-commit >/dev/null || true
command -v git-lfs >/dev/null 2>&1 || { echo >&2 "git-lfs not found"; exit 2; }
git lfs post-commit "$@"
```

## Quality checks

From the repository root (configuration in [pyproject.toml](../../pyproject.toml)):

```sh
python -m pytest _tests/sitdown
ruff format --check gittools/sitdown _tests/sitdown
ruff check gittools/sitdown _tests/sitdown
python -m mypy gittools/sitdown
```

The tests build throwaway repositories (a bare remote and two clones that stand for the two machines) and a helper that
copies a working tree the way Syncthing does. They cover the record and its guard, the hooks (with `core.hooksPath`, in a
worktree, during a rebase), installation and uninstallation (including the second machine and a foreign hook or alias),
the reading of Syncthing's ignore rules, arrival (worktrees, an orphan store, backups, removal, swapped branches,
conflict copies), `status`, and leaving, ending with a full journey from one machine to the other and back.
