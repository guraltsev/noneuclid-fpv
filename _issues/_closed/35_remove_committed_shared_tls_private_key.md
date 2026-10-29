# 35 - Remove the committed shared TLS private key

Status: closed on 2026-10-28.

Priority: P1 security.

## Outcome

Closed by the owner's decision. The shared development certificate has been invalidated and discarded, so the PFX
still reachable in old history and the password in `wwwserver/RebexTinyWebServer.exe.config` protect nothing. The
password stays committed on purpose; it is a local test-server setting, not a secret. No history purge is planned.

## Closing evidence

- `git ls-files wwwserver` lists no PFX or certificate (commits 70d132a and c58f88d).
- `.gitignore` ignores `*.pfx`, `*.pem`, `*.cer` and `*.key`.
- The missing local-HTTPS recipe moved to issue [37](../../.agents/jobs/03_pages_deployment_configuration.md).

## Status update 2026-10-28

Done:

- The PFX is no longer in the current tree. `git ls-files wwwserver` lists only
  `LICENSE.txt`, `README.txt`, `RebexTinyWebServer.exe` and
  `RebexTinyWebServer.exe.config` (commit 70d132a "Add local HTTPS test server
  (without private key)").
- The public `.cer` was also dropped from the index (commit c58f88d "Stop
  tracking the shared server certificate").
- `.gitignore` ignores `*.pfx`, `*.pem`, `*.cer` and `*.key`.

Still open:

- The password is still tracked: `wwwserver/RebexTinyWebServer.exe.config`
  contains `serverCertificatePassword` = `my-super-secure-password` and points
  `serverCertificateFile` at `server-certificate.pfx`. Any locally generated
  PFX has to use that committed password unless the config is changed, so it is
  a reusable password in the tree.
- The old PFX is still published in history: `git log --all --
  wwwserver/server-certificate.pfx` finds commit 02fddc9, reachable from
  branches `geodesic-rehaul` and `non-orientable` (also on the `github` remote)
  and tags `before-geodesic-cannon`, `before-redoing-menu`,
  `before-untie-and-shorten`, `begin_two_eye_debugging`,
  `deformation-worlds-work` and `works-with-detach`. The squashed `main` does
  not contain it, but the key must still be treated as public.
- No per-developer HTTPS setup is documented. `_docs/DEPLOYMENT.md` ("HTTPS and
  WebXR") only says to use "a trusted HTTPS server and certificate appropriate
  for the device"; `wwwserver/README.txt` is the vendor readme. Nothing explains
  how to create the PFX the shipped server expects.
- No note says that copies of the old certificate are revoked/unsafe, and no
  headset WebXR run without the shared key has been recorded.

## Problem

At filing time `wwwserver/server-certificate.pfx` was tracked together with its
plaintext password in `wwwserver/RebexTinyWebServer.exe.config`. Inspection with
the committed password confirmed that the PFX contains usable private-key
material. The self-signed certificate is valid until 2032.

A shared development private key is unsafe if anyone imports or trusts the
certificate on a classroom or test device. The committed password does not
protect it.

## Required work

- ~~Remove the PFX~~ (done) and its password (still committed) from the current
  tree.
- Ensure the shared certificate is not trusted on classroom/test devices; where
  it has been trusted, remove that trust and replace the certificate.
- ~~Add certificate/key patterns to `.gitignore`.~~ Done: `*.pfx`, `*.pem`,
  `*.cer`, `*.key`.
- Document a per-developer or per-device local HTTPS setup for WebXR testing.
- Prefer generated local certificates or another narrowly scoped HTTPS serving
  workflow that never commits private material.
- Decide separately whether a history purge is worth the coordination cost;
  deleting the current file does not erase old Git objects (still reachable from
  the branches and tags listed above).

## Acceptance criteria

- No private certificate/key or reusable password is tracked.
- A fresh developer can establish local HTTPS by following documentation.
- The WebXR secure-context workflow still works without a shared private key.
- Previously trusted copies are documented as revoked/unsafe for reuse.
