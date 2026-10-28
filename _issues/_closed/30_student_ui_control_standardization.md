# 30 - Student UI control standardization and discoverability

Status: closed on 2026-08-03.

## Outcome

Input intents, structured world interactions, contextual help, shared result
badges, normalized context-menu routing, input-specific hints, and palette
tooltips are implemented. Deprecated prompt fields and unused DOM compatibility
paths are P3 cleanup tracked by issue 38.

## Closing evidence

The repository audit at `09dafe7` inspected each phase's implementation and
focused UI/render/runtime tests. Node/npm were unavailable, so tests were not
rerun for this documentation-only closure.

## Goal

Make the exploration interface predictable for students by establishing one
shared interaction grammar across desktop and VR.

The current controls mostly work, but they are not yet taught by the UI as one
coherent system. The app should make these rules feel obvious:

- desktop tools and object menus open with right click,
- VR tools and object menus open with the side trigger or grip-style context
  control,
- desktop left click and VR trigger/select are the primary action,
- short hover/focus messages teach available actions,
- longer help is available on demand without leaving the scene,
- shortcut icons change based on desktop versus VR mode.

This issue is an implementation guide for a future LLM/developer pass. It
should not be solved by ad hoc prompt string edits alone. The fix needs a small
shared UI vocabulary, structured action metadata, and consistent rendering of
menus, messages, tooltips, and help.

## Why This Matters

The target users are students exploring geometry, not the people who built the
tool. The interaction model must support curiosity without requiring the
student to memorize hidden controls.

The app already has powerful functionality:

- placing signs,
- firing and extending geodesics,
- carrying, rotating, and aiming geodesic emitters,
- measuring lengths,
- measuring angles,
- editing signs,
- changing torus skew from the geometry computer,
- moving between desktop and immersive VR.

The problem is that prompts and bindings currently teach inconsistent ideas.
For example, a geodesic emitter advertises `LMouse / F - menu` on desktop, while
the desired rule is that left click should remain the primary world action and
right click should always mean tools/menu/context. VR prompts also currently use
`A / X` language for complex object interaction in some places, but this issue
standardizes the VR context/menu action on the side trigger or grip-style
control.

## Relationship To Existing Issues

This issue builds on:

- [19_fps_dom_palette_menu.md](./19_fps_dom_palette_menu.md)
- [20_vr_palette_menu_from_shared_definition.md](../20_vr_palette_menu_from_shared_definition.md)
- [27_common_in_scene_palette_aimer_interaction.md](./27_common_in_scene_palette_aimer_interaction.md)

This issue supersedes the prompt guidance in issue 27 where it says complex
object interaction should be advertised as `A / X` in VR. The new standard is:

- desktop context/menu: right click, with `F` as an optional keyboard fallback,
- VR context/menu: side trigger or grip-style context control,
- desktop primary action: left click,
- VR primary action: trigger/select.

Do not silently keep `A / X` as the main taught VR menu action unless headset
testing proves the side trigger is not available on the target hardware. If a
fallback remains, it should be treated as an expert fallback or device-specific
fallback, not the universal student-facing grammar.

## Current Code To Study

Start with these files:

- `src/render/three/createThreeApp.ts`
- `src/render/three/desktopControls.ts`
- `src/render/three/xrControls.ts`
- `src/render/three/xrScenePaletteInput.ts`
- `src/render/three/scenePaletteInput.ts`
- `src/render/three/scenePaletteController.ts`
- `src/render/three/vrPaletteLibraryAdapter.ts`
- `src/render/dom/floatingObjectTooltip.ts`
- `src/render/dom/desktopToolIndicator.ts`
- `src/runtime/runtimeMenuState.ts`
- `src/ui/paletteDefinition.ts`
- `src/world-objects/runtimeObjectRegistry.ts`
- `src/world-objects/geodesicCannon.ts`
- `src/world-objects/placedFlags.ts`
- `src/world-objects/measureLengthTool.ts`
- `src/world-objects/protractorTool.ts`
- `src/render/three/measureLengthRenderer.ts`
- `src/render/three/protractorAngleRenderer.ts`
- `src/render/three/xrControllerHandModels.ts`
- `src/style.css`

Relevant existing assets:

- `/assets/icons/left-click-icon.png`
- `/assets/icons/right-click-icon.png`
- `/assets/icons/f-alphabet-round-icon.png`
- `/assets/icons/h-alphabet-round-icon.png`
- `/assets/icons/a-alphabet-round-icon.png`
- `/assets/icons/b-alphabet-round-icon.png`
- `/assets/icons/x-alphabet-round-icon.png`
- `/assets/icons/y-alphabet-round-icon.png`
- `/assets/icons/arrow-circle-inverted.png`
- `/assets/icons/aim-inverted.png`
- `/assets/icons/carry-icon.png`
- `/assets/icons/carry-icon-white.png`
- `/assets/icons/Ruler.png`
- `/assets/icons/protractor.png`
- `/assets/icons/add.png`
- `/assets/icons/trash.png`
- `/assets/icons/lock.png`

Missing or ambiguous asset:

- a generic VR trigger/select icon,
- a generic VR side-trigger/grip/context icon.

If these do not exist when implementing this issue, add them under
`public/assets/icons/` with license notes, or use a clearly named temporary text
chip until the asset exists.

## Current Findings

### Shared Menu Is Partially In Place

The app already has shared menu state and definitions:

- `RuntimeMenuState` tracks pages and selected tools,
- `PaletteDefinition` describes shared page content,
- `scenePaletteController` can operate an in-scene palette,
- desktop and XR input adapters feed scene palette pointer data.

This is the right direction. Do not go back to separate desktop-only and VR-only
menu behavior.

### Prompts Are String-Based

World objects currently store text such as:

```text
Geodesic emitter
LMouse / F - menu
RMouse - cycle
```

or:

```text
Sign
LMouse / F - edit
```

These strings encode interaction policy directly inside object creation files.
That makes it hard to change the interaction grammar uniformly and hard to show
icons instead of raw text.

### Right Click Has Too Many Jobs

Desktop right click currently opens the palette, but in one path it can also
cycle focused aim targets if the tooltip text contains `cycle`.

That behavior is too hidden and conflicts with the desired invariant:

```text
Right click means tools/menu/context.
```

Target cycling should be moved to a separate advanced input, a help-visible
secondary action, or replaced by better focus disambiguation.

### VR Button Meanings Conflict

The current VR code maps:

- trigger/select to primary actions and palette select,
- some side/menu-style button data to palette toggle,
- `A / X` style button language to object interaction,
- right-side button index 1 to carry action in `xrControls`.

For students, this should become:

```text
Trigger/select does primary actions.
Side trigger/context opens tools or object menu.
Carry is an action chosen from the emitter menu, with optional expert shortcut.
```

### Measurement Labels Are Persistent Result Badges

Length and angle labels are rendered as world-attached canvas-texture badges in:

- `measureLengthRenderer.ts`,
- `protractorAngleRenderer.ts`.

These are not hover tooltips. They are persistent result labels and should use a
separate standardized component.

### Hover/Focus Messages Are Ephemeral

The desktop `floatingObjectTooltip` and XR object billboard tooltip are
ephemeral aim/focus prompts. These should be generated from structured action
metadata and input mode, not hand-authored per object as desktop/VR text.

## Interaction Grammar

Define these intents and keep them stable.

| Intent | Desktop | VR | Meaning |
|---|---|---|---|
| `primary` | left click | trigger/select | Use active tool, select menu item, or perform direct simple action |
| `context-menu` | right click | side trigger/grip-style context control | Open global tools menu or focused object menu |
| `keyboard-context-fallback` | `F` | optional fallback only | Alternative for desktop/context or device-specific VR fallback |
| `help` | `H` | chosen face button, preferably `B` or `Y` | Show context-aware help lens |
| `next-focus-target` | mouse wheel or `Tab` | the other face button not assigned to help | Step to the next overlapping aim target |
| `cancel` | `Esc` | context/menu button or close button | Back, close, or cancel selected tool |
| `reset` | `R` | thumbstick click | Reset player/world according to existing behavior |
| `cycle-focus-target` | mouse wheel or `Tab` | `next-focus-target`, or context disambiguation panel | Rotate through overlapping aim targets without firing an action |

Rules:

- Left click and VR trigger/select must not be advertised as menu openers.
- Right click and VR side trigger/context must always open menus or context
  choices.
- If a menu is open, primary/select activates menu items and must not fire world
  actions.
- If no menu is open, primary/select performs the selected world tool action.
- If a focus target has a context menu, context-menu opens that object page.
- If there is no focus target, context-menu opens the main tools palette.
- `F` may stay as a desktop fallback for context action, but prompts should show
  right click first.
- Carry should be discoverable from the geodesic emitter context menu before any
  shortcut is taught.
- Thumbsticks are reserved for movement and view/visual rotation. Do not assign
  focus-target cycling to the right thumbstick.
- Of the two spare face buttons, assign one to the help lens and the other to
  stepping through overlapping focus targets. The exact labels, for example
  `B` versus `Y`, should be set after headset testing and kept in
  `inputIntents.ts`.
- Cycling the focused target is only for disambiguation when multiple aim
  targets overlap. It must not be treated as a primary action or context/menu
  action.

## Target Disambiguation And Rotating Selection

Some scenes can put several valid targets under the aimer at once:

- a geodesic emitter body and one of its geodesic handles,
- several geodesics meeting at a vertex,
- a measured label overlapping the geodesic it measures,
- a sign or geometry computer close to another selectable object,
- portal-visible instances of nearby objects.

This needs a separate focus-disambiguation interaction. It should rotate the
current focus highlight only; it must not fire a tool action and must not open a
menu by itself.

Desktop standard:

- mouse wheel cycles the focused target when there are multiple candidates,
- `Tab` may be a keyboard fallback,
- right click remains context/menu and is never target cycling.

VR standard:

- do not use the right thumbstick; it is reserved for view/visual rotation,
- do not use the left thumbstick; it is reserved for locomotion,
- reserve one spare face button for the help lens,
- use the other spare face button for `next-focus-target`,
- prefer a context disambiguation panel when the side trigger/context control is
  pressed while multiple targets are under the aimer,
- if the hardware has no reliable spare face button, fall back to the context
  disambiguation panel only.

Prompting:

- when multiple targets are available, show a compact focus message indicator
  such as `1/3 targets`,
- desktop can show the mouse-wheel or `Tab` hint,
- VR should show the `next-focus-target` face-button hint when available,
- VR should show `Open choices` if the context disambiguation panel is the
  fallback design,
- the help lens should list the available targets in the same order the cycle or
  choice panel uses.

Implementation:

- keep an ordered list of current aim target candidates,
- keep a focus index keyed by a stable target signature,
- reset the focus index when the candidate signature changes,
- expose target count and focused index to the focus message renderer,
- do not parse tooltip text such as `cycle` to decide whether cycling exists.

## Standard UI Primitives

Implement four UI primitives and name them consistently.

### 1. Scene Palette

Purpose:

- global tool menu,
- object context menu,
- settings and debug pages,
- sign editor,
- geodesic emitter actions,
- geometry computer controls.

Menu scopes:

- `global-tools`: the default tool palette opened when no world object is
  focused,
- `settings`: global settings/debug/world selection pages,
- `object-context`: a focused object's action menu, such as sign editing,
  geodesic emitter actions, or geometry computer controls.

Open behavior:

- desktop right click opens it,
- VR side trigger/context opens it,
- if the user is aiming at an object with context actions, open the object page,
- otherwise open the main tool palette.

Selection behavior:

- desktop left click selects palette items,
- VR trigger/select selects palette items,
- selection input must not leak to world actions while the palette is open.

Rendering:

- use the common in-scene palette path,
- do not add palette panels to runtime object registry,
- do not portal-render palette panels,
- do not fork content between desktop and VR.

Chrome rules:

- home and reload are global navigation controls,
- show home and reload only on the default `global-tools` menu,
- do not show home or reload on object-specific menus,
- object-specific menus should show only the controls needed to leave that
  object flow, usually close and optionally back,
- settings may expose world/reload controls inside settings content if that page
  is explicitly reached from the global menu,
- destructive object actions, such as deleting a sign or geodesic, belong inside
  the object menu content, not in global chrome.

Prompting:

- palette buttons should use icon-first controls where possible,
- unfamiliar icons should have hover/focus tooltips,
- no visible explanatory paragraphs in the palette.

### 2. World Result Badge

Purpose:

- persistent mathematical result labels,
- examples: measured length, measured angle.

Current examples:

- `measured-geodesic-length-floating-tooltip`,
- `protractor-angle-floating-tooltip`.

Rename conceptually to `WorldResultBadge`; old object names can be updated in a
separate cleanup if tests make renaming costly.

Requirements:

- attached to the measured object or result geometry,
- visible until the result is removed,
- portal-rendered only when the underlying result object is portal-rendered,
- double-faced when appropriate,
- readable in desktop and VR,
- never used for transient hover prompts.

Recommended helper:

```text
src/render/three/worldResultBadge.ts
```

Suggested API:

```ts
export type WorldResultBadgeVariant = "length" | "angle" | "success" | "warning";

export interface WorldResultBadgeOptions {
  readonly text: string;
  readonly variant: WorldResultBadgeVariant;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly pointer?: "down" | "none";
  readonly doubleFaced?: boolean;
  readonly renderOrder?: number;
}

export function createWorldResultBadge(options: WorldResultBadgeOptions): THREE.Object3D;
```

Migrate `measureLengthRenderer.ts` and `protractorAngleRenderer.ts` to use it.

### 3. UI Hover Tooltip

Purpose:

- short hover/focus labels for menu buttons and icons,
- examples: `Close`, `Back`, `Delete geodesic`, `Rotate`, `Aim`.

Requirements:

- brief, one or two lines maximum,
- may show shortcut icons when useful,
- appears on hover/focus,
- disappears quickly when the pointer leaves,
- rendered in DOM only for DOM-only fallback paths,
- rendered in scene UI for the common scene palette.

This is not the same as the world focus message.

### 4. World Focus Message

Purpose:

- ephemeral aim-driven prompt when the user is looking at a world object,
- tells what the object is and what can be done now.

Desktop placement:

- near the reticle,
- clamped inside viewport,
- no pointer interaction.

VR placement:

- a small billboard near the focused world target,
- faces the camera,
- no collision,
- not added to runtime object registry,
- not portal-rendered independently of the focused object.

Content:

```text
Object name
[shortcut icon(s)] Action label
```

Examples:

```text
Sign
[right-click] [F] Edit
```

```text
Geodesic emitter
[right-click] Emitter menu
```

```text
Geodesic G1
[left-click] Extend
```

```text
G1 length = 5 m
[left-click] Remove
```

Rules:

- generated from structured action descriptors,
- never hard-coded as a full prompt string on an object,
- swaps icons and labels by input mode,
- hides while the palette or sign editor is open,
- chooses only the actions that are available now.

## Context-Aware Help Lens

Add a longer help surface for students who are unsure what they are aiming at.

Open behavior:

- desktop: `H`,
- VR: a chosen face button, preferably `B` or `Y` after headset testing,
- hold to peek, tap to pin if feasible,
- pinned help can be scrollable,
- closes with the same help button, cancel, or context close.

Placement:

- desktop: compact panel near reticle or side of viewport,
- VR: head-relative or wrist-relative panel, not portal-rendered.

Content should be context-aware:

- name of focused object,
- one sentence about what it is,
- available primary action,
- available context/menu action,
- current selected tool and next step,
- measurement interpretation if looking at a result,
- unavailable actions with a short reason when helpful.

Examples:

For a geodesic emitter:

```text
Geodesic emitter
Creates and edits geodesic rays from this point.
Primary: add or extend a ray when the ray tool is active.
Menu: add, rotate, aim, carry, tie/detach, or delete geodesics.
```

For an open geodesic segment:

```text
Geodesic G1
A locally straight ray segment. It may continue through portals.
Primary: extend this geodesic.
Tools: length measures total geodesic length; protractor selects sides at a vertex.
```

For a sign:

```text
Sign
A placed note in the world.
Menu: edit text or delete the sign.
```

Do not put this explanatory copy directly in the always-visible hover prompt.
The hover prompt should stay light.

## Structured Action Metadata

Replace raw prompt strings with structured metadata.

Recommended file:

```text
src/ui/inputIntents.ts
```

Suggested types:

```ts
export type InputMode = "desktop" | "xr";

export type InputIntent =
  | "primary"
  | "context-menu"
  | "keyboard-context-fallback"
  | "help"
  | "cancel"
  | "reset";

export interface InputHintGlyph {
  readonly intent: InputIntent;
  readonly mode: InputMode;
  readonly label: string;
  readonly iconSrc?: string;
}
```

Recommended file:

```text
src/ui/worldInteractionDefinition.ts
```

Suggested types:

```ts
export type WorldInteractionActionId =
  | "open-object-menu"
  | "edit-sign"
  | "open-geometry-computer"
  | "extend-geodesic"
  | "remove-measurement"
  | "remove-angle"
  | "add-geodesic"
  | "carry-emitter"
  | "rotate-geodesic"
  | "aim-geodesic"
  | "tie-detach-geodesics"
  | "delete-geodesic";

export interface WorldInteractionAction {
  readonly id: WorldInteractionActionId;
  readonly label: string;
  readonly intent: InputIntent;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly priority?: number;
}

export interface WorldFocusMessageDefinition {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions: readonly WorldInteractionAction[];
  readonly helpTopicId?: string;
}
```

Do not make renderers infer semantics from strings such as `cycle`, `menu`, or
`edit`. Renderers should consume the structured definition.

## Input Hint Glyphs

Add one source of truth that maps intents to icon/text by mode.

Recommended mapping:

Desktop:

- `primary`: `/assets/icons/left-click-icon.png`, label `Left click`
- `context-menu`: `/assets/icons/right-click-icon.png`, label `Right click`
- `keyboard-context-fallback`: `/assets/icons/f-alphabet-round-icon.png`, label `F`
- `help`: `/assets/icons/h-alphabet-round-icon.png`, label `H`
- `cancel`: text `Esc` unless an icon is added
- `reset`: text `R` unless an icon is added

VR:

- `primary`: new trigger icon, label `Trigger`
- `context-menu`: new side trigger/grip icon, label `Side trigger`
- `help`: one of `/assets/icons/b-alphabet-round-icon.png` or
  `/assets/icons/y-alphabet-round-icon.png`, label based on tested device
- `next-focus-target`: the other face-button icon not assigned to `help`
- `cancel`: side trigger/grip while menu is open, or close icon
- `reset`: text `Stick press` unless an icon is added

If existing letter icons are used as VR fallback hints, avoid presenting them as
the universal standard unless they are actually the target headset controls.
Keep the help and next-focus-target button assignment centralized so it can be
swapped for a different headset without rewriting object prompts.

## Required Behavior By Object

### No Focus Target

Context/menu:

- desktop right click opens main tools palette,
- VR side trigger/context opens main tools palette.

Primary:

- left click/trigger uses selected tool against floor or world target if a tool
  is active,
- no prompt needed when no action exists.

Help:

- show current movement/tool basics and selected tool next step.

### Sign

Focus message:

```text
Sign
[context-menu] Edit
```

Primary:

- do not advertise left click/trigger as edit.

Context menu:

- opens sign editor page.
- does not show home or reload buttons.
- shows close, and optionally back if the editor is reached from a sign actions
  submenu.

Help:

- explain it is a placed note and can be edited or deleted.

### Geometry Computer

Focus message:

```text
Geometry computer
[context-menu] Torus skew
```

Context menu:

- opens torus skew actions.
- does not show home or reload buttons.

Primary:

- do not advertise left click/trigger as the menu opener.

### Geodesic Emitter

Focus message:

```text
Geodesic emitter
[context-menu] Emitter menu
```

Context menu:

- opens emitter actions: add, carry, rotate, aim, tie/detach, delete rows.
- does not show home or reload buttons.

Primary:

- only advertise a primary action when the selected tool makes it meaningful.
  For example, with ray tool active, primary can add or extend a geodesic.

Target cycling:

- do not bind right click to cycle.
- if cycling is still needed for overlapping geodesic handles, move it to a
  separate `cycle-focus-target` action or context disambiguation panel.
- do not bind cycling to the right thumbstick in VR because that control is
  reserved for view/visual rotation.

Carry:

- menu action first,
- optional desktop `G` expert shortcut can remain if not shown as the main path,
- VR side trigger should not also be carry if it is the standardized context
  menu input.

### Geodesic Segment

Open segment focus message:

```text
Geodesic G1
[primary] Extend
```

Connected or locked segment:

```text
Geodesic G1
Locked
```

Measurement tool selected:

```text
Geodesic G1
[primary] Measure length
```

Protractor tool selected:

```text
Geodesic G1
[primary] Select side
```

### Geodesic Intersection Or Vertex

Focus message:

```text
Vertex
[primary] Select for protractor
```

Only show the primary selection when the protractor tool is active or when the
selection can actually do something.

### Measured Length

Persistent result badge:

```text
G1 length = 5 m
```

Focus message:

```text
G1 length = 5 m
[primary] Remove
```

### Protractor Angle

Persistent result badge:

```text
G1 angle G2 = 90 deg
```

Use the existing mathematical angle symbol only if the file already handles that
encoding cleanly. Otherwise prefer ASCII-safe text in new docs and generated
test fixtures.

Focus message:

```text
G1 angle G2 = 90 deg
[primary] Remove
```

### Creatures

Focus message:

```text
Geodesic mouse
```

or:

```text
Geodesic butterfly
```

No action row unless an action exists.

Help:

- short description only.

## Implementation Plan

### Phase 1 - Add Input Intent Definitions

Add:

- `src/ui/inputIntents.ts`
- `tests/ui/inputIntents.test.ts`

Implement:

- `InputMode`,
- `InputIntent`,
- `getInputHintGlyph(mode, intent)`,
- icon paths for existing desktop icons,
- placeholder labels for missing VR icons.

Tests:

- desktop primary resolves to left-click icon,
- desktop context resolves to right-click icon,
- desktop help resolves to `H` icon,
- VR primary does not resolve to left-click icon,
- VR context does not resolve to right-click icon,
- missing VR icon fallback returns stable text.

### Phase 2 - Add World Interaction Definitions

Add:

- `src/ui/worldInteractionDefinition.ts`
- `tests/ui/worldInteractionDefinition.test.ts`

Implement helpers such as:

```ts
createWorldFocusMessageDefinition(options)
formatWorldFocusMessageTextForLegacyFallback(...)
```

The helper should accept:

- focused runtime object,
- input mode,
- selected tool,
- target metadata such as selected geodesic handle,
- availability predicates.

Do not put Three.js, DOM, or WebXR types in this module.

Tests:

- sign emits context edit action,
- emitter emits context menu action,
- open geodesic segment emits primary extend action when appropriate,
- measurement emits primary remove action,
- protractor angle emits primary remove action,
- connected geodesic does not emit extend,
- desktop action hints include right click for context,
- VR action hints include side trigger/context for context.

### Phase 3 - Update Runtime Object Metadata

Extend `RuntimeObjectTooltip` or introduce a sibling property. Prefer a sibling
property if it avoids mixing display text with interaction logic:

```ts
export interface RuntimeObjectUiMetadata {
  readonly title: string;
  readonly helpTopicId?: string;
}
```

Keep existing `tooltip` temporarily for range and backwards compatibility, but
stop treating `desktopPrompt` and `xrPrompt` as the source of truth.

Migration targets:

- `geodesicCannon.ts`
- `placedFlags.ts`
- `measureLengthTool.ts`
- `protractorTool.ts`
- `runtimeObjectRegistry.ts`
- `simpleGeoCreature.ts`
- `geodesciMarmot.ts`

Tests should be updated so they assert structured action metadata or generated
focus message definitions rather than hard-coded prompt strings.

### Phase 4 - Replace Focus Message Rendering

Update `createThreeApp.ts`:

- replace `getRuntimeObjectTooltipText(...)` with a function that builds a
  `WorldFocusMessageDefinition`,
- render desktop focus messages through `floatingObjectTooltip` only as a
  presentation layer,
- render XR focus messages through the existing canvas billboard only as a
  presentation layer,
- remove `desktopTooltipHintRequestsAimCycle(...)` from the normal path,
- do not parse tooltip text to decide behavior.

Possible new render helper:

```text
src/render/three/worldFocusMessageRenderer.ts
```

Suggested responsibilities:

- convert a `WorldFocusMessageDefinition` and `InputMode` into text or a canvas,
- render shortcut icons where available,
- clamp desktop DOM placement,
- create/update XR billboard texture.

Keep behavior:

- hide focus message while palette or editor is open,
- use current aim target and interaction range logic.

### Phase 5 - Standardize Context/Menu Input

Update desktop:

- right click always opens context/global menu,
- `F` can open the same context path as fallback,
- remove right-click target cycling from `onDesktopMouseDown`,
- if target cycling remains, move it to mouse wheel or `Tab` and help text.

Update VR:

- create named button helpers for `primary`, `context-menu`, `help`, `reset`,
- create a named button helper for `next-focus-target`,
- stop describing button indices as `A / X` in tests if the desired action is
  side trigger/context,
- remove the conflict where right-side button 1 can be both menu toggle and
  carry,
- keep the right thumbstick reserved for view/visual rotation,
- route side trigger/context through the same object/global menu path as desktop
  right click.

Recommended test files to update:

- `tests/render-contract/desktopControls.test.ts`
- `tests/render-contract/xrControls.test.ts`
- `tests/render-contract/xrScenePaletteInput.test.ts`
- `tests/render-contract/desktopScenePaletteInput.test.ts`

### Phase 6 - Make Context Open Object Menus

Currently object menus open from `tryOpenFocusedObjectMenu(...)`, and global
palette opening is handled separately. Consolidate behavior:

```ts
function openContextMenuFromAim(ray?: RootAimRay): void {
  if (tryOpenFocusedObjectMenu(ray)) {
    return;
  }
  menuState = openRuntimeMenu(menuState);
  syncPalette();
}
```

Use this for:

- desktop right click,
- desktop `F`,
- VR side trigger/context.

When an object context menu opens:

- set menu scope to `object-context` or derive that scope from the page id,
- suppress global home and reload header buttons,
- keep close available,
- keep back available only where a submenu needs it,
- keep object-specific actions inside the content area.

When menu is already open:

- context/menu should close/back according to existing menu page rules,
- primary/select should activate items,
- world actions should not fire.

### Phase 7 - Add Help Lens

Add:

- `src/ui/helpLensDefinition.ts`
- `src/render/three/helpLensRenderer.ts` or equivalent scene UI helper,
- tests for generated help content.

The help lens should use the same structured world interaction metadata. It
should not duplicate object-specific logic.

Minimum version:

- press `H` on desktop to show help for focused object or selected tool,
- use a selected VR button for help after checking controller layout,
- show a scrollable or pageable panel if content exceeds available area,
- include icons or input labels based on input mode.

### Phase 8 - Standardize Persistent Result Badges

Add:

- `src/render/three/worldResultBadge.ts`
- `tests/render-contract/worldResultBadge.test.ts`

Migrate:

- `measureLengthRenderer.ts`
- `protractorAngleRenderer.ts`

Tests:

- length renderer uses shared badge helper,
- angle renderer uses shared badge helper,
- badge can be double-faced,
- badge disposes textures/materials,
- badge text fits for existing labels.

### Phase 9 - Update Palette Button Tooltips

Add short UI hover/focus tooltips for menu icon buttons:

- settings,
- close,
- back,
- home,
- reload,
- add geodesic,
- carry,
- rotate,
- aim,
- delete,
- lock status,
- sign type options.

Home and reload tooltip coverage is required only on the default global tools
menu and settings/global pages where those controls are visible. Do not add
hidden or disabled home/reload affordances to object-specific menus merely to
keep header layout identical.

In scene UI, use uikit-compatible hover/focus state if available. If the UI
library does not expose enough hover state, add stable `userData` item ids and
display a small scene tooltip from the palette controller.

Do not add long instructional text inside the palette.

### Phase 10 - Update Docs And Existing Prompt Tests

Search for outdated prompt strings:

```text
LMouse / F - menu
LMouse / F - edit
A / X - menu
A / X - edit
RMouse - cycle
Select - extend
```

Replace with structured tests and docs for the new grammar.

Update issue 27 references if necessary, or add notes in this issue saying the
new standard supersedes those lines.

## Detailed Acceptance Criteria

### Interaction

- Desktop right click always opens the global tool menu or focused object menu.
- VR side trigger/context always opens the global tool menu or focused object
  menu.
- Desktop left click is the primary action and is not advertised as a menu
  opener.
- VR trigger/select is the primary action and is not advertised as a menu opener.
- `F` can remain as desktop fallback for context/object menu.
- `H` opens a context-aware help lens on desktop.
- The chosen VR help button opens the same help lens in VR.
- The other spare VR face button, not assigned to help, steps through
  overlapping focus targets when multiple targets are available.
- Carry remains available from the geodesic emitter menu.
- VR side trigger/context is not also the carry shortcut in the student-facing
  standard.
- Right click is not used for target cycling in the normal student path.
- Right thumbstick is not used for target cycling because it is reserved for
  view/visual rotation.
- Multiple overlapping focus targets can be disambiguated without firing a world
  action.

### Menu

- The same scene palette handles desktop and VR.
- The palette is not added to runtime object registry.
- The palette is not cell-local.
- The palette is not portal-rendered.
- Home and reload appear on the default global tool menu.
- Home and reload do not appear on object-specific menus.
- Context opening a sign opens the sign editor.
- Context opening a geodesic emitter opens emitter actions.
- Context opening the geometry computer opens torus skew controls.
- Context with no focus target opens the main tools palette.
- Primary/select activates palette controls while the palette is open.

### World Focus Message

- Focus messages are generated from structured metadata.
- Focus messages use desktop icons in desktop mode.
- Focus messages use VR icons or VR labels in VR mode.
- Sign focus message advertises context edit, not primary edit.
- Geometry computer focus message advertises context torus-skew menu.
- Geodesic emitter focus message advertises context emitter menu.
- Open geodesic segment focus message advertises primary extend only when
  extend is available.
- Measured length focus message advertises primary remove.
- Protractor angle focus message advertises primary remove.
- Creatures show labels without fake actions.
- Focus messages hide while the palette is open.

### Help Lens

- Help content changes based on focused target.
- Help content changes based on selected tool.
- Help content is available in desktop and VR.
- Help uses the same input intent labels/icons as focus messages.
- Help can show more than one action without crowding the focus message.
- Help is not required to be visible by default.

### Persistent Result Badges

- Length labels and angle labels use a shared badge helper.
- Persistent badges remain visible until their result object is removed.
- Persistent badges are not confused with ephemeral hover/focus messages.
- Badges are readable in desktop and VR.
- Badge rendering disposes textures and materials correctly.

### Tests

- Existing movement, collision, portal, palette, and runtime object tests pass.
- New tests cover input intent glyph mapping.
- New tests cover world focus message definitions.
- New tests cover desktop context opening.
- New tests cover VR context opening.
- New tests prevent reintroducing `LMouse / F - menu`.
- New tests prevent reintroducing `A / X - menu` as the universal VR context
  prompt.
- New tests verify no focus behavior depends on parsing tooltip text.

## Non-Goals

- Do not implement new geometry algorithms.
- Do not add new mathematical tools.
- Do not redesign world authoring.
- Do not migrate to React or React Three Fiber.
- Do not make menu panels runtime world objects.
- Do not portal-render menus or help panels.
- Do not remove desktop fallback controls that are useful for developers unless
  they confuse the student-facing UI.
- Do not add long tutorials to the always-visible UI.
- Do not solve target ambiguity by overloading right click.

## LLM Implementation Notes

Preserve the student-facing invariant above all:

```text
Left click / trigger does the primary thing.
Right click / side trigger opens choices.
Help explains what you are looking at.
```

When updating code:

- prefer structured action metadata over prompt strings,
- keep input-mode differences in one input hint module,
- keep semantic definitions free of DOM, Three.js, and WebXR types,
- keep rendering helpers presentation-only,
- update tests before deleting old fallback prompt fields,
- do not expand `createThreeApp.ts` with large new UI systems if a helper module
  can own the concept,
- preserve existing working behavior until the replacement is covered by tests.

If a current test expects a raw prompt string, decide whether it should become:

- an input intent test,
- a focus message definition test,
- a rendering snapshot/contract test,
- or a temporary backwards-compatibility test.

Do not simply change the string from `LMouse / F` to `RMouse / F` everywhere and
call the issue complete. That would fix the surface text while leaving the same
fragile string-based interaction model underneath.
