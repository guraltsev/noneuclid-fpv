# Publishing branches to GitHub Pages

The site is served from a branch, `gh_pages`, that holds one built folder per published branch:

```text
gh_pages
  index.html          redirects to ./main/ (or to ./versions/ while the default branch is not published)
  versions/index.html list of every published branch with links, commit and time
  published.json      which commit each folder was built from
  .nojekyll
  main/               build of main            https://guraltsev.github.io/noneuclid-fpv/main/
  design-012-engine-api/   build of design/012-engine-api
```

`main` is the stable version; any other listed branch is previewed next to it at its own address. Nothing needs the
Actions tab or any clicking once Pages is set up.

## One-time setup

1. Settings → Pages → Source: **Deploy from a branch**, branch `gh_pages`, folder `/ (root)`. The branch appears after
   the first publish (below); choose it then.
2. Choose which branches are published in [publish.config.json](../publish.config.json) (`branches`, globs;
   `design/**` crosses slashes, `*` does not).

## Publishing by hand (always available)

```sh
git commit ...                 # the working tree must be clean: a folder always matches a commit
npm run publish:branch         # builds the checked-out branch and pushes it to gh_pages/<folder>/
```

(`npm publish` is a different, npm-registry command; that is why the script is called `publish:branch`.)

Options: `--add` (append the checked-out branch to `branches` in `publish.config.json`, then publish it; commit the
changed config so the workflow and other machines know the branch too; this is the way to start publishing a new branch),
`--remove` (delete a branch's folder from `gh_pages` and, if listed by exact name, its entry in `branches`; works from any
checked-out branch, so `--remove --branch old-experiment`; commit the changed config), `--force` (publish an unlisted branch, or rebuild a current one), `--prune` (also remove folders of branches
that no longer exist on the remote), `--prune-only`, `--no-push` (commit to the local `gh_pages` only), `--branch <name>`,
`--remote <name>`, `--config <file>`. `--check` only reports whether a build is needed.

The script reads `published.json` first. If the folder already records the commit, it stops: **no work is repeated**,
whoever published it.

## Two optional automations

Each is independent; use none, one or both.

- **On `git push`, from your machine.** `git config publish.onPush true`. The pre-push hook then publishes the
  checked-out branch (if listed) after the checks pass. A publish failure only warns. Turn off with
  `git config --unset publish.onPush`.
- **On GitHub.** [.github/workflows/publish.yml](../.github/workflows/publish.yml) runs on every push, first asks the
  script `--check` (cheap: it reads `gh_pages` only), and builds only if the branch is listed and its commit is not yet
  recorded. If you published locally before the push arrived, the workflow stops at that check. It also prunes folders
  when a branch is deleted. Turn it off by deleting the file, or by setting the repository variable `PUBLISH_DISABLED`
  to `true`.

## How it works, and what to know

- **Base path.** Each folder is built for `/<repo>/<folder>/` (`{base}` in the `build` command, also exported as
  `VITE_BASE`). For a user site (`<name>.github.io`) the repository part is dropped. Override with `siteBase`.
- **One commit.** With `"history": "single"` (the default) `gh_pages` is a single commit, force-pushed with
  `--force-with-lease`, so built assets never accumulate in the repository's history. With `"keep"` every publish is a
  commit on top. A rejected push (someone published meanwhile) is retried from the new tip, up to five times.
- **Size.** A Pages site is limited to 1 GiB; `published.json` records each folder's size and the script warns above
  `warnTotalMiB`. Use `--prune` to drop old branches. `scripts/build-pages.mjs` still enforces the per-build budget of
  this repository.
- **Not served by Pages.** The local server, channel and `npm run cdp` ([DEPLOYMENT.md](DEPLOYMENT.md)) need
  `npm run server`; on Pages the app runs as the single-player static site.
- **Old Actions deployment.** `deploy-pages.yml` is gone. If a "GitHub Actions" source is still selected under
  Pages, switch it to the branch (step 1).

## Using this for another website

Nothing in `scripts/publish/` is specific to this repository; it has no dependencies beyond Node and git. To adopt it:

1. Copy `scripts/publish/` (two files), `.github/workflows/publish.yml` (optional) and `publish.config.json`.
2. Set `build` to the site's build command (`["npm", "run", "build"]` is the default), `dist` to its output folder, and
   `branches`. The build must honour the base path given in `{base}` / `VITE_BASE` (for Vite, `base: process.env.VITE_BASE`).
3. Add a script such as `"publish:branch": "node scripts/publish/publish.mjs"`, and the Pages setting above.
4. In the workflow, add an install step suited to the project (the example uses `npm ci`).

The unit and end-to-end tests are in `tests/scripts/publish.test.ts` (they use temporary repositories).
