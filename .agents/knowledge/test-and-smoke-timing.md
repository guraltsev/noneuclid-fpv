# Test suite and smoke timing

- Stale as of job 43 (2026-10-31): `npm test`'s unit tier now runs in ~5-8 s serially (jobs 41-43 shrank the
  depth-10 cases and moved the two slow benchmarks to `scripts/bench/`); the old "`portalPaths.test.ts` alone
  takes 55 s" note no longer applies. `npm run test:report` prints the current slowest files and the serial
  total each time, so check that instead of trusting a number here. A default tool timeout is enough; no need to
  raise it for `npm test` itself (the `release` tier's build + browser smoke is a different story).
- `npm run smoke` over several worlds right after a build can fail with "loading screen still present after 60000 ms"
  on every page after the first, while each world passes alone; a rerun of the full command usually passes. Recorded as
  the known load flake in `.agents/jobs/_done/20_exact_static_cull.md` (Report) and
  `.agents/jobs/_reports/batch_19_23_25_29_37.md` (job 21).
