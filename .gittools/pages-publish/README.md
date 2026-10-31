# Publishing branches to GitHub Pages

`.gittools/pages-publish/pages_publish.py` builds a branch and publishes the result to a folder of the `gh_pages` branch, which GitHub
Pages serves. Every listed branch gets its own address, so a branch can be previewed next to the stable version:

```text
gh_pages
  index.html           redirects to the default branch (or to versions/ while it is not published)
  versions/index.html  every published branch with links, commit and time
  published.json       which commit each folder was built from
  main/                build of main            https://<user>.github.io/<repo>/main/
  feature-x/           build of feature/x
```

The tool needs only Python 3.11+ and git (`gh` is optional). All settings are in `config.toml`.

## Setup

This folder is the whole tool. **Copy `.gittools/pages-publish/` into any git repository**, then run the installer from
inside that repository:

```sh
python .gittools/pages-publish/install.py
```

It asks, one question at a time, whether to add: a starter `config.toml` (build command guessed from the project), the
GitHub Actions workflow, the opt-in pre-push hook, and launcher scripts in `_scripts/` (`pages-publish.cmd`/`.sh`).
Flags answer the questions up front (`--workflow/--no-workflow`, `--hook/--no-hook`, `--init/--no-init`,
`--launchers/--no-launchers`); `--yes` accepts the defaults without asking; nothing is overwritten without `--force` and
nothing is committed. From outside a repository, `python install.py path/to/repo` copies this folder there first.
Skipping the installer is fine: the tool runs as soon as a `config.toml` exists next to it (`pages_publish.py init`
writes one).

Files used by the optional pieces: `workflow/pages-publish.yml` (copied to `.github/workflows/`; GitHub requires that
location), a marked block in `.githooks/pre-push`, and `_scripts/pages-publish.*`. Everything else stays in this folder.
## Enable hosting (after setup)

1. Edit `config.toml`: the build command, the folder it writes (`dist`), and `branches`.
2. `python .gittools/pages-publish/pages_publish.py publish --add` builds the checked-out branch, lists it in `branches`, and creates
   `gh_pages`. The working tree must be committed.
3. `python .gittools/pages-publish/pages_publish.py enable-pages` sets Settings → Pages to *Deploy from a branch → `gh_pages` → `/ (root)`*
   (needs `gh`; otherwise it prints those steps).
4. Open `https://<user>.github.io/<repo>/` after a minute or two.

## Commands

```text
publish [--branch B] [--add] [--force] [--no-push] [--prune]   build and publish the checked-out commit (default)
check   [--branch B]      print build=true|false: is a publish needed?
remove  [--branch B]      delete a branch's folder (and its exact entry in config.toml)
prune                     delete folders of branches that no longer exist on the remote
status                    list published folders
init [--force]            write a starter config.toml
enable-pages [--dry-run]  set the Pages source with gh
install-hook              add the opt-in publish step to .githooks/pre-push
```

A commit that `published.json` already records is skipped without building. Unlisted branches are skipped unless
`--force`; `--add` lists one first. Commit `config.toml` after `--add`/`remove` so the workflow knows too.

## Build commands

```toml
[build]
command = "npm ci && npm run build"   # shell string; or ["make", "html"] (arguments); or commands = [ ... ]
dist = "dist"                          # folder the build writes (a subfolder of the repository)
cwd = "."
env = { NODE_ENV = "production" }
```

`command = ""` publishes `dist` as it is (a static folder). Placeholders `{base}` (URL path of this folder, for example
`/repo/main/`), `{folder}`, `{branch}`, `{sha}` work in commands and are in the environment as `PAGES_BASE`,
`PAGES_FOLDER`, `PAGES_BRANCH`, `PAGES_SHA`. Because each branch is served from a sub-path, the build must use relative
asset paths or `{base}`; by default a built `index.html` with `src="/..."` is refused (`require_relative = false` turns
that off). The URL path comes from the remote URL (`site_base` overrides it).

## Optional automation

Independent of each other; use none, one or both.

- **On `git push`, from your machine:** `python .gittools/pages-publish/pages_publish.py install-hook`, then
  `git config publish.onPush true`. The tracked pre-push hook publishes the checked-out branch (if listed); a failed
  publish only warns. Turn off with `git config --unset publish.onPush`.
- **On GitHub:** `.github/workflows/pages-publish.yml` checks cheaply whether the pushed commit is already published and
  builds only if not. Edit its marked block to install what your build needs. It also prunes when a branch is deleted.
  Delete the file or set the repository variable `PUBLISH_DISABLED=true` to turn it off.

## Notes

- `history = "single"` (default) keeps `gh_pages` as one force-pushed commit so built files never pile up in history.
  `"keep"` adds a commit per publish. A rejected push (someone published meanwhile) is retried up to five times.
- A lock in the git directory serialises publishes from one clone. The build output is copied before it is published,
  so nothing that touches `dist` afterwards can change what is published.
- A GitHub Pages site is limited to 1 GiB; the tool warns above `warn_total_mib` (default 800). `prune` drops old branches.
- `versions` is reserved: a branch of that name cannot be published.
