# Vitest workspace limits, and proving a git-tracked-file check

- **`passWithNoTests` cannot be set per project in Vitest 1.6.** `vitest/config`'s `ProjectConfig` type explicitly
  omits it (see `node_modules/vitest/dist/reporters-*.d.ts`, the `Omit<UserConfig, ... | 'passWithNoTests' | ...>`
  on `ProjectConfig`), so putting `passWithNoTests: true` inside a `vitest.workspace.ts` project throws a type
  error. Pass `--passWithNoTests` on the command line instead (`vitest run --project release --passWithNoTests`);
  it works as a root-level CLI flag even though the project itself has no tests yet.
- **To prove a check that reads `git ls-files` (as `scripts/tests/hygiene.mjs` does, for H1/H3/H4/etc.) against a
  scratch file you do not want to commit:** `git add -N <path>` (intent-to-add) makes the file show up in
  `git ls-files` without staging its content; after deleting the scratch file, `git reset -- <path>` drops the
  intent-to-add entry cleanly (no `git rm --cached` needed, nothing left in the index).
