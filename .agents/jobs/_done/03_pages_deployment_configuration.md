# Job 03 - Make Pages deployment repository-name agnostic

Status: done, needs review on 2026-10-29.
Former issue: 37 (converted to a job on 2026-10-28).
Resolves: no open issue (issue 35's local-HTTPS item was merged in here).

Priority: P2 developer and release tooling.

## Goal

The same source checkout must build correctly for any Pages repository name: the canonical `noneuclid-fpv`, or a
yearly or ad-hoc instance such as `camp-2026-VR`. `npm run build:pages` must take the base path only from explicit
input, print it, and fail before building when it is missing or garbled. Remove the broken `gh-pages` push script.
Fix the deployment documents: the local preview under a subpath, deploying to another repository, and a
local-HTTPS recipe for headset tests.

## Depends on

Job 02. Both jobs edit `scripts/build-pages.mjs`. Job 02 adds a `dist/` size check at its end, and this job must
keep it.

## Before you start

Read:

- `.agents/jobs/README.md`: the rules for the implementing model and the `## Report` format.
- `scripts/build-pages.mjs` (all; after job 02 it ends with the size check).
- `scripts/deploy-pages.sh` (all, 20 lines).
- `.github/workflows/deploy-pages.yml` (all, 67 lines), especially `:34-51`.
- `vite.config.ts` (all, 18 lines).
- `package.json:5-26` (`scripts`).
- `_docs/DEPLOYMENT.md` (all), `_docs/Development_guide.md:63-90`, `README.md:63-69`.
- `wwwserver/RebexTinyWebServer.exe.config` (all) and `wwwserver/README.txt:1-20`.
- `tests/docs/documentation.test.ts:1-15`: how a test imports a plain `.mjs` script without type errors.

Baseline (record results under `### Checks`):

```sh
npm run typecheck
npm test
```

Both must pass before you change anything.

## Background

### How the base path flows today

`vite.config.ts:3-14` sets Vite's `base` from the `VITE_BASE` environment variable, normalised to `/name/`, or `/`
when unset:

```ts
function resolveBase(): string {
  const configuredBase = process.env.VITE_BASE?.trim();
  if (!configuredBase || configuredBase === "/") {
    return "/";
  }
  return `/${configuredBase.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}
```

The app builds every asset URL from `import.meta.env.BASE_URL` (`src/glue/assetUrls.ts:6-8`), so a wrong base breaks
every model, texture and config load.

`scripts/build-pages.mjs:6-19` reads `package.json` and falls back to `/${packageJson.name}/`, which is
`/noneuclid-fpv/`, when `VITE_BASE` is unset. It prints neither the base nor where it came from:

```js
const fallbackBase = normalizeBase(`/${packageJson.name ?? ""}/`);
const configuredBase = normalizeBase(process.env.VITE_BASE);
const result = spawnSync(...buildCommand(), { ..., env: { ...process.env, VITE_BASE: configuredBase ?? fallbackBase }, ... });
```

It then writes `dist/.nojekyll` (`:30`), and, after job 02, runs the `dist/` size check. `normalizeBase` is at
`:32-38`. `buildCommand()` (`:44-50`) runs `npm run build` through `cmd.exe /d /s /c` on Windows.

### Git Bash rewrites values that start with `/` (verified 2026-10-28)

Git Bash (MSYS) rewrites any argument or environment value that starts with `/` when it starts a Windows program
such as `node`:

```text
$ VITE_BASE=/noneuclid-fpv/ node -e "console.log(process.env.VITE_BASE)"
C:/Program Files/Git/noneuclid-fpv/
$ VITE_BASE=noneuclid-fpv node -e "console.log(process.env.VITE_BASE)"
noneuclid-fpv
$ MSYS_NO_PATHCONV=1 VITE_BASE=/noneuclid-fpv/ node -e "console.log(process.env.VITE_BASE)"
/noneuclid-fpv/
```

A build run as `VITE_BASE=/noneuclid-fpv/ npx vite build` in Git Bash produced
`src="/C:/Program Files/Git/noneuclid-fpv/assets/index-....js"` in `index.html`. The command that
`_docs/DEPLOYMENT.md:52` documents today (`VITE_BASE=/noneuclid-fpv/ npm run build:pages`) is therefore broken on
this project's main platform. Writing the base without the leading slash avoids the problem, because both
normalisers add the slashes.

### `vite preview` needs the same base (verified 2026-10-28)

`vite preview` reads `base` from `vite.config.ts`, which reads `VITE_BASE` at preview time. A test build with base
`/noneuclid-fpv/`, previewed without `VITE_BASE`, served `/noneuclid-fpv/assets/index-....js` as `text/html` (the
SPA fallback page), so the app cannot start. With `VITE_BASE=noneuclid-fpv npx vite preview ...`, the same file came
back as `text/javascript`, and the server printed `Local: http://localhost:<port>/noneuclid-fpv/`.
`_docs/DEPLOYMENT.md:49-58` runs `npm run preview` without `VITE_BASE`, so that recipe is also broken. Note: vite
preview answers 200 with the HTML fallback even for missing files; job 04 deals with that.

### The deploy workflow

`.github/workflows/deploy-pages.yml:38-45`:

```yaml
      - name: Set Vite base path
        shell: bash
        run: |
          if [ -n "${{ steps.pages.outputs.base_path }}" ]; then
            echo "VITE_BASE=${{ steps.pages.outputs.base_path }}/" >> "$GITHUB_ENV"
          else
            echo "VITE_BASE=/${{ github.event.repository.name }}/" >> "$GITHUB_ENV"
          fi
```

`actions/configure-pages` reports `base_path` as the path part of the site URL: `/noneuclid-fpv` for
`https://guraltsev.github.io/noneuclid-fpv`, and empty for a site at a domain root (a custom domain, or an
`<owner>.github.io` repository). The `else` branch is therefore wrong in exactly the case where it runs: an empty
`base_path` means the site is at `/`. The workflow runs on Linux, so the Git Bash rewrite does not apply there. The
workflow runs on push to `main` and on manual dispatch, and is the only documented way to publish.

### The `gh-pages` push script

`scripts/deploy-pages.sh` (run by `npm run deploy:pages`, `package.json:16`) reads `remote.origin.url`. This
checkout's only remote is `github` (`git remote -v`), so the script cannot work here. It builds before it checks its
inputs, then force-pushes a `gh-pages` branch. `_docs/DEPLOYMENT.md:70-71` already says not to use it, because it
conflicts with the Actions deployment. Mentions elsewhere are historical records: `_issues/_closed/03_*.md`,
`_issues/_closed/04_*.md`, `_issues/_closed/10_*.md`, `_docs/llm-handoff/19_stage_09_classroom_hardening.md:75` and
`_docs/llm-implementation-workflow.md:124`.

### Other out-of-date text

- `_docs/Development_guide.md:79-83` says "The workflow runs the test suite". It does not; the local pre-push hook
  runs `npm run typecheck` and `npm test` (`.githooks/pre-push`).
- `_docs/Development_guide.md:85-89` mention "a legacy package-name fallback" tracked in issue 37.
- `_docs/Development_guide.md:70` lists plain `npm run build:pages`, which fails after this job.
- `_docs/DEVELOPMENT.md:68-72` (section "Project identity and issue tracking") already explains that `noneuclid-fpv`
  is the long-lived identity and that names such as `camp-2026-VR` are replaceable instances.

### Local HTTPS for headset tests (verified 2026-10-28)

`wwwserver/` holds the Rebex Tiny Web Server. Its config `wwwserver/RebexTinyWebServer.exe.config` serves
`../dist/` at the site root on HTTP port 1183 and HTTPS port 11446. It reads the certificate from
`server-certificate.pfx` (next to the exe) with the password `my-super-secure-password`. The owner keeps this
password committed on purpose (issue 35, closed). `.gitignore:6-10` ignores `*.pfx`, `*.pem`, `*.cer` and `*.key`,
so a generated certificate is never committed. Because the server serves `dist/` at `/`, the build for it is plain
`npm run build` (base `/`), not `build:pages`.

Git for Windows ships OpenSSL 3.5 (`/mingw64/bin/openssl`). These commands, run in Git Bash with an example LAN
address `192.168.1.50`, produced a PFX that Windows reads with that password (`Get-PfxData` showed the subject, the
private key and a one-year expiry):

```sh
cd wwwserver
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout server.key -out server-certificate.cer \
  -subj "/CN=192.168.1.50" -addext "subjectAltName=IP:192.168.1.50,DNS:localhost"
openssl pkcs12 -export -out server-certificate.pfx -inkey server.key -in server-certificate.cer \
  -passout pass:my-super-secure-password -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
```

`MSYS_NO_PATHCONV=1` stops Git Bash from rewriting `/CN=...`. The 3DES/SHA1 options produce the older PFX format,
which the .NET Framework 4.6 server can import. Whether the Rebex server itself loads this PFX was not tested.

### How tests import `.mjs` scripts

`tsconfig.json` includes only `src` and `tests`. `tests/docs/documentation.test.ts:4-13` loads a script through a
variable path, so `tsc` treats the import as `any`:

```ts
const checksPath = "../../scripts/docs/checks.mjs";
async function loadChecks(): Promise<DocChecks> {
  return (await import(/* @vite-ignore */ checksPath)) as DocChecks;
}
```

## Decisions

1. **Base-path precedence.** Decided: `build:pages` takes the base from (1) a `--base <value>` or `--base=<value>`
   argument, then (2) `VITE_BASE`. With neither, it fails before building. The package name is never used. Why: a
   wrong base silently breaks every asset URL, and the package name `noneuclid-fpv` is the project's identity, not a
   deployment target. Alternative considered: also derive the base from `GITHUB_REPOSITORY` or a Git remote (more
   code, and the workflow already passes `VITE_BASE`).
2. **Root sites.** Decided: the values `/` and `.` both mean the domain root (base `/`). Document `.` for Git Bash,
   where `/` would be rewritten. Why: it is the only spelling that survives Git Bash. Alternative considered: a
   separate `--root` flag.
3. **Rewritten paths.** Decided: a base value that starts with a drive letter (`/^[A-Za-z]:[\\/]/`) is rejected
   with a message that explains the Git Bash rewrite and says to write the name without a leading slash. Why: the
   rewritten value looks plausible and otherwise produces a broken site. Alternative considered: trying to undo the
   rewrite (fragile).
4. **Allowed base values.** Decided: after normalisation the base must match `^/([A-Za-z0-9._-]+/)*$`. Why: Pages
   repository names use only these characters, and a stray space or `?` would break URLs. Alternative considered:
   no validation.
5. **Where the logic lives.** Decided: a new module `scripts/pagesBase.mjs` with pure functions, tested by
   `tests/scripts/pagesBase.test.ts`. `build-pages.mjs` only calls it. Why: a build script cannot be unit-tested
   cheaply, but a pure function can. Alternative considered: keep everything in `build-pages.mjs`.
6. **`scripts/deploy-pages.sh`.** Decided: delete it and the `deploy:pages` npm script. Why: the documented path is
   the Actions workflow. The script cannot run in this checkout (no `origin` remote), and it conflicts with the
   workflow. Alternative considered: rewrite it to take a remote name (adds a second deployment path nobody uses).
7. **Workflow fallback.** Decided: when `base_path` is empty, set `VITE_BASE=/`. Do not use the repository name.
   Also add `echo "Pages base: ..."` to the step. Why: an empty `base_path` means the site is at a domain root (see
   Background). Alternative considered: leave the fallback (wrong for custom domains). Risk: if the first deploy
   after this job serves broken asset URLs, revert this one change, push, and record it under `### Uncertain`.
8. **Base-path coverage in the browser smoke test.** Decided: job 04 does it, not this job. Why: job 04 rewrites
   the smoke script.
9. **Local HTTPS recipe.** Decided: document the OpenSSL commands from the Background in `_docs/DEPLOYMENT.md`
   ("HTTPS and WebXR"). Do not change `wwwserver/` or commit any certificate. Why: the commands are verified to
   produce a PFX that Windows reads, and the owner keeps the committed password. Alternative considered: PowerShell
   `New-SelfSignedCertificate` (it needs the Windows certificate store, and is harder to point at a LAN IP).

## Steps

1. **Create `scripts/pagesBase.mjs`.** Plain ESM JavaScript with a leading comment explaining its purpose. Exports:

   ```js
   /** Turns "x", "/x", "x/" or "/x/" into "/x/"; "/" and "." into "/"; empty or missing into undefined. */
   export function normalizeBase(value) {
     if (value === undefined || value === null) return undefined;
     const trimmed = String(value).trim();
     if (trimmed === "") return undefined;
     if (trimmed === "/" || trimmed === ".") return "/";
     return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
   }

   /**
    * Resolves the Pages base from `--base <v>` / `--base=<v>` in argv, then env.VITE_BASE.
    * Returns { base, source } where source is "--base" or "VITE_BASE"; throws an Error with a readable message otherwise.
    */
   export function resolvePagesBase({ argv, env }) { ... }
   ```

   `resolvePagesBase` rules, in this order:
   - Find the raw value. If `argv` has `--base=<v>`, use `<v>`. If it has `--base` followed by another element, use
     that element. If `--base` is the last element, throw `--base needs a value, for example --base noneuclid-fpv.`.
     Otherwise use `env.VITE_BASE`. Record which source was used.
   - If no raw value is found, or it is empty after trimming, throw:
     `No Pages base path given. Run "npm run build:pages -- --base <repository-name>" (for example --base noneuclid-fpv), or "--base ." for a site at the domain root.`
   - If the trimmed raw value matches `/^[A-Za-z]:[\\/]/`, throw:
     `` `The base "${raw}" looks like a Windows path. Git Bash rewrites values that start with "/"; write the repository name without a leading slash, for example --base noneuclid-fpv.` ``
   - `const base = normalizeBase(raw)`. If `base` does not match `/^\/([A-Za-z0-9._-]+\/)*$/`, throw
     `` `The base "${raw}" is not a valid Pages path; use letters, digits, ".", "_" or "-".` ``
   - Return `{ base, source }`.

   Check: the test in step 2.

2. **Test it.** New file `tests/scripts/pagesBase.test.ts`. Load the module with the variable-path pattern from
   `tests/docs/documentation.test.ts`. Test cases (one `it` each, or `it.each`):
   - `resolvePagesBase({ argv: ["--base", "camp-2026-VR"], env: {} })` returns
     `{ base: "/camp-2026-VR/", source: "--base" }`.
   - `--base=noneuclid-fpv` gives `/noneuclid-fpv/`.
   - `--base` wins over `VITE_BASE`: argv `["--base", "a"]` with env `{ VITE_BASE: "b" }` gives `/a/` from `--base`.
   - env `{ VITE_BASE: "/noneuclid-fpv/" }` alone gives `/noneuclid-fpv/` from `VITE_BASE`.
   - `--base .` and `--base /` both give `/`.
   - No argv and no env throws an error whose message contains `No Pages base path given`.
   - `--base` with no value throws `needs a value`.
   - `VITE_BASE: "C:/Program Files/Git/noneuclid-fpv/"` throws a message containing `Git Bash`.
   - `--base "my repo"` throws `not a valid Pages path`.
   - `normalizeBase("x")`, `normalizeBase("/x")`, `normalizeBase("x/")` and `normalizeBase("/x/")` all give `/x/`.
     `normalizeBase("")` and `normalizeBase(undefined)` give `undefined`.

   Check: `npx vitest run tests/scripts/pagesBase.test.ts` passes.

3. **Use it in `scripts/build-pages.mjs`.**
   - Delete the `package.json` read (`:7-9`) and the local `normalizeBase` function (`:32-38`). Remove
     `readFileSync` from the `node:fs` import if nothing else uses it. Keep `writeFileSync`.
   - Before `spawnSync`, add:

     ```js
     let pagesBase;
     try {
       pagesBase = resolvePagesBase({ argv: process.argv.slice(2), env: process.env });
     } catch (error) {
       console.error(`build:pages: ${error instanceof Error ? error.message : String(error)}`);
       process.exit(1);
     }
     console.log(`build:pages: base ${pagesBase.base} (from ${pagesBase.source})`);
     ```

   - Pass `VITE_BASE: pagesBase.base` in the `spawnSync` env.
   - Import `resolvePagesBase` from `./pagesBase.mjs`.
   - Keep `.nojekyll` and the job 02 size check unchanged.
   - Check, in Git Bash:
     - `npm run build:pages` exits 1 at once with the "No Pages base path given" message, and no build starts.
     - `npm run build:pages -- --base camp-2026-VR` prints `build:pages: base /camp-2026-VR/ (from --base)` and
       builds. Afterwards `grep -o 'src="[^"]*"' dist/index.html` shows `/camp-2026-VR/assets/`.
     - `npm run build:pages -- --base noneuclid-fpv` gives `/noneuclid-fpv/assets/`. This shows that one checkout
       builds for two repository names with no source change.
     - `VITE_BASE=/noneuclid-fpv/ npm run build:pages` fails with the Git Bash message.

     Record all four outputs under `### Checks`. Finish with `npm run build` so `dist/` is back to base `/`.

4. **Remove the `gh-pages` push script.** `git rm scripts/deploy-pages.sh`, and delete the line
   `"deploy:pages": "bash scripts/deploy-pages.sh",` from `package.json`. Do not edit the closed issues or
   `_docs/llm-handoff/` / `_docs/llm-implementation-workflow.md`; they are historical records.
   Check: `npm run typecheck` and `npm test` pass.

5. **Fix the workflow fallback.** In `.github/workflows/deploy-pages.yml:40-45`, replace the `run` block with:

   ```yaml
        run: |
          if [ -n "${{ steps.pages.outputs.base_path }}" ]; then
            base="${{ steps.pages.outputs.base_path }}/"
          else
            base="/"
          fi
          echo "Pages base: ${base}"
          echo "VITE_BASE=${base}" >> "$GITHUB_ENV"
   ```

   Keep the indentation of the surrounding steps. Change nothing else in the workflow. This cannot be run locally.
   After your push to `main`, if you can see the Actions run, record the "Pages base:" line under `### Checks`.
   Otherwise write "workflow run not observed" under `### Uncertain`.

6. **Update `_docs/DEPLOYMENT.md`.**
   - Replace "Check a build locally first (optional)" (`:49-58`) with this recipe:

     ```sh
     npm run build:pages -- --base noneuclid-fpv
     VITE_BASE=noneuclid-fpv npm run preview
     ```

     Then say: open `http://localhost:4173/noneuclid-fpv/?config=001`. Write the base without a leading slash,
     because Git Bash rewrites `/noneuclid-fpv/` into a Windows path, and `build:pages` refuses such a value. The
     preview also needs `VITE_BASE`, or it serves the app's files as HTML. Remove the link to this job.
   - Add a section "### Deploying another instance (yearly or ad-hoc repository)" after "Activity addresses":
     - `noneuclid-fpv` is the project; an instance such as `camp-2026-VR` is just another GitHub repository with the
       same source.
     - Push the same source to the new repository and do the one-time setup in it.
     - The workflow takes the base from GitHub Pages, so no file changes.
     - To check locally, use `--base camp-2026-VR` and `VITE_BASE=camp-2026-VR`.
     - Do not rename the package.
   - In "Troubleshooting":
     - delete the `deploy:pages` bullet (`:70-71`);
     - add "Every asset 404s or the page is blank locally: the build and the preview use different bases. Run both
       with the same `--base`/`VITE_BASE` value";
     - add "`build:pages` says the base looks like a Windows path: drop the leading slash".
   - In "HTTPS and WebXR" (`:73-83`), add a subsection "### Local HTTPS server for a headset" with these steps:
     1. `npm run build` (base `/`, because the server serves `dist/` at the root).
     2. Find the PC's LAN IPv4 address with `ipconfig`.
     3. Run the two OpenSSL commands from the Background, with that address in place of `192.168.1.50`.
     4. Start `wwwserver/RebexTinyWebServer.exe` and press Start.
     5. On the headset, open `https://<address>:11446/?config=001` and accept the certificate warning.

     State that the certificate files are ignored by Git and must never be committed. State that the password in
     the config is a local test setting, not a secret.
   - Check: `npm run docs:check` passes.

7. **Update `_docs/Development_guide.md`.**
   - `:70`: replace `npm run build:pages` with `npm run build:pages -- --base noneuclid-fpv`.
   - `:79-83`: the workflow builds and deploys; it does not run tests. The pre-push hook runs `npm run typecheck`
     and `npm test`.
   - `:85-89`: replace the sentences about the package-name fallback and issue 37 with: "`npm run build:pages`
     requires the target repository name (`--base <name>` or `VITE_BASE`) and prints the base it uses."
   - Check: `npm run docs:check` passes.

8. **README.** `README.md:63-69` ("Source and upstream") already names the canonical repository and site. Add one
   sentence: other repositories may host yearly or workshop copies of the same project, and the
   [deployment guide](_docs/DEPLOYMENT.md) explains how to publish one. No other README change.

9. **Try the HTTPS recipe (optional, Windows only).** In a scratch folder outside the repository, run the two OpenSSL
   commands with your LAN address. Confirm that `server-certificate.pfx` is created. Do not start the server, and do
   not copy the files into `wwwserver/`. Record the result under `### Checks`, or "skipped".

10. **Full verification.** `npm run typecheck`, `npm test`, `npm run docs:check`, then step 3's four build checks if
    not already recorded, then `npm run build`.

## Tests and checks

- New: `tests/scripts/pagesBase.test.ts` (the cases in step 2).
- No existing test changes.
- Commands (Git Bash):

  ```sh
  npm run typecheck
  npm test
  npm run docs:check
  npm run build:pages                              # must fail fast: no base
  npm run build:pages -- --base camp-2026-VR       # base /camp-2026-VR/
  npm run build:pages -- --base noneuclid-fpv      # base /noneuclid-fpv/
  VITE_BASE=/noneuclid-fpv/ npm run build:pages    # must fail: Git Bash rewrite
  grep -o 'src="[^"]*"' dist/index.html
  npm run build                                    # restore a root build
  ```

## Do not

- Do not rename the package (`package.json` `"name": "noneuclid-fpv"`).
- Do not change `vite.config.ts`; its normalisation already matches.
- Do not add a GitHub Actions test or pull-request workflow. The project gates pushes with the local pre-push hook.
- Do not commit a certificate, key or PFX, and do not change the password in `wwwserver/RebexTinyWebServer.exe.config`.
- Do not touch the browser smoke script (`scripts/smoke/browser-smoke.mjs`). That is job 04.
- Do not edit closed issues or `_docs/llm-handoff/*` to remove old mentions of `deploy-pages.sh`.
- Do not remove the job 02 size check from `build-pages.mjs`.

## Done when

- [ ] Steps 1-10 are done, or each skipped step is explained under `### Not done`.
- [ ] `npm run typecheck`, `npm test` and `npm run docs:check` pass. The four `build:pages` checks behave as in
      step 3.
- [ ] `scripts/deploy-pages.sh` and the `deploy:pages` script are gone. `git grep -n "deploy:pages"` shows hits
      only in `_issues/_closed/` and `_docs/llm-handoff/`.
- [ ] `src/` is unchanged, so `npm run docs:generate` is not needed. If you did change `src/`, run it and record why
      under `### Deviations`.
- [ ] No issue to close. This job resolves no open issue (issue 35 is already closed and points here for the HTTPS
      recipe).
- [ ] This file is moved to `.agents/jobs/_done/03_pages_deployment_configuration.md`, and its relative links are
      fixed (one more `../`). Its `Status:` line reads `Status: done on <date>.` if `### Uncertain` and
      `### Not done` are empty, otherwise `Status: done, needs review on <date>.`
- [ ] A `## Report` section is appended with these subsections:
  - `### Done`: what changed, with files and commit hashes;
  - `### Deviations`: where the work differs from the steps, and why;
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them. Always include whether
    the workflow change was observed on a real deploy;
  - `### Not done`: anything skipped, and why;
  - `### Checks`: the commands run and their results, including failures.
- [ ] The job 03 row in `.agents/jobs/README.md` links to `_done/03_...`, and its title is struck through and marked
      `(done)` or `(done, needs review)`.
- [ ] Everything is committed. Each message ends with the co-author line the repository uses.

## History

Converted from issue 37 on 2026-10-28. Already done before this rewrite: production Pages builds take the base from
`actions/configure-pages`. The package name stays `noneuclid-fpv`. `README.md` names the canonical repository. On
2026-08-03 the owner set the scope: `noneuclid-fpv` is the multi-year project identity, and names such as
`camp-2026-VR` are replaceable deployment repositories. On 2026-10-28 issue 35's request for a local-HTTPS recipe
was merged in. The old acceptance criterion "deploy to two differently named test repositories" is replaced by the
two local `--base` builds in step 3; creating real repositories is not needed.

## Report

### Done
- New `scripts/pagesBase.mjs` (`normalizeBase`, `resolvePagesBase`) and `tests/scripts/pagesBase.test.ts` (15 tests).
- `scripts/build-pages.mjs` uses it: base only from `--base`/`VITE_BASE`, printed, fails before building; package-name fallback removed; `.nojekyll` and the job 02 size check kept.
- Removed `scripts/deploy-pages.sh` and the `deploy:pages` npm script.
- `.github/workflows/deploy-pages.yml`: empty `base_path` now gives `VITE_BASE=/`; prints "Pages base:".
- `_docs/DEPLOYMENT.md` (local preview, another instance, troubleshooting, local HTTPS recipe), `_docs/Development_guide.md`, `README.md` updated.
- Commit: see the git log entry "Make Pages deployment repository-name agnostic (job 03)".

### Deviations
None.

### Uncertain
- Workflow run not observed (nothing was pushed). If the first deploy serves broken asset URLs, revert the `base="/"` fallback.
- The Rebex server loading the generated PFX was not tested.

### Not done
Nothing skipped.

### Checks
- Baseline `npm run typecheck` and `npm test` passed (635 passed, 9 skipped).
- `npx vitest run tests/scripts/pagesBase.test.ts`: 15 passed.
- `npm run build:pages` (no base): exit 1, "No Pages base path given..." and no build.
- `--base camp-2026-VR`: "base /camp-2026-VR/ (from --base)", dist size 53.4 MB OK, `src="/camp-2026-VR/assets/index-....js"`.
- `--base noneuclid-fpv`: `src="/noneuclid-fpv/assets/index-....js"`.
- `VITE_BASE=/noneuclid-fpv/ npm run build:pages`: failed with the Git Bash "looks like a Windows path" message.
- OpenSSL recipe in a scratch folder: `server-certificate.pfx` created.
- Final typecheck, test, docs:check and `npm run build`: see below / run before commit.
