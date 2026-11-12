# 017 - Discoverable UI and level design

Status: **proposal** (2026-11-12, second revision). Nothing here is built yet. It builds on the interaction grammar of
closed issue 30 (input intents, focus messages, help lens, palette tooltips) and keeps its renderer-neutral approach.
The aim is to make that grammar visible. Today the app depends on the player already knowing it.

Changes from the first draft, after maintainer review:

- Worlds stay **sandboxes**: every tool is available everywhere, and no activity is built around one tool or one
  computation. The per-activity tool progression and the checkable goal lists are dropped. Discovery comes from what
  the student sees and stumbles on (section 9).
- The interaction model is rebuilt from first principles as **one set of verbs** with a desktop and a VR binding
  each, including a real answer to "what is the tool dock in VR?" (section 7).
- One **naming scheme** is chosen and applied throughout (section 6).

## 1. Summary

The tools work. The trouble is that the app does not teach itself. A student who opens an activity link sees a 3D
scene with no text, no crosshair and no hint. Every capability sits behind an input they have to guess: right click
(whose meaning depends on what is under an invisible crosshair), H, F, G, Tab, the mouse wheel, Esc, R. In VR both
controllers do the same thing, and tools can only be reached through a menu that depends on aim. Tools switch
themselves off after one use without saying so. Menus use unlabeled icons. Disabled buttons do not say why. The same
object has five names. One key (R) deletes all of the student's work with no confirmation.

This note proposes:

1. **A naming scheme** built on one metaphor: the student is an explorer with a **tool belt** of everyday
   instruments (Laser, Ruler, Protractor, Sign, Map). Each instrument places or measures one kind of thing, and the
   mathematical word is given once as a subtitle ("Beam: a geodesic").
2. **Six verbs** with one meaning each, bound the same way in spirit on desktop and VR: *Use*, *Menu*, *Pick up*,
   *What's this?*, *Switch tool*, *Main menu*. Right click and the grip button mean only "the menu of the thing I aim
   at". Tools are never reached through an object menu.
3. **The tool belt as one definition with two presentations**: a dock at the bottom of the screen on desktop (number
   keys, mouse wheel), and a strap on the off-hand wrist in VR (point and pull the trigger, or the off-hand trigger to
   step through it). In VR the two hands get roles: a *pointer hand* that acts and a *belt hand* that walks and holds
   the tools. With **one controller** (left or right), that controller does both jobs and the belt moves to the waist,
   where the one hand can point at it.
4. **A persistent, minimal HUD**: always-on crosshair, the belt, and a hint strip that names the inputs that work
   right now.
5. **Explicit tool lifecycle**: a tool stays in hand until put away, and every state change is announced.
6. **Self-explaining menus**: icon plus text, a reason on every disabled control, shortcuts shown next to actions.
7. **Sandbox worlds that show before they tell**: a tool stand and a small demo at the spawn, objects that explain
   themselves on aim, and **discoveries** that the app notices and celebrates (a beam that comes back to its laser,
   two beams that meet twice) instead of goals it checks.
8. **Safety**: no destructive action on a single unguarded key or button.

Section 12 gives a phased plan with acceptance checks. The first phase is small and removes most of the friction.

## 2. How this was produced

On 2026-11-12, on `main` at `b054bab`: `npm run build`, then `npm run server -- --http --dev --port 11447`, then
headless Edge (SwiftShader) attached over CDP. The session ran through the student activities `?config=001` (cube) and
`?config=005` (torus moduli) the way a student would: aim, click, open menus, read the tutorial, place an emitter,
open its menu, use the geometry computer, look for the map. Headless Edge cannot lock the pointer, so pointer lock was
stubbed. Mouse motion was injected as `mousemove` events carrying exact `movementX/Y`; this drives the real palette
cursor and the real tools (the recipe is in the appendix). Code reading confirmed each finding, and is the only source
for the VR findings ([xrControls.ts](../../src/render/three/xrControls.ts),
[inputIntents.ts](../../src/ui/inputIntents.ts)).

Not covered: a real headset, real pointer-lock behavior of Esc in a desktop browser, audio, and a session with an actual
student. The findings are one expert's walkthrough. A short observed session with two or three students is the
cheapest way to check the priorities (section 13).

## 3. Findings

Each finding has an id that the proposals refer back to. "Seen" means observed in the running app; "code" means
established by reading the source. Findings use today's names; section 6 gives the new ones.

### 3.1 Getting started

- **F1 - Blank start (seen).** The first frame of `?config=001` has no DOM text at all (`document.body.innerText` is
  empty): no "click to start", no controls, no title, no crosshair. The only teaching object is the yellow "?" cube,
  and nothing says it can be clicked.
- **F2 - No crosshair until something is hit (seen).** The red cross appears only on an aim hit and is thin and
  low-contrast on grass. Over sky or distant scenery there is no aim point at all, though the aim point decides what
  right click opens.
- **F3 - Losing the pointer is silent (code).** No UI reacts to `pointerlockchange`. After Esc returns the mouse,
  the scene just stops responding to the mouse, with no "click to resume" card.
- **F4 - The torus spawn faces a wall (seen).** `?config=005` starts about a metre from the house wall. The first
  view says nothing about the world.
- **F5 - Controls are taught off-site (code).** The landing page explains the controls with pictures. The app itself
  only teaches them on tutorial pages that the student has to find first.

### 3.2 Input grammar

- **F6 - Right click is overloaded by aim (seen, twice).** Right click on empty floor opens the tool menu; on an
  object it opens that object's menu ([desktopInputHandlers.ts](../../src/render/three/desktopInputHandlers.ts),
  `openContextMenuFromAim`). A few pixels decide which menu appears. Aiming at an emitter gave the tool menu. Right
  clicking the floor at the computer's foot gave the computer's menu. Nothing opens the tool menu regardless of aim:
  Esc only closes ([desktopScenePaletteInput.ts](../../src/render/three/desktopScenePaletteInput.ts),
  `reduceDesktopScenePaletteToggle` returns `"none"` for Esc when closed).
- **F7 - Hidden keys (code).** H (help), F (context fallback), G (carry), Tab and the wheel (cycle overlapping
  targets), Q/E (turn), WASD (walk; the hints only say "Arrow keys") and R (reset) are taught only on tutorial pages,
  if at all. The focus tooltip of an emitter lists its menu but not G to carry.
- **F8 - R wipes the world on one keypress (code).** R teleports home *and* resets the runtime world
  ([createThreeApp.ts](../../src/render/three/createThreeApp.ts), `frame.resetRequested` →
  `teleportPlayerHome(); resetRuntimeWorld();`). There is no confirmation and no undo, and R sits next to E (turn) and
  W (walk). In VR the same action is a thumbstick press, which is easy to trigger while walking with that stick.
  Meanwhile the far less destructive Reload button in the menu needs two presses.
- **F9 - Esc does three jobs (code plus tutorial text).** The tutorial says "Esc gives the mouse back", "Esc: close
  the menu", and Esc also dismisses a pinned help. In a real browser the first Esc under pointer lock is taken by the
  browser to release the lock. To be verified with a headed browser.
- **F10 - VR hands have no roles (code).** [xrControls.ts](../../src/render/three/xrControls.ts) ignores
  `handedness`: the two sticks are summed, and every button means the same on both controllers (trigger = primary,
  grip = context menu *and* cancel, A/X = carry, B/Y = help, stick press = reset). Half of the controller is wasted.
  There is no VR binding for "next target" ([inputIntents.ts](../../src/ui/inputIntents.ts) says "Not available in
  VR"), and the only way to a tool is the aim-dependent menu of F6.

### 3.3 Tools

- **F11 - Tools switch off silently (seen).** After one emitter was placed, `selectedTool` went to `none` and the
  "RAY" badge disappeared. Nothing said so. The next click does something else.
- **F12 - No preview (seen).** With the emitter tool selected, the floor shows no ghost and no direction arrow. The ray
  that comes out is thin and short, and from a few metres away it was not visible at all.
- **F13 - No "no tool" entry (seen).** The tool menu offers no explicit hand or explore entry, so there is no visible
  way to put a tool away.
- **F14 - The tool set changes silently by world (seen).** The torus has no Map tile (the map exists only for
  Platonic solids), yet its tutorial still has a "World map" page. In `?config=001` the tutorial says "Settings
  (choose another world)", but that Settings page holds a single toggle.
- **F15 - The tools never show what they make (seen).** A student meets every tool as a tile name. Nothing in the
  world shows what a ray, a length measurement or an angle looks like before the student makes one, so a tile named
  "Geodesic emitter" or "Protractor" has to be tried blind.

### 3.4 Menus

- **F16 - Icon-only buttons (seen).** The tool menu header (gear, house, circular arrow) and the emitter menu header
  (+, pin, chain) carry no text. Their meaning appears only in a hover tooltip, and that tooltip covers the neighboring
  buttons. On the help hub, the "Tutorial" tooltip covers the "Tutorial" label it repeats.
- **F17 - Disabled without a reason (seen).** The emitter menu's unite button is grey. Its tooltip explains what unite
  does but not what is missing (two locked segments at this emitter). The tutorial calls it "the orange button".
- **F18 - Fixed-size panel, mostly empty (seen).** The palette panel keeps one size. The help hub uses its top third,
  and Settings uses one row.
- **F19 - The geometry computer is dense (seen).** It shows three notations at once: "(0 m, 15 m)", "X = 15 m current
  white (0, 15) target green (0, 15)", and "modulus 0.00 + 1.00i". A and B are never defined on the panel. The steps
  are \(\pm 1\) and \(\pm 8\) (half of the 15 m width, rounded), so reaching 15 takes eight presses.
- **F20 - Deleting works three ways (code plus tutorial).** Rays and signs are deleted with a bin in their menu;
  measurements are deleted by clicking them with no tool; the reset key deletes everything.

### 3.5 Vocabulary and help

- **F21 - Five names for one thing (seen).** The tile says "Geodesic emitter", the HUD badge says "RAY", the help lens
  says "Ray tool", the tutorial says "post", and a tooltip says "Create and terminate straight lines". Rows in the
  emitter menu are named "G1", which is never explained. Signs are auto-named "A1", and "A" is also a parameter of the
  geometry computer.
- **F22 - A flat 11-topic tutorial (seen).** No order, no "start here", no record of what has been read, no link from
  a page to the tool it describes. The pictures are small (about a third of the panel width).
- **F23 - Help points to things not yet seen (seen).** The help hub's only sentence tells the student to "use the
  Home button", which they have never seen.
- **F24 - Moving creatures steal focus (seen).** A wandering mouse crossed the aim line and replaced the emitter's
  focus tooltip with "geodesic mouse", which has no actions.
- **F25 - Thin targets are hard to hit (seen).** An emitter is a few pixels wide at 2.5 m. Scripted `lookAt` onto its
  anchor still produced no focus until the pitch was adjusted by hand.

### 3.6 Level design

- **F26 - Nothing rewards exploring (seen).** The goal pages are prose ("Explore the world...", "How much space is
  there?"). When a student does something remarkable (a ray that comes back to its emitter, walking around a cube
  corner and finding only three faces) the app does not notice, and the student may not either.
- **F27 - The interesting places are unmarked.** The mathematics lives at specific spots: a cube vertex (three
  squares, \(270^\circ\)), the single vertex of the genus-2 octagon (total angle \(1080^\circ\)), a closed geodesic on
  the torus. Nothing in the world hints that these places are worth a visit.

## 4. Root causes

1. **No persistent surface for "what can I do now".** The only always-visible element is a small tool badge, and only
   while a tool is selected. Everything else is on demand, and on demand means you already know to ask (F1, F2, F7).
2. **Modes the player cannot see.** Which menu right click opens depends on the aim (F6). What left click does depends
   on a tool that may have just switched itself off (F11). Whether a tool exists depends on the world (F14).
3. **Inputs were added one by one, not designed as a set.** Each feature got a key; nobody decided which verbs exist.
   VR inherited the desktop list and mapped it to both hands at once (F7, F9, F10).
4. **Labels are spread across the code.** Tile labels, badge labels, help titles, tooltips and tutorial copy are
   written in separate files ([paletteTooltips.ts](../../src/ui/paletteTooltips.ts),
   [helpLensDefinition.ts](../../src/ui/helpLensDefinition.ts), the tool descriptors,
   [worldBuilder.ts](../../src/authoring/worldBuilder.ts)), so they drift (F21).
5. **Help is written as a manual,** describing everything up front instead of the next step at the moment it is
   needed (F22, F23), and **the world shows no results before the student makes some** (F15, F26).

## 5. Design principles

- **P1 - Sandbox first.** Every tool, everywhere, in any order. The app never requires a sequence. It makes the next
  interesting thing *visible* and *rewarded*, not mandatory.
- **P2 - Show the inputs that work right now, all the time,** in a small strip that changes with the context. A
  student should never need to remember a key that the screen could have shown them.
- **P3 - One input, one meaning, the same on both platforms.** A verb is a concept; desktop and VR each bind it once.
- **P4 - Left click alone is enough to start.** A student who knows only "aim and click" (or "point and pull the
  trigger") can reach every tool and every object. Other inputs are shortcuts that the hint strip teaches.
- **P5 - No silent state changes.** Tool taken, tool put away, laser placed, beam linked, world reset: each gets a short
  message.
- **P6 - Every control explains itself:** a text label, and a reason when it is disabled.
- **P7 - Destructive actions are guarded:** a hold or a confirmation, and undo where it is cheap.
- **P8 - Show before telling.** A result already in the world teaches more than a tile name. Help is the next step,
  not the manual.
- **P9 - Same definitions on desktop and VR.** Everything new is a renderer-neutral definition in `src/ui/`, rendered
  by the DOM on desktop and by the scene palette in VR, as the palette and the help lens already are.

## 6. Naming scheme

### 6.1 Rules

1. **One metaphor: an explorer's kit.** The student is an explorer in a strange small world, carrying a tool belt of
   everyday instruments. Every student-visible noun is a physical thing a 12-year-old already knows. This is why
   "Laser" beats "Ray tool": everyone expects a laser to go straight, which is exactly the property that the world
   then bends.
2. **One student term per concept.** The term is the same on tiles, the belt, toasts, hints, menus, the tutorial and
   the help lens. Code ids (`geodesicEmitters/emitter`, ...) do not change; the mapping lives in one module (6.5).
3. **A tool is named after the instrument, and the instrument is named after what it places.** The Laser tool places
   lasers; the Sign tool places signs. The Ruler and the Protractor place measurements.
4. **The mathematical word appears once, as a subtitle,** on the belt slot's long label, in the help lens and in the
   tutorial: "Beam: a geodesic, the straightest possible path". Students who want the word find it; nobody needs it to
   play.
5. **Verbs are a closed list.** Input verbs (section 7) and object actions (6.3) use only the words in the tables.
6. **Short ids are a letter plus a number, and the letter is the first letter of the noun.** Lasers L1, L2; signs S1,
   S2. A beam has no id of its own: it is named by its laser and number ("L1 beam 2"), or by its two ends once linked
   ("L1–L3").
7. **No letters as parameter names in the UI.** The shape machine says "Shift" and "Height", not A and B, so letters
   stay free for ids (rule 6) and teachers can still write A and B on worksheets.

### 6.2 Nouns

| Concept (code) | Student term | Subtitle / first mention | Retire |
|---|---|---|---|
| no tool selected | **Hand** | "Use things you aim at" | none, explore |
| `geodesicEmitters` tool | **Laser** (tool) | "Places a laser that fires straight beams" | Geodesic emitter, RAY, Ray tool |
| `geodesicEmitters/emitter` | **laser** | — | emitter, post, cannon |
| `geodesicModel/segment` | **beam** | "A beam is a geodesic: the straightest possible path" | ray, geodesic, G1, straight line |
| segment ending on an emitter | **linked beam** (🔗) | "A beam from one laser to another" | locked, connected |
| united curve under shortening | **string** | "A string pulls itself tight until it is a beam again" | united curve, curve-shortening flow |
| `geodesicMeasurements/length` tool | **Ruler** | "Measures a beam end to end" | Length, Measure length |
| `geodesicMeasurements/protractor` tool | **Protractor** | "Measures the angle between two beams" | angles |
| a length or angle result | **measurement** | — | badge, tooltip |
| `placedFlags/flag` | **Sign** (tool), **sign** (object) | "Marks a place with a name" | flag |
| map tool | **Map** | "The whole world, small enough to hold" | World map |
| help cube | **help cube** | — | question cube |
| geometry computer | **shape machine** | "Changes the shape of this world" | World deformation, Geometry computer |
| polygon of the world | **face** | — | piece, cell, polygon |
| glued edge | **edge** | "Walk across an edge and you arrive at the face glued to it" | portal, seam |
| vertex / cone point | **corner** | — | vertex, column |
| creatures | the animal's name (**mouse**, **butterfly**) | "This mouse always walks straight" | geodesic mouse |

### 6.3 Object actions

| Action | Meaning | Retire |
|---|---|---|
| **Place** | put a new laser, sign or measurement | create |
| **Extend** | make a free beam 2 m longer | — |
| **Aim** | point a free beam where you look | — |
| **Add beam** | a laser fires one more beam | + |
| **Link** | happens on its own when a beam reaches a laser; never a button | lock |
| **Join** | turn two linked beams at a laser into one string | unite, orange button |
| **Pick up** / **Put down** | carry a laser or sign | carry, G |
| **Rename** | type a sign's text | edit |
| **Delete** | remove one thing; always from its menu, never by clicking with the Hand (fixes F20) | bin-only names, remove |
| **Go home** | teleport to the start, keep everything | Home |
| **Start over** | remove everything placed, go home | reset, R, Reload |

If Reload and R really do the same thing, they become one action, "Start over". If Reload also reloads the page, the
page reload moves to Settings as "Reload app".

### 6.4 UI surfaces

| Surface | Student term | What it is |
|---|---|---|
| tool dock / wrist or waist strap | **tool belt** | The slots for Hand and the five tools (7.4) |
| palette opened on an object | **menu** of that thing ("Laser menu") | Opened by the *Menu* verb |
| old tool menu without its tools | **main menu** | Help, Settings, Go home, Start over (7.5) |
| help lens (H) | **What's this?** | Explains what you aim at |
| help hub on the cube | **Help** | Pages: Things to try, How to, Discoveries |
| tutorial pages | **How to** | One card per tool plus Basics |
| goal pages | **Things to try** | Prose prompts, never checked |
| discovery log | **Discoveries** | 9.4 |
| bottom text line | hint strip (not named in the UI) | 8.2 |

### 6.5 Enforcement

A single module, `src/ui/vocabulary.ts`, exports every student-visible noun, verb and subtitle. Tool descriptors,
tooltips, help topics, the HUD, toasts and generated tutorial sentences read from it. World scripts keep prose, so a
docs check scans `src/ui/`, the tool descriptors and `src/examples/*.world.js` for the retired terms in the tables
above and fails on any hit in a student-visible string.

## 7. Interaction model

### 7.1 Verbs

Every input in the app is one of these verbs. Nothing else is bound.

| Verb | Meaning | Desktop | VR, two controllers (pointer hand unless noted) | VR, one controller (7.3) |
|---|---|---|---|---|
| **Look / Walk** | move yourself | Mouse; WASD or arrows; Q/E turn | Head; belt-hand stick (walk and turn); pointer-hand stick x turns | Head; stick (y walks, x turns) |
| **Use** | do what the tool in hand does to what you aim at. With the Hand: the object's main action, or its menu if it has none | Left click | Trigger | Trigger |
| **Menu** | open the menu of the thing you aim at; when a menu is open, close it (back one level) | Right click (or F) | Grip | Grip |
| **Pick up** | carry the laser or sign you aim at; again to put it down | G | A | Lower face button (A or X) |
| **What's this?** | explain what you aim at | H | B | Upper face button (B or Y), tap |
| **Switch tool** | take a tool from the belt | 1–5, 0 for Hand, mouse wheel | Belt-hand trigger: next tool. Belt-hand grip: Hand. Or point at a belt slot and Use | Stick press: next tool (Hand is in the cycle). Or look down, point at a slot on the waist belt and Use |
| **Main menu** | Help, Settings, Go home, Start over | Esc (shows the pause card) | Belt-hand X, or the ☰ slot on the belt | Upper face button held 1 s, or the ☰ slot on the belt |
| **Start over** | guarded | Hold R for 1.5 s, or the main menu | Main menu only | Main menu only |
| *Next target* (advanced) | cycle overlapping targets | Tab | not bound; angular picking (8.4) removes most of the need | not bound |

Consequences:

- **Right click and grip never open the tool list.** With nothing aimed at, they do nothing but show the hint "Aim at
  something to open its menu". This removes F6.
- **Use with the Hand reaches everything** (P4): on the help cube it opens Help, on a shape-machine button it presses
  it, on a laser it opens the Laser menu. A student who only clicks still finds every menu.
- **Menu toggles.** The same button opens and closes a menu, on both platforms, so "back" is never a separate thing to
  learn. Esc also closes on desktop where the browser delivers it, and opening the pause card closes any menu, so the
  F9 problem disappears.
- **The mouse wheel switches tools.** Cycling targets moves to Tab only, which already does it.
- **F stays as an alias of Menu** for trackpads without a right button, and the hint strip says "Right click / F".

### 7.2 VR: two hands, two roles

Today both controllers are identical (F10). The proposal gives them roles, a pattern most VR creation apps use:

- **Pointer hand** (right by default; "Left-handed" in Settings swaps): the laser pointer, *Use*, *Menu*, *Pick up*,
  *What's this?*, and stick x for turning (snap or smooth, as the comfort settings say).
- **Belt hand**: walking with the stick (as now), the tool belt on its wrist, *Switch tool* on its trigger and grip,
  *Main menu* on X. Y is left free. The stick press is free too: it no longer resets (F8).

The belt-hand trigger is deliberately "next tool". A new VR user squeezes every button to see what happens. Here the
experiment is harmless (a tool changes, a toast says which, the belt highlights it) and it teaches the belt.

[xrControls.ts](../../src/render/three/xrControls.ts) has to read `handedness`. The exact button layout needs a
headset session (section 13).

### 7.3 VR with one controller

Activities must work with a single controller, left or right: a lost or flat controller, a shared headset, a student
who can use only one hand. One controller has a trigger, a grip, a stick with a press, and two face buttons (A/B on the
right, X/Y on the left). That is enough for every verb if each control keeps the meaning it has on the pointer hand,
and the belt-hand jobs move to what is left:

- **Walk and turn on the one stick** (y walks, x turns), as today's combined reader already does.
- **Trigger, grip, lower and upper face buttons** keep their pointer-hand meanings: Use, Menu, Pick up, What's this?.
  Only the letter in the glyph changes with the hand (A or X, B or Y).
- **Switch tool goes to the stick press:** each press takes the next slot, Hand included, and the toast and belt show
  which. The stick press was dropped as reset because it fires by accident while walking (F8). An accidental tool
  change is harmless and announced, and the press is **ignored while the stick is pushed** past its dead zone, so
  walking cannot trigger it.
- **Main menu goes to a 1 s hold of the upper face button.** A tap stays What's this?. A ring fills on the button's
  glyph in the hint, so the hold is taught where it is used.
- **The belt moves to the waist.** A hand cannot point at its own wrist, so with one controller the belt is a strap
  of slots at waist height that follows the player's yaw (not the head's pitch), in front of the body. Looking down
  shows it; the controller points at a slot and Use takes it. This is the literal tool belt, and it keeps P4: a
  student who only knows the trigger can still reach every tool.

**Layout detection.** The reader picks the layout from the input sources that have a gamepad: two with distinct
handedness → two controllers; exactly one (left, right or `none`) → one controller, glyphs named for its handedness
(`none` uses A/B). The layout is re-evaluated whenever `inputsourceschange` fires. A change mid-session is announced
with a toast ("One controller: your tools are on your belt, look down") and the belt moves to its new place. Settings
can force one-controller mode, for a student who has two controllers but wants to use one hand.

Every hint, glyph and How to picture comes from the input-intent table, which gets three XR layouts instead of one:
two controllers, one left, one right (10). Nothing else in the UI knows how many controllers there are.

Hand tracking without controllers is out of scope here. The verbs would map to gestures (pinch = Use), and the waist
belt would work unchanged.

### 7.4 The tool belt

The belt is one renderer-neutral definition (`src/ui/toolBeltDefinition.ts`): an ordered list of slots, each with a
number, an icon, the short name, the subtitle, and enabled or a disabled reason. Slot 0 is the Hand and comes first;
tools follow in a fixed order (Laser, Ruler, Protractor, Sign, Map); the main menu slot ☰ comes last. A tool that
the world does not support (the map in a torus) is **shown disabled with its reason** ("No map for this world"), not
hidden, so the belt looks the same in every world and F14 cannot surprise anyone.

| | Desktop | VR, two controllers | VR, one controller |
|---|---|---|---|
| Where | Bottom center of the screen, always visible | A strap of slots around the belt-hand wrist, always visible; it grows and faces you when you look at your wrist | A strap at waist height in front of the body, following the player's yaw; visible when looking down |
| Select | 1–5 and 0; mouse wheel; Use on the tool stand (9.2); click a slot while the pause card is up | Point at a slot and Use; belt-hand trigger (next) and grip (Hand); Use on the tool stand | Point at a slot and Use; stick press (next); Use on the tool stand |
| Active slot | Raised, with the name under it | Raised, with the name above it, and the tool's icon also at the pointer-hand tip | Same, icon at the controller tip |
| Hover | Subtitle shown above the slot | Subtitle shown above the slot when pointed at | Same |

This answers the VR question: number keys are only the desktop shortcut for the belt, the way the belt-hand trigger
(two controllers) or the stick press (one controller) is the VR shortcut. Every layout shows the same belt, and every
layout can point and click at it.

### 7.5 The main menu

The old tool menu loses its tools and keeps the rest: **Help, Settings, Go home, Start over**. On desktop it is the
pause card (8.1): pressing Esc releases the mouse and shows it, which is what browsers do with Esc anyway. In VR it is
a palette opened from X on the belt hand (one controller: holding the upper face button) or the ☰ slot, placed in
front of the player and not tied to the aim.

## 8. UI proposals

### 8.1 Start and pause card (F1, F3, F5, F9)

A DOM card is shown whenever the pointer is not locked on desktop: at start, and whenever the lock is lost. It is
the desktop main menu.

```
┌──────────────────────────────────────────────┐
│  Activity 1 · Cube world                      │
│  A small world made of six square faces.      │
│                                               │
│  [ Click to play ]                            │
│                                               │
│  Mouse  look          WASD  walk              │
│  Left click  use      Right click  menu       │
│  1–5  tools           H  what's this?         │
│                                               │
│  Help · Settings · Go home · Start over       │
└──────────────────────────────────────────────┘
```

- The title and the one-line description come from the world. The controls table is generated from the input-intent
  table ([inputIntents.ts](../../src/ui/inputIntents.ts)), so it cannot drift from the bindings.
- The world is dimmed slightly behind the card, which makes "paused" obvious.
- VR has no pointer lock. When the session starts, a card in front of the player shows the controllers actually
  present (two, or the one left or right controller) with the verbs on their buttons, and the trigger dismisses it.
  The same picture, for the current layout, is in Help → How to → Basics.

### 8.2 Persistent HUD (F2, F7, F11, F13)

Three always-on elements, driven by one renderer-neutral `hudDefinition`:

1. **Crosshair**, always visible: a small white dot with a dark outline. It grows into a ring over something you can
   use, and takes the tool's color when a tool is in hand. The existing red aim cross stays a debug overlay. In VR the
   pointer ray already does this job; it gets the same ring at its hit point.
2. **Tool belt** (7.4).
3. **Hint strip**, just above the belt on desktop, and inside the focus label at the hit point in VR. It lists up to
   three verbs that do something *right now*, using the bindings of the current platform:

   | Situation | Desktop strip |
   |---|---|
   | Hand, aiming at floor | `1–5 tools · H what's this?` |
   | Hand, aiming at the help cube | `Left click: open Help` |
   | Hand, aiming at a laser | `Left click / right click: Laser menu · G: pick up` |
   | Laser in hand, aiming at floor | `Left click: place a laser · 0: put the Laser away` |
   | Laser in hand, aiming at a free beam | `Left click: extend 2 m · right click: Laser menu` |
   | Ruler in hand, aiming at a beam | `Left click: measure this beam` |
   | Carrying a laser | `G: put down` |
   | Menu open | `Left click: choose · right click: close` |

   The strip replaces the action rows of the floating focus tooltip, which keeps only the object's name and so covers
   less of the object.

Settings gets a "Show hints" switch (on by default, remembered per browser) for teachers who want a clean screen.

### 8.3 Tool lifecycle (F11, F12, F3)

- **Tools stay in hand** until put away: 0, the Hand slot, the wheel; in VR the belt-hand grip (two controllers) or
  stick presses round to the Hand (one controller).
- **Announce changes.** A toast queue (2.5 s, at most two visible; above the belt on desktop, above the belt-hand
  wrist in VR with two controllers, low in the field of view with one, since the waist belt is often out of sight)
  carries "Laser", "Laser L3 placed", "Beam linked: L1–L3", "Length 12.4 m", "World reset · U to undo".
  One renderer-neutral `toastQueue` is fed by module events.
- **Previews.** With the Laser, a translucent ghost laser at the aim point, with an arrow along the facing direction.
  With the Ruler and the Protractor, the target highlight shows what a click would measure. A clear outline on the
  focused object (8.4) does most of this for every tool.
- **Visible beams.** Beam width at least 2 px in screen space, an end cap, and a short pulse running along a new beam
  so that the eye follows where it went.

### 8.4 Targeting (F24, F25)

- **Minimum target size.** Pick an object when the aim ray passes within an angular radius of its hit proxy (say
  \(1.5^\circ\)) and nothing nearer is hit, as well as on an exact hit. Thin objects (lasers, beams, crossings) become
  easy to hit. [aimTarget.ts](../../src/interaction/aimTarget.ts) already ranks several candidates; this adds an
  angular test.
- **Sticky focus.** Keep the current focus for about 150 ms after the ray leaves it, unless the ray lands on another
  usable target. Creatures with no action for the current tool are not focusable (What's this? still names them).
- **Focus outline** in the tool's color.
- **Focus freezes while a menu is open,** so the aim cannot wander onto another object behind the panel.

### 8.5 Self-explaining menus (F16, F17, F18, F20)

- **Icon plus text everywhere.** The Laser menu header becomes "+ Add beam", "✋ Pick up · G", "Join", "🗑 Delete".
  Hover tooltips then carry only the longer explanation.
- **A reason on every disabled control.** Extend `PaletteHeaderAction`, the object actions (`ObjectActionEntry`) and the
  palette buttons with `disabledReason`, shown under the control in small text, not only on hover: "Needs two linked
  beams at this laser", "Linked beams cannot be aimed", "No map for this world". The definitions in
  [paletteDefinition.ts](../../src/ui/paletteDefinition.ts) already compute availability; they carry the reason with
  it.
- **Shortcuts in menus.** Any action that also has a key or button shows it ("Pick up · G" on desktop, "Pick up · A"
  in VR). Menus then teach the keys.
- **Readable beam rows** in the Laser menu: "Beam 1 · 4.0 m · free" and "Beam 2 · L1–L3 · linked 🔗" instead of "G1".
- **One way to delete:** every placed thing, measurements included, has Delete in its menu. Use with the Hand on a
  measurement opens its menu instead of deleting it.
- **The panel fits its content,** with a maximum height. Tooltips go outside the panel edge and never over a sibling.

### 8.6 Help where the player is (F14, F22, F23)

- **Help has three pages:** *Things to try* (the world's prose prompts), *How to* (Basics plus one card per tool) and
  *Discoveries* (9.4).
- **How to is generated against the world.** The Basics card ("Look and walk · the tool belt · menus · what's this?") is
  marked "Start here". Tool cards appear in belt order. A card for a tool that the world does not support says so
  instead of disappearing. Sentences that depend on the config (what Settings contains) are generated, not written.
- **"Try it" buttons.** Each tool card has "Try it": it takes the tool, closes Help, and shows the card's first step
  as a tip.
- **First-use tips.** The first time a tool is taken in a session, a small tip is pinned beside the belt: the first
  step of its How to card, with "Next" and "Got it". It advances on the event it describes (laser placed → "Click the
  beam to extend it").
- **What's this?** stays as it is; the hint strip always offers it.
- **Larger pictures:** on How to cards the picture goes above the text, full panel width.
- **The help hub's sentence:** "Lost? Press Esc and choose Go home", generated from the main-menu binding of the
  current layout (two controllers: "Press X"; one controller: "Hold B" or "Hold Y").

### 8.7 Settings

Settings becomes the place for comfort and accessibility, whatever the config:

- Controls: a reference generated from the intents, mouse sensitivity, invert Y, turn speed, "Left-handed" (VR),
  "Use one controller" (VR).
- Display: text size (three steps, scaling the DOM HUD and the palette font tokens in
  [tokens.ts](../../src/render/three/palette/tokens.ts)), "Show hints", "Show edges" (9.5), "Reset tips".
- Comfort: the anti-nausea vignette (existing).
- World selection and debug stay gated by the config, as now.

### 8.8 Safety (F8)

- **Start over** on desktop is "hold R for 1.5 s", with a ring filling around the crosshair and the toast "World reset
  · U to undo (10 s)". Undo restores a snapshot of module state taken just before the reset; the runtime world already
  rebuilds from state, so this is cheap. Without undo, the hold alone is the minimum.
- **In VR** Start over is only in the main menu, which asks for confirmation. The stick press does nothing.
- **Delete** is a single press but announced by a toast and undoable for the last action ("Sign S2 deleted · U to
  undo"; VR: an "Undo" button on the toast).

### 8.9 Shape machine (F19)

- One picture on the main view: the torus as a parallelogram with its two sides labelled **Shift** and **Height** in
  metres, redrawn live as the target changes. The complex modulus moves to a "More" line for older students.
- Steppers per parameter with \(\pm 1\) and direct entry (a small keypad, as the sign editor already has), plus generic
  presets: "Square", "Shift by half", "Shift by a whole width", "Tall".
- "Same world as the start" is a visible badge when it holds.
- "GO!" becomes "Reshape world", disabled with the reason "Nothing to change" when target equals current.

## 9. Level design for sandbox worlds

The worlds stay open sandboxes (P1). Level design here means arranging each world so that the tools and the
mathematics are *encountered*: seen in use, labelled when aimed at, and rewarded when found.

### 9.1 Spawn (F4, F1)

- **Spawn framing rule.** The start pose faces the help cube and the tool stand (9.2) at 2 to 3 m, slightly left of
  center, with an open view of the world behind them. The first frame then shows "here is help", "here are the tools"
  and "here is somewhere to go". A test checks it: the help cube's center lies in the central third of the start
  frustum, and no static object is closer than 1.5 m along the view ray. The torus spawn fails it today.
- **The help cube says "click me".** A floating label "? Help" over the cube until it has been opened once, and a
  gentle bob.

### 9.2 Tool stand and demo (F15)

Next to the spawn, a **tool stand**: a low table with each tool on it as a real object (a small laser, a folded
ruler, a protractor, a blank sign, a rolled map), each labelled. Use on an item takes that tool, exactly like its belt
slot, and the belt slot flashes: "Laser · press 1 next time". The stand turns the belt into something the student
finds in the world rather than a row of icons to decode, and it works the same on desktop and in VR.

Beside the stand, a small **demo** that shows each tool's result before the student makes one (P8):

- a laser L1 already firing a beam across the face;
- a Ruler measurement on that beam;
- a sign S1 reading "Start".

They are ordinary objects. The student can open the Laser menu, aim the beam, delete everything. What's this? on each
explains it, and the hint strip shows what to do with it. A demo beam that already crosses an edge shows the gluing
from the first frame.

The stand and the demo are authored per world (9.6). The activity worlds get both, while the unrestricted sandbox and
author test worlds may leave them out.

### 9.3 Landmarks and orientation

- One **landmark per face**, visible from the far edge of the face and unique in shape and color. 001 already does
  this well (tree, bench, bicycle, butterfly, grass). Keep it as an explicit authoring rule, and add it to 002 and the
  plain Platonic worlds.
- **Face names** ("Snow face"), as a small ground marking a teacher can switch on, let a class describe routes in
  words.

### 9.4 Discoveries (F26, F27)

Instead of goals the app checks, the app **notices**. A discovery is a remarkable event that the sandbox detects,
whatever the student was doing. When one happens, a toast "Discovery!" shows its name and one question, and it is
added to Help → Discoveries. The questions push towards the mathematics without asking for a particular sequence.

| Discovery | Detected when | Question shown | Detection |
|---|---|---|---|
| Across an edge | the player first changes face | "Which face did you land on? Was it the one you expected?" | cell change; cheap |
| Back where you started | the player returns to the spawn face by a different edge | "How many faces did you pass through?" | face history; cheap |
| The beam came home | a beam ends at or crosses its own laser | "Did you aim it at the laser? How long is the loop?" | beam trace; cheap |
| A beam hits a corner | a beam stops at a corner | "Why can't a beam go through a corner?" | already a stop reason; cheap |
| Meeting twice | two beams cross at two different points | "Could two straight lines meet twice on a flat sheet of paper?" | intersections of traced beams; moderate |
| Around a corner | the player walks once around a corner | "How much did you turn? Measure the angles of the faces that meet here." | turning accumulated around a vertex; moderate |
| Tight string | a joined string becomes a beam again | "Is this beam shorter than the string? Why?" | shortening flow finished; cheap |
| A new shape | the shape machine changes the world | "Is this a different world? How could you tell from inside?" | deformation committed; cheap |

The Discoveries page also lists the ones not yet found as **teasers**, with a name and a hint but no answer: "??? ·
something happens when a beam reaches a corner". Teasers are the natural pointer to tools the student has not tried,
and they never block anything. Discoveries are per world and reset with Start over. World authors can switch off
discoveries that cannot happen in their world (a world with no corners) and add their own (9.6).

**Places worth a look** (F27). For world-specific discoveries an author may place a **curiosity marker**: a small
glowing "?" on the floor at the place (a cube corner, the genus-2 corner point, the shape machine). On approach (3 m)
it shows only the teaser of its discovery. It is a signpost, not an exercise. When the discovery is found, the marker
turns into a tick.

### 9.5 Edges on request

Showing the glued edges would give away the main thing to discover. So "Show edges" is a Settings switch, off by
default. After the "Across an edge" discovery, the discovery's Help entry offers it ("Want to see where the faces are
glued?").

### 9.6 Authoring API additions

All optional, so existing world scripts keep working:

- `startingPosition(..., { faceToward: "<objectId>" })`: computes the turn; validated by the spawn framing rule.
- `toolStand(face, { position, facing })` and `demo(face, { laser, ruler, sign })`.
- `discoveries: { disable: ["around-a-corner"], add: [{ id, name, question, teaser, marker?: { face, position } }] }`
  on the world, where `add` entries name a detector from the module (for example `{ visitFace: "snow" }`).
- `landmark: true` on static objects: feeds the per-face landmark check and the map labels.
- `TutorialPageSpec.toolId`: ties a How to card to a belt slot, for ordering and "Try it".
- `goalPages` stays, displayed as *Things to try*.

## 10. Where the code goes

This follows the layer DAG that `docs:check` enforces (layers in `scripts/docs/lib.mjs`):

| Piece | Layer and file | Notes |
|---|---|---|
| Verbs and bindings | [inputIntents.ts](../../src/ui/inputIntents.ts) | New intents `switch-tool`, `hand`, `main-menu`, `undo`; `reset` becomes a hold; `InputMode` gains XR layouts (two controllers, one left, one right) with their own glyph tables |
| VR hand roles and layouts | [xrControls.ts](../../src/render/three/xrControls.ts) | Read `handedness`; pick the layout per frame from the sources; per-role buttons; one-controller stick press gated on the dead zone; hold detection for the upper face button |
| Belt placement in VR | the wrist (two controllers) or a yaw-following waist anchor (one controller) | Same belt definition, two anchors |
| Desktop keys | [desktopControls.ts](../../src/render/three/desktopControls.ts), [desktopInputHandlers.ts](../../src/render/three/desktopInputHandlers.ts) | Number keys, wheel to tools, right click object-only and toggling, hold R |
| Belt, HUD, hint strip, toasts, tips | `src/ui/toolBeltDefinition.ts`, `src/ui/hudDefinition.ts`, `src/ui/toastQueue.ts`, `src/ui/firstUseTips.ts` | Pure definitions from session state, focus and tool descriptors |
| Vocabulary | `src/ui/vocabulary.ts` | Read by the tool descriptors and all ui definitions |
| Desktop rendering | `src/render/dom/` (replaces [desktopToolIndicator.ts](../../src/render/dom/desktopToolIndicator.ts)) | Belt, strip, toasts, pause card |
| VR rendering | `src/render/three/palette/`, the wrist (from [xrControllerHandModels.ts](../../src/render/three/xrControllerHandModels.ts)) | Same definitions |
| Tool lifecycle | runtime menu state and the tool modules | Remove the auto-deselect; emit events for toasts and discoveries |
| Angular picking, sticky focus | [aimTarget.ts](../../src/interaction/aimTarget.ts) | Second pick test; focus hysteresis in the shell |
| Disabled reasons | [paletteDefinition.ts](../../src/ui/paletteDefinition.ts), `ObjectActionEntry` | Add `disabledReason` |
| Discoveries, curiosity markers, tool stand, demo | a new module `src/modules/discoveries/`, world objects for the stand and marker, [worldBuilder.ts](../../src/authoring/worldBuilder.ts) | Reads world state through the module API of design 013 |

Every new student-visible string goes through the vocabulary module, and every new definition gets the same kind of
pure unit test as the palette definition.

## 11. Rejected alternatives

- **Number keys only, nothing visible.** Fast for experts, invisible for everyone else, and meaningless in VR.
- **A radial tool wheel** (hold a button, flick to a slot). Good for experts on both platforms, but it hides the tools
  until the student knows the button, which is the problem this note is about. It can be added later on top of the
  belt.
- **Tools only in the world** (the tool stand alone). Discoverable, but the student would have to walk back to change
  tools. The stand teaches the belt and does not replace it.
- **Right click on empty floor opens the tools** (today's fallback). It keeps the aim-dependent meaning of F6, so it is
  dropped once the belt exists.
- **Checkable goal lists and one tool per activity** (first draft). They turn worlds into exercises; the maintainer
  wants sandboxes. Discoveries keep the feedback without the sequence.

## 12. Phased plan

Each phase can ship on its own. The acceptance checks can be scripted with the CDP recipe in the appendix.

**Phase 1: stop the bleeding** (small, the highest value for its size)

- Pause card with the generated controls (8.1), always-on crosshair, hold-R plus toast, VR stick press no longer
  resets (8.8), tools stay in hand and 0 puts them away (8.3), header buttons with text (8.5), help hub sentence (8.6).
- Check: the first frame of `?config=001` contains "Click to play" and at least four control rows. A single R press
  does not change the world. After placing a laser, `selectedTool` is still the laser tool.

**Phase 2: names and verbs**

- The vocabulary module and its check (6.5); right click and grip become object-only and toggling (7.1); Tab only for
  targets; beam rows, sign ids and one way to delete (8.5).
- Check: no retired term in student-visible strings. Right click with nothing aimed at opens nothing.

**Phase 3: the belt and the HUD**

- Tool belt on desktop (dock, number keys, wheel) and in VR (wrist strap and hand roles for two controllers, waist belt
  and stick press for one), main menu in VR, hint strip, toasts, focus outline and angular picking (7.2 to 7.5, 8.2 to
  8.4).
- Check: for each row of the table in 8.2 the strip text matches. Pressing 2 takes the Ruler from any aim. Unit tests
  of the XR reader:
  - two controllers: belt-hand trigger yields "next tool", pointer-hand trigger yields "use";
  - one left or one right controller: trigger yields "use", stick press with the stick centered yields "next tool",
    stick press with the stick pushed yields nothing, an upper-button hold of 1 s yields "main menu" and a tap yields
    "what's this?";
  - removing one of two sources switches the layout and emits the toast.

  Headset session with two controllers and with each single controller before the bindings are final.

**Phase 4: menus and help**

- `disabledReason` everywhere, panel fits its content, shape machine redesign, Help with three pages, generated How to,
  "Try it", first-use tips, Settings (8.5 to 8.9).
- Check: no disabled control without a reason (unit test over all definitions). The torus How to shows the Map card
  as "No map for this world". "Try it" on the Laser card takes the Laser and closes Help.

**Phase 5: sandbox level design**

- Spawn framing rule and its test, the "click me" cube, tool stand and demo in the activity worlds, the discoveries
  module with the cheap detectors first, curiosity markers, Show edges (section 9).
- Check: every activity world passes the spawn framing test. In 001 a scripted walk across one edge
  (`motion.walkTo`) records "Across an edge". Use on the stand's laser takes the Laser.

## 13. Not decided here

- **Student terms (section 6).** "Laser", "beam" and "string" are proposals. Teachers in the target age group should
  confirm them before phase 2.
- **VR bindings (7.2, 7.3).** The role split, the belt-hand trigger, the waist belt and the stick-press tool switch need
  a headset session, including left-handed use and each single controller. Whether the waist belt is comfortable to
  point at when seated is the main open question.
- **Edges hidden by default (9.5)** because finding the gluing is the activity; a teacher may disagree.
- **Which discoveries ship first,** and whether the moderate detectors (meeting twice, around a corner) are worth their
  cost.
- **Undo** beyond the last reset or deletion is out of scope.

Revisit when an observed session with students contradicts the priorities. The quickest such test: three students,
`?config=001`, no instructions, 10 minutes, noting the first time each finds the help cube, takes a tool, places a
laser, opens a menu, and loses their work.

## Appendix: reproducing the walkthrough

1. `npm run build`, then `npm run server -- --http --dev --port 11447`.
2. Headless Edge: `msedge --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
   --remote-debugging-port=9333 --user-data-dir=<tmp> --window-size=1280,800 "http://localhost:11447/?config=001"`.
3. Stub pointer lock in the page: define `document.pointerLockElement` to return the canvas, and make
   `canvas.requestPointerLock` and `document.exitPointerLock` no-ops.
4. Drive the palette and the look direction with `canvas.dispatchEvent(new MouseEvent('mousemove', {bubbles: true,
   movementX, movementY}))`. CDP `Input.dispatchMouseEvent` positions do not map reliably to movement deltas. Use
   `mousedown`/`mouseup` events on the canvas (button 0 or 2) for clicks, and CDP key events for keys.
5. Use `noneuclid.api.motion.run([{ to: "<objectId>", stopAt: 2.5, lookAt: "<objectId>" }])` to stand in front of an
   object.
6. Read the HUD with `document.body.innerText`, and tool state with `noneuclid.api.debug.dumpAllGeodesics()`
   (`selectedTool`).

On Windows, `node` may be a `.cmd` shim, so arguments containing `>` are taken as redirections. Pass page expressions
through files.
