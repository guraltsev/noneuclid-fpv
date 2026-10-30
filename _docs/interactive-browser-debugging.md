# Interactive browser debugging with Edge and the DevTools Protocol

Some defects only show while a person moves through the world: objects popping in and out, flicker at portal edges,
a wrong room in one eye. A headless run cannot reproduce them, and a description of them cannot be tested. This guide
sets up a session in which **you drive a normal Edge window against the local dev server and an assistant (or a
script) attaches to the same page** over the Chrome DevTools Protocol (CDP). The attached side can run JavaScript in
the page, read the console, take screenshots and record per-frame values while you move.

It uses the same mechanism as the headless smoke test (`scripts/smoke/browser-smoke.mjs`: CDP over a WebSocket, no
Playwright), only against a visible browser that you control.

## 0. Shortcut

Two actions start a session, each in its own terminal:

```powershell
npm run serve                      # Vite on port 5173, no browser opened
npm run edge -- --world cube       # Edge on that world, debugging port 9222, fresh throwaway profile
```

`npm run edge` only launches the browser; close the window to end it. The attached side then uses
`scripts/debug/cdp.mjs`, which implements the client of section 1:

```powershell
npm run cdp -- record "<expression>" 10
npm run cdp -- eval "<expression>"
npm run cdp -- shot out.jpg
npm run cdp -- console 15
```

These are npm scripts rather than `npx` commands because this package is private. The sections below describe the
same steps by hand; `cdp.mjs` there is the same script, kept in the repository.

## 1. One-time setup

### Start the dev server without opening another browser

`npm run dev` runs `vite --open "/?config=full"`, which opens your default browser. For a debugging session start the
server alone:

```powershell
npx vite --port 5173
```

### Start Edge with a remote-debugging port and a throwaway profile

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\noneuclid-edge-debug" `
  "http://localhost:5173/?config=full&world=cube&debugLevel=verbose"
```

- **Use a separate `--user-data-dir`.** Current Chromium-based browsers ignore `--remote-debugging-port` when it is
  combined with the default profile, and a throwaway profile keeps your own tabs, cookies and sign-ins out of reach of
  whatever attaches.
- The port listens on `127.0.0.1` only, but **any program on your machine can drive the browser through it**. Do not
  sign in to anything in this window, and close it when the session ends.
- Check that it works: open `http://127.0.0.1:9222/json/version` in any browser; it must return JSON.
- Keep the Edge window visible and in front while sampling. A minimised or fully covered window throttles
  `requestAnimationFrame`, which changes what the page does.
- URL parameters are those of the smoke test: `world=<id>`, `config=full`, `debugLevel=<off|basic|verbose>`. With
  `debugLevel=verbose` the console prints the debugging quick start, which lists the helpers installed on `window`
  (`noneuclidPortalDebug`, `noneuclidDebug`, `noneuclidGeometry`). For the on-screen overlay add
  `debugOverlay=1&debugOverlayItems=fps` (items such as `portal-quantities` are listed in the overlay settings page).

### Give the attached side a CDP client

`scripts/debug/cdp.mjs` is the client; the listing below is the earlier standalone version. It needs
Node 22 or later (built-in `WebSocket` and `fetch`) and no packages.

```js
// cdp.mjs  -  node cdp.mjs <eval|shot|console|record> ...
import fs from "node:fs";

const port = process.env.CDP_PORT ?? 9222;
const match = process.env.CDP_MATCH ?? "localhost:5173";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => t.type === "page" && t.url.includes(match));
if (!target) {
  console.error("no page matching", match, "among", targets.map((t) => t.url));
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  } else {
    for (const listener of listeners) listener(message);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "eval") {
    // node cdp.mjs eval "JSON.stringify(window.noneuclidPortalDebug.state)"
    console.log(await evaluate(args[0]));
  } else if (command === "shot") {
    // node cdp.mjs shot out.jpg   (JPEG keeps the file small; use .png for exact pixels)
    const png = args[0].endsWith(".png");
    const { data } = await send("Page.captureScreenshot", png ? { format: "png" } : { format: "jpeg", quality: 70 });
    fs.writeFileSync(args[0], Buffer.from(data, "base64"));
    console.log("wrote", args[0]);
  } else if (command === "console") {
    // node cdp.mjs console 10   (prints console output and exceptions for 10 s)
    listeners.push((m) => {
      if (m.method === "Runtime.consoleAPICalled") {
        console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
      } else if (m.method === "Runtime.exceptionThrown") {
        console.log("[exception]", (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
      }
    });
    await send("Runtime.enable");
    await sleep(Number(args[0] ?? 10) * 1000);
  } else if (command === "record") {
    // node cdp.mjs record "<expression returning something JSON-able>" 10
    // Evaluates the expression once per animation frame for N seconds while you move, then prints only the frames
    // in which the value changed.
    const seconds = Number(args[1] ?? 10);
    await evaluate(`(() => {
      window.__rec = [];
      let n = 0;
      const stop = performance.now() + ${seconds * 1000};
      const tick = () => {
        let v;
        try { v = JSON.stringify((${args[0]})); } catch (e) { v = "ERR " + e.message; }
        window.__rec.push([n++, v]);
        if (performance.now() < stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()`);
    await sleep(seconds * 1000 + 500);
    const frames = await evaluate("window.__rec");
    let last;
    for (const [n, value] of frames) {
      if (value !== last) { console.log(n, value); last = value; }
    }
    console.log("frames:", frames.length);
  } else {
    console.error("usage: node cdp.mjs <eval|shot|console|record> ...");
    process.exitCode = 2;
  }
} finally {
  ws.close();
}
```

## 2. Running a session efficiently

The cost of a session is mostly output volume and round trips, so the division of labour is:

1. **You** reproduce the problem in the Edge window and say what you see, in one sentence ("move sideways in `cube`
   at the start cell, objects 4-5 cells away flicker").
2. **The attached side first reads, then records, then looks.**
   - *Read once:* `node cdp.mjs eval "Object.keys(window.noneuclidPortalDebug.state)"` to learn what is available, then
     pick the few fields that matter. Do not print whole state objects: Three.js objects are circular and large, and
     `returnByValue` fails on them. Return `JSON.stringify` of selected numbers and ids.
   - *Record while you move:* you say "go", the assistant runs
     `node cdp.mjs record "<expression>" 10`, and you move sideways for ten seconds. The output lists only the frames in
     which the value changed, so a flicker shows up as a value that changes and changes back within a few frames. Typical
     expressions: the visible path count by depth, the list of visible path ids at one depth, the instance count of one
     archetype, the root cell id, the player's cell and position.
   - *Screenshot only on an anomaly:* ask for a still (stop moving) or a screenshot at the frame the recorder flagged.
     The frame loop keeps running, so a screenshot is the frame at the moment of the call, not the flagged frame.
3. **Bisect with the same recording.** Because the recording is a one-line command, the same movement can be repeated
   after each change (or on an older commit by restarting the dev server) and the two outputs compared.
4. **Keep the evidence small.** Print changes, not every frame; write long output to a file and summarise it; use JPEG
   screenshots unless exact pixels matter. Paste the final recording and the conclusion into the issue or job report.

Recording runs `requestAnimationFrame`, so it samples the page between frames, before the next update. A value that
depends on the portal pass of the current frame is therefore one frame old; this does not matter for flicker that lasts
several frames, and for anything finer the page needs a counter of its own.

## 3. Which questions this answers well

- *Did the set of visible portal paths change between two frames?* Record the count and the ids per depth.
- *Is an object's instance count changing while the object is on screen?* Record the instance count of its archetype
  (through the debug helper or the overlay state) next to the path counts.
- *Does the console show contained frame errors or warnings* (for example "no clip slot") *while the problem occurs?*
  Run `console 15` while moving.
- *Does it happen in the older build?* Check out the commit, restart the dev server, repeat the recording.

It does not answer questions about stereo or controller input; those need a headset session (see
[design/010-webxr-vr-runtime.md](design/010-webxr-vr-runtime.md)).

## 4. Ending the session

Close the Edge window, stop the dev server, and delete the throwaway profile:

```powershell
Remove-Item -Recurse -Force "$env:TEMP\noneuclid-edge-debug"
```

The profile is also deleted at the start of every `npm run edge`.
