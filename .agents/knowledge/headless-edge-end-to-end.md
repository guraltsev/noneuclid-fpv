# End-to-end check of the server channel with headless Edge

To test `npm run server` plus `npm run cdp -- --server ...` without a headset: build, start the server with
`Start-Process node -ArgumentList scripts/server/cli.mjs,--http,--dev,--port,11447` (set `NONEUCLID_ADMIN_PASSWORD`), then
start Edge with `--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir=<tmp>`
on `http://localhost:11447/?config=full&world=cube`. Without the SwiftShader flags WebGL may not start and the device never
joins (`devices` prints `[]`). Wait about 10 s before the first `cdp` command.
