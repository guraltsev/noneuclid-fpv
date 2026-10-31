# Test suite and smoke timing

- `npm test` takes about a minute; `tests/cell-complex/portalPaths.test.ts` alone takes about 55 s (measured
  2026-10-30). Symptom: the run looks stuck near the end. Use a timeout of several minutes.
- `npm run smoke` over several worlds right after a build can fail with "loading screen still present after 60000 ms"
  on every page after the first, while each world passes alone; a rerun of the full command usually passes. Recorded as
  the known load flake in `.agents/jobs/_done/20_exact_static_cull.md` (Report) and
  `.agents/jobs/_reports/batch_19_23_25_29_37.md` (job 21).
