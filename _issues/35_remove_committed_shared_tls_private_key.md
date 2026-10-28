# 35 - Remove the committed shared TLS private key

Status: open as of 2026-08-03T14:24:10-05:00.

Priority: P1 security.

## Problem

`wwwserver/server-certificate.pfx` is tracked together with its plaintext
password in `wwwserver/RebexTinyWebServer.exe.config`. Inspection with the
committed password confirms that the PFX contains usable private-key material.
The self-signed certificate is valid until 2032.

A shared development private key is unsafe if anyone imports or trusts the
certificate on a classroom or test device. The committed password does not
protect it.

## Required work

- Remove the PFX and its password from the current tree.
- Ensure the shared certificate is not trusted on classroom/test devices; where
  it has been trusted, remove that trust and replace the certificate.
- Add certificate/key patterns to `.gitignore`.
- Document a per-developer or per-device local HTTPS setup for WebXR testing.
- Prefer generated local certificates or another narrowly scoped HTTPS serving
  workflow that never commits private material.
- Decide separately whether a history purge is worth the coordination cost;
  deleting the current file does not erase old Git objects.

## Acceptance criteria

- No private certificate/key or reusable password is tracked.
- A fresh developer can establish local HTTPS by following documentation.
- The WebXR secure-context workflow still works without a shared private key.
- Previously trusted copies are documented as revoked/unsafe for reuse.
