# Manual smoke checks

Checks that only a person on a real device can do (`_docs/tests.md` §3, §6.4, §8.6): perception, comfort, stereo
correctness, real controllers, and performance on the target device. Each entry starts from a state a script or a
URL sets up, says exactly what the person judges and what counts as a failure, and keeps a log of runs.

Converting one of these to a scenario removes it from here in the same change (`_docs/tests.md` §6.4). A check that
only needs a small, agreed addition to `window.noneuclid.api` is not listed here as a gap a second time: see
[`_docs/design/012-engine-api.md`](../_docs/design/012-engine-api.md) and job 45.

## M1

**Covers:** headset start: site, server certificate, enter, exit, re-enter VR.

**Setup:** Open the deployed site URL (or `npm run server` and the printed `https://` URL) on the Quest.

**Do:** Accept the server's certificate on first visit. Click "Enter VR". Look around briefly. Exit VR (the
headset's own "end session" gesture, or the in-scene exit). Re-enter VR without reloading the page.

**Judge:** Enter VR is offered whenever the device supports it; the session starts; exit returns to the desktop
view cleanly; VR can be re-entered without a reload.

**Failure:** Enter VR missing or disabled though the device supports WebXR; the session fails to start or hangs;
exiting leaves a black screen, a frozen page, or a crash; re-entering fails.

**Sources:** `_docs/acceptance-checklists.md` (the retired headset smoke checklist); `.agents/jobs/_done/03`,
`_done/39`, `_done/40`; audit items 2 (Quest), 3, 7.

**Runs:**

## M2

**Covers:** head tracking, room scale, joystick locomotion, continuous turn without drift, controller mapping.

**Setup:** Same as M1, in a room with enough space to take a few real steps.

**Do:** Look around (head tracking). Take a few physical steps (room scale). Walk with the joystick. Perform a
sustained continuous turn with the stick. Try each documented controller button (palette, select/fire, carry).

**Judge:** Head tracking matches real head movement; stepping moves the view by the same real-world distance;
the joystick walks in the facing direction; a sustained turn does not drift or snap; every documented button does
what the input reference says.

**Failure:** Tracking lags or jitters; room-scale steps do not match 1:1; joystick direction is wrong; turning
drifts or snaps; a documented button does nothing or the wrong thing.

**Sources:** `_docs/Development_guide.md` design note 010; `_issues/_closed/15`, `_closed/17`; audit item 14.

**Runs:**

## M3

**Covers:** 30 seconds of comfort and stutter.

**Setup:** Same as M1, any bundled world.

**Do:** Look and walk continuously in VR for about 30 seconds.

**Judge:** No visible stutter or dropped-frame juddering; no discomfort beyond what the comfort vignette already
mitigates.

**Failure:** Visible stutter, a frame hang, or discomfort beyond ordinary VR locomotion.

**Sources:** `_docs/acceptance-checklists.md`; `.agents/jobs/_done/04`; audit item 15.

**Runs:**

## M4

**Covers:** the XR palette and its buttons.

**Setup:** Same as M1, entered VR.

**Do:** Open the in-VR palette with the documented per-hand trigger. Hover and select an item. Go back. Use the
stick for locomotion and fire a tool, both with the palette open and closed. Use the carry buttons on a carried
object.

**Judge:** The palette opens and closes on the documented input; hover highlighting and selection work; back
navigation works; locomotion and firing keep working after the palette has been opened once.

**Failure:** The palette does not open or close as documented; hover or selection is unresponsive; opening the
palette once breaks later locomotion or firing.

**Sources:** `.agents/jobs/_done/19`; `_issues/_closed/27`, `_closed/30`; design note 011;
`_docs/acceptance-checklists.md`; audit item 31.

**Runs:**

## M5

**Covers:** the in-headset debug panel.

**Setup:** Same as M1, with a debug-enabling launch option (for example `&debugLevel=basic`).

**Do:** Toggle the debug overlay from the in-headset menu.

**Judge:** The panel follows the toggle, is readable at a comfortable distance, and stays steady as you move.

**Failure:** The panel does not appear or disappear on toggle; its text is unreadable; it jitters or lags badly.

**Sources:** `.agents/jobs/_done/19`; design note 011; audit item 32.

**Runs:**

## M6

**Covers:** stereo across a portal: both eyes, the wrong room, edges, recursion depth per eye, straddling
counters.

**Setup:** Same as M1, standing near a portal into another room, ideally one with a further portal beyond it.

**Do:** Look through the portal with both eyes. Walk up to and past a portal edge, moving the headset sideways.
Look at geometry straddling the portal boundary. Look through nested portals to check recursion depth.

**Judge:** Both eyes show consistent, correctly offset stereo views through the portal, into the correct room;
no seam, tearing or blinking at the edge as the headset moves sideways; recursion depth looks the same in both
eyes; any debug straddling counters look sane.

**Failure:** One eye's portal view is wrong, missing, or blinks out while the other eye still shows it; the wrong
destination room; a visible seam or z-fighting at the edge; recursion depth differs between eyes.

**Sources:** `_issues/56_exact_static_cull_by_oriented_line_stabbing.md`,
`_issues/57_per_frame_portal_visibility_funnel_and_traversal.md`,
`_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md`; `.agents/jobs/_done/21`, `_done/22`, `_done/23`,
`_done/28`, `_done/29`; `_issues/_closed/21`, `_closed/33`; audit items 48-51.

**Runs:**

## M7

**Covers:** per-eye instancing and the mono-XR flag re-root.

**Setup:** Same as M1, standing so each eye sees distinct content through a portal; include a placed flag or sign
visible through that portal.

**Do:** Compare what each eye renders through the portal. Observe a flag/sign seen through the portal while
moving.

**Judge:** Each eye's portal instances are independent and correct (neither eye shows the other eye's content);
the flag re-roots to the correct position and orientation under the mono-XR path.

**Failure:** The eyes show identical or incorrect portal instancing; a flag fails to re-root (wrong position or
orientation) under mono-XR.

**Sources:** `_issues/75_frame_loop_allocation_and_per_object_draw_calls.md`; `.agents/jobs/_done/17`, `_done/23`;
audit items 52, 53.

**Runs:**

## M8

**Covers:** an object straddling a portal overhangs without flicker in a headset.

**Setup:** Same as M1; find or place (`npm run cdp -- --server ... call debug.placeObjectAt ...`) an object
straddling a portal boundary.

**Do:** Look at the straddling object head-on and from an angle, from both rooms it straddles.

**Judge:** No flicker or z-fighting on the overhanging part as you move or look.

**Failure:** Visible flicker, z-fighting, or the overhanging part disappearing intermittently.

**Sources:** `_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md`; `.agents/jobs/_done/17`; audit item
42.

**Runs:**

## M9

**Covers:** `gl_ClipDistance` on the Quest's GPU driver.

**Setup:** Same as M1, on an actual Quest headset (not desktop or an emulator).

**Do:** Walk through several portals, as in M6, on Quest hardware specifically.

**Judge:** Hardware clip-plane clipping behaves the same as observed on desktop: no extra Quest-driver-specific
artifacts.

**Failure:** Clipping artifacts on Quest (missing clips, geometry bleeding through) not seen on desktop with the
same build.

**Sources:** `_issues/58_gpu_portal_clip_overflow_and_clip_planes.md`; `.agents/jobs/_done/22`; audit item 54.

**Runs:**

## M10

**Covers:** frame time on the Quest: portal ms and GPU time, in two or three worlds.

**Setup:** Same as M1, on Quest, with the debug overlay's timing fields enabled.

**Do:** Record "portal ms" and GPU time from the overlay in two or three worlds of different portal density (for
example `cube`, `dodecahedron`, `torus-moduli`).

**Judge:** Record the numbers; compare with the last recorded run for the same world and device (performance is
tracked, not asserted as a pass/fail threshold here — `_docs/tests.md` §4.7).

**Failure:** A clear regression against the last recorded run for the same world and device.

**Sources:** `_issues/58_gpu_portal_clip_overflow_and_clip_planes.md`,
`_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md`,
`_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md`; `.agents/jobs/_done/22`, `_done/23`,
`_done/28`; audit items 56 (Quest), 64 (Quest).

**Runs:**

## M11

**Covers:** the look of floor textures and models.

**Setup:** Same as M1 (a Quest confirms quality; desktop is enough to compare texture alignment).

**Do:** Look at the floor texture across a live deformation sweep in `torus-moduli` (`geometry.setTorusSkew`), and
at the authored models (trees, benches, and similar).

**Judge:** Floor textures and models look visually correct: no stretching or sliding beyond what the deformation
itself causes, no missing-asset placeholders, acceptable quality on the Quest. In `torus-moduli`, at A = 15 the floor is the rest floor; at every other setting pebbles keep their shape, and blend bands are narrow and show no seam at the room's edges.

**Failure:** Visible texture smearing or misalignment, a missing-asset placeholder, an obviously wrong model scale
or orientation.

**Sources:** `_issues/_closed/18`, `_closed/81`; `.agents/jobs/_done/10`; audit items 44, 46.

**Runs:**

## M12

**Covers:** asset provenance review before publishing.

**Setup:** None; a review of `public/assets/` and its provenance records ahead of a deploy.

**Do:** Check every shipped asset's license/provenance record (`scripts/check-dist-size.mjs`'s and
`tests/project/publicAssetPolicy.test.ts`'s automatic checks cover the mechanical part) against its source.

**Judge:** Every shipped asset has a resolved, acceptable provenance record.

**Failure:** An asset ships with an unresolved or unacceptable provenance record.

**Sources:** `_docs/DEPLOYMENT.md`; `_issues/_closed/40_resolve_unverified_public_assets.md`; audit item 69.

**Runs:**
