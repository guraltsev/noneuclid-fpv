# The site is built with a relative base ("./")

`vite.config.ts` sets `base: "./"`, so one build works from any path (Pages folders per branch, the local server, a domain
root). Public files must be addressed with `publicUrl` / `publicAssetUrl` (`src/glue/assetUrls.ts`), which resolve against
`document.baseURI`. Do not concatenate `import.meta.env.BASE_URL` yourself and do not write root-absolute URLs
("/assets/..."): a relative string handed to a dynamic `import()` resolves against the importing module (inside `assets/`),
not the page, and a root-absolute one 404s under a sub-path. The publisher (`scripts/pages_publish.py`) fails when the built
`index.html` has `src="/..."`, and `npm run smoke` serves the build under `/smoke/relocated/` to catch regressions.
