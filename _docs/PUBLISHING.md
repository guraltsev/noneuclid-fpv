# Publishing branches to GitHub Pages

The site is served from the `gh_pages` branch, which holds one built folder per published branch:

```text
gh_pages
  index.html           redirects to ./main/ (or to ./versions/ while the default branch is not published)
  versions/index.html  every published branch with links, commit and time
  published.json       which commit each folder was built from
  .nojekyll
  main/                build of main            https://guraltsev.github.io/noneuclid-fpv/main/
  design-012-engine-api/   build of design/012-engine-api
```

The tool is the reusable Python tool in `.gittools/pages-publish/` (source of truth, installer and tests:
`Documents/templates/git/.gittools/pages-publish/`). Its full usage is in
[.gittools/pages-publish/README.md](../.gittools/pages-publish/README.md); this file records how this repository uses it.
Settings are in [config.toml](../.gittools/pages-publish/config.toml).

## Everyday use

The launcher `_scripts/pages-publish.cmd` (Windows; `_scripts/pages-publish.sh` elsewhere) runs the tool from any directory of the
repository; the tool itself is `.gittools/pages-publish/pages_publish.py`.

```sh
git commit ...                                      # the tracked working tree must be clean
_scripts/pages-publish.cmd publish             # or: npm run publish:branch
_scripts/pages-publish.cmd publish --add       # also list a new branch in .gittools/pages-publish/config.toml (then commit it)
_scripts/pages-publish.cmd remove --branch X   # delete a branch's folder (and its exact entry in the config)
_scripts/pages-publish.cmd prune               # delete folders of branches that no longer exist
_scripts/pages-publish.cmd status              # what is published
```

A commit that `published.json` already records is skipped without building, so a local publish and the workflow never
repeat each other's work. Branches not listed in `branches` are skipped unless `--force`.

## One-time setup

Settings → Pages → Source: **Deploy from a branch**, `gh_pages`, `/ (root)` — or `_scripts/pages-publish.cmd enable-pages`.

## Two optional automations

Independent; use none, one or both.

- **On `git push`, from your machine:** `git config publish.onPush true` (the tracked pre-push hook, installed with
  `_scripts/pages-publish.cmd install-hook`, then publishes after the checks pass; a failure only warns).
- **On GitHub:** [.github/workflows/pages-publish.yml](../.github/workflows/pages-publish.yml) checks whether the pushed
  commit is already published, installs Node and builds only if not, and prunes when a branch is deleted. Turn it off by
  deleting the file or setting the repository variable `PUBLISH_DISABLED=true`.

## Notes specific to this repository

- **No base path.** The app is built once with relative paths (`vite.config.ts` `base: "./"`; public files are resolved
  against the page in `src/glue/assetUrls.ts`), so a folder works wherever it is served. The tool refuses a build whose
  `index.html` has root-absolute `src`/`href` paths.
- **Build.** `node scripts/build-pages.mjs` runs `npm run build`, writes `.nojekyll` and enforces the 64 MiB dist budget.
- **Not served by Pages.** The local server, channel and `npm run cdp` ([DEPLOYMENT.md](DEPLOYMENT.md)) need
  `npm run server`; on Pages the app runs as the single-player static site.
- **History.** `gh_pages` is a single force-pushed commit, so built assets never accumulate in the repository's history.
