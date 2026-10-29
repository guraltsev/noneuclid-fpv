# Job 05 - Conjugate a loop's portal word when its shared anchor crosses a portal

Status: done on 2026-10-29.
Resolves: issue [68](../../../_issues/_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md).

## Goal

When one anchor holds both ends of one interval (a same-emitter locked loop, or a free loop in curve shortening) and
that anchor crosses portal `p`, the interval's portal word `w` must become `reduce(p⁻¹ · w · p)`. Today the code
updates only one end, so the loop silently changes homotopy class, or is deleted. Also make `liftGeodesicEndpoint`
refuse a word that does not chain between the anchors' cells, and reduce words when an interval is created.

## Depends on

Nothing. Job 06 depends on this job; it reuses the test world `compileRotatedFreeLoopWorld` that this job adds.

## Before you start

Line numbers are for commit `e094b82`. They may drift a little; search for the function name if a line does not match.

Read:

- `src/world-objects/geodesicCannon.ts`
  - `:1-67`: the module header. Lines 36-52 describe carrying and curve shortening.
  - `:135-140`: `GeodesicPortalTraversal` (four ids: `sourceCellId`, `sourcePortalId`, `targetCellId`, `targetPortalId`).
  - `:726-760`: `createGeodesicIntervalObject`.
  - `:895-1011`: `reverseGeodesicPortalWord`, `liftGeodesicEndpoint` and `liftGeodesicEndpointWithAnchors`.
  - `:1700-1750`: `rebuildDerivedGeodesicSegments`. It deletes the interval when the chord is too short, and fails
    when the traced word differs from the stored word.
  - `:2010-2183`: `rebuildLockedGeodesicFromEndpointsAndPortalWord`,
    `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`, `getPortalWordBetweenEndpointRoles`,
    `updatePortalWordForMovedEndpoint`, `updatePortalWordForMovedEndpointWithAnchors`.
  - `:2301-2357`: `resolveCarriedIntervalPortalWord`.
  - `:2359-2410`: `resolveCarriedPortalTraversalFromAnchorMotion`. For a portal that leads back into the same cell
    (the torus), it accepts a crossing only when the old point, mapped through the portal, lands within 0.3 m of the
    new point.
  - `:2467-2526`: `portalWordMatchesCurrentEndpointCells`, `portalWordMatchesEndpointCellsWithAnchors`,
    `reduceAdjacentInversePortalTraversals`, `portalTraversalsAreInverse`.
  - `:3133-3170`: `rebuildConnectedGeodesicBetweenEmitters`, the interval branch. When the rebuild fails, it deletes the
    geodesic, unless `preserveGeodesicOnRebuildFailure` is set.
  - `:3599-3890`: `advanceCurveShorteningPairs`. The site to change is `:3743-3783`.
- `src/render/three/geodesicCannonTools.ts:860-990`: how the app carries an emitter. Read only; you do not change this
  file. `updateCarriedGeodesicPortalWord` (`:924`) calls `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`.
  The rebuild then receives the stored word as `carriedPortalWord`.
- `tests/world-objects/geodesicCannon.test.ts`
  - `:1-53`: imports.
  - `:1044-1092`: a torus carry test that infers the crossing from the emitter's motion.
  - `:1187-1228`: a carry test that uses `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`.
  - `:1688-1735`: a same-emitter loop on the torus.
  - `:2025-2073`: a free-loop pair built by hand.
  - `:2150-2216`: a curve-shortening free end that crosses a portal.
  - `:2918-2921`: `totalGeodesicLength`.
  - `:2982-2998`: `createCarryPortalTraversal`.
  - `:3000-3111`: the world fixtures, among them `compileLargePortalWorld` and `compileTorusLoopWorld`.
- `_docs/MATHEMATICAL_MODEL.md`: §6 "Geodesics" (lines 188-232) and §11 "Assumptions and known gaps", the
  "Curve shortening" bullet (lines 397-401).

Baseline, in Windows Git Bash from the repository root:

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. If they do not, write the failures under `### Checks` in the Report and
continue, unless the failures are in `tests/world-objects/geodesicCannon.test.ts`; in that case, also record it under
`### Uncertain`. To run one file: `npx vitest run tests/world-objects/geodesicCannon.test.ts`.

## Background

### Words, inverses and reduction in this code

A portal word is an array of `GeodesicPortalTraversal`, read from the interval's `start` anchor to its `end` anchor.
One traversal means "leave cell `sourceCellId` through portal `sourcePortalId`, arrive in cell `targetCellId` through
portal `targetPortalId`".

- The **inverse** of a traversal swaps source and target. The code has no single-traversal helper; it uses
  `reverseGeodesicPortalWord([t])[0]` (`geodesicCannon.ts:901-910`). This function reverses a whole word and swaps
  every traversal.
- **Reduction** (`reduceAdjacentInversePortalTraversals`, `:2503-2516`) deletes every adjacent pair "t, then the
  inverse of t", using a stack. `portalTraversalsAreInverse` (`:2518-2526`) is the test.
- A word is **consistent** with an interval (`portalWordMatchesEndpointCellsWithAnchors`, `:2477-2499`) when it starts
  in the start anchor's cell, ends in the end anchor's cell, and each target cell is the next source cell. The empty
  word needs both anchors in one cell.

On the test torus (`compileTorusLoopWorld`, `tests/world-objects/geodesicCannon.test.ts:3090-3111`) there is one cell,
`torus-room`, the square [-7.5, 7.5]². Its portal ids are:

| name | traversal (`sourcePortalId` -> `targetPortalId`) | meaning |
| --- | --- | --- |
| `px` | `right-left` -> `left-right` | leave through the right side x = 7.5, enter at x = -7.5 |
| `py` | `top-bottom` -> `bottom-top` | leave through the top side y = 7.5, enter at y = -7.5 |
| `py⁻¹` | `bottom-top` -> `top-bottom` | leave through the bottom side y = -7.5, enter at y = 7.5 |

All cell ids are `torus-room`.

### Why the new word is p⁻¹ · w · p

An interval is a path from the start anchor to the end anchor. Its word records the order in which the path crosses
portals. Vertices are excluded (junction cylinders of radius 0.15 m,
`src/cell-complex/forbiddenZones.ts#forbiddenPortalJunctionRadiusMeters`), so two paths with the same ends are
homotopic exactly when their freely reduced words are equal.

- Move only the `end` anchor across `p`. The new path is the old path followed by the short step across `p`, so the
  word becomes `w · p` (append).
- Move only the `start` anchor across `p`. The new path first steps back across `p`, then follows the old path, so the
  word becomes `p⁻¹ · w` (prepend the inverse).
- Move **both** ends at once, because both are attached to the same anchor. Both rules apply, and the word becomes
  `p⁻¹ · w · p`. This is conjugation: the same loop, read from the new base point.

Worked example (torus, issue 68). An emitter E at (0, 6) holds a loop with `w = [py, px]` (up, then right). The lift
is E + (15, 15), so the loop has length 15·√2 = 21.213203 m. Carry E up through the top side; it arrives at
(0, -7.4), so `p = py`.

- Correct: `[py⁻¹] + [py, px] + [py] = [py⁻¹, py, px, py]`. Reduction removes `py⁻¹, py` and leaves `[px, py]`. This is
  the same closed geodesic read from the new point, still 21.213203 m long.
- Today: `w` has an `end` on E, so the code takes the append branch and returns `[py, px, py]`. That is holonomy
  (15, 30), a chord of length 33.54 m, a different homotopy class.

A second example. A horizontal loop `w = [px]` carried across `py` becomes `[py⁻¹, px, py]`. The straight chord from
the new point to its lift (translation (15, 0)) crosses only `px`. So the stored word cannot be realized by a straight
line, and the rebuild must **fail**. It must not turn the loop into a diagonal loop.

### Current behaviour (measured)

A scratch test run on commit `e094b82` gave these results:

| scenario | today | after this job |
| --- | --- | --- |
| torus loop `[py, px]` at E (0, 6) -> E (0, -7.4), word updated with `updateLockedGeodesicPortalWordForCarriedAnchorTraversal(py)` | returns `[top-bottom, right-left, top-bottom]`; the rebuild then deletes the loop (the 33.5 m chord passes 0.05 m from a corner and hits the junction cylinder) | returns `[right-left, top-bottom]`; the loop is rebuilt, 3 segments, length 21.213203, last terminal `emitter-hit` |
| the same loop, E at (0, 7.4) -> (0, -7.4), crossing inferred by `rebuildConnectedGeodesicBetweenEmitters({ carriedEmitterId, carriedEmitterBeforeMove })` | loop deleted | word `[right-left, top-bottom]`, length 21.213203 |
| torus loop `[px]` at (0, 6) -> (0, -7.4), traversal `py` | returns `[right-left, top-bottom]`; the loop is **silently rebuilt as a diagonal loop of length 21.213203** | returns `[bottom-top, right-left, top-bottom]`; the rebuild fails, so `rebuildConnectedGeodesicBetweenEmitters` returns `[]` and deletes the loop |
| two-cell cylinder (see Tests), loop `[a:ab, b:b-right]` of length 10 at E (4.9, 2.5) in `a` -> E (0.1, 2.5) in `b` | `updateLocked...` returns `undefined` (the appended word starts in `a`); the loop is deleted | word `[b:b-right, a:ab]`, `startCellId` `b`, length 10 |
| free loop in curve shortening, rotated world (see Tests), one tick, `deltaSeconds = 1` | the pair, the loop and the free end are **all deleted** (the preview uses the stale word, and the forbidden-zone check then sees a chord in mixed frames) | the free end moves into `b` at (0.2925, 0.9230); word `[b:b-bottom]`; length 6.784145 (was 7.349830) |

The "after" column was measured on a patched copy of `geodesicCannon.ts` that applies exactly the Steps below. With
that copy, the full `npm test` suite (625 tests) still passed.

### The sites to change

1. `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`, `geodesicCannon.ts:2097-2107`. The `end` test comes
   first, so a loop takes the append branch only. The docstring at `:2081-2082` says so.

   ```ts
   let portalWord: readonly GeodesicPortalTraversal[] | undefined;
   if (interval.end.anchorObjectId === input.carriedAnchorObjectId) {
     portalWord = reduceAdjacentInversePortalTraversals([...interval.portalWord, input.traversal]);
   } else if (interval.start.anchorObjectId === input.carriedAnchorObjectId) {
     portalWord = reduceAdjacentInversePortalTraversals([
       reverseGeodesicPortalWord([input.traversal])[0],
       ...interval.portalWord,
     ]);
   }
   ```

2. `resolveCarriedIntervalPortalWord`, `:2339-2354`. It has the same ordering, with two `if` blocks that each
   `return`.
3. `updatePortalWordForMovedEndpoint` (exported, `:2144-2158`) and its private twin
   `updatePortalWordForMovedEndpointWithAnchors` (`:2162-2183`). Each takes one `movedRole`.
4. `advanceCurveShorteningPairs`, `:3750-3783`. It picks `movedRole = "start"` whenever the start is on the free end,
   so a free loop only gets the prepend. The `TODO(issue 68)` comment is at `:3753-3755`.
5. `liftGeodesicEndpoint` (`:925-966`) and `liftGeodesicEndpointWithAnchors` (`:970-1011`) never check that the word
   chains from the start anchor's cell to the end anchor's cell. A wrong word gives a chord in mixed frames.
6. `createGeodesicIntervalObject` (`:747`) stores `input.portalWord ?? []` as given.

Not a site: `geodesicCannonTools.ts:973-985` (`nextWord = [...currentWord, transition]`) is the legacy branch for
geodesics that are not intervals. Leave it alone.

## Decisions

1. **Decided:** add one private helper, `portalWordAfterAnchorCrossing`, and route sites 1-4 through it.
   **Why:** the rule "append if the end is on the anchor; prepend the inverse if the start is on the anchor; both if
   both" then lives in one place, and the two `if`s are not `else if`. **Alternative considered:** a special-case
   loop branch at each site.
2. **Decided:** keep the exported `updatePortalWordForMovedEndpoint` and its `movedRole` parameter, because
   `_docs/MATHEMATICAL_MODEL.md` §6 links to it. Implement it as "the anchor at `movedRole` crossed the portal", so a
   loop is conjugated even when only one role is named. Delete the private
   `updatePortalWordForMovedEndpointWithAnchors`; its only caller (site 4) is rewritten. **Why:** a role on a shared
   anchor never moves alone, and `noUnusedLocals` rejects an unused private function. **Alternative considered:**
   change the exported signature to take an anchor id.
3. **Decided:** add the chain check to both lift functions, using `portalWordMatchesEndpointCellsWithAnchors` on the
   stored word (start -> end), whatever `sourceRole` is. **Why:** a mismatched word should fail loudly, not draw a
   chord in mixed frames. With this check, a failed word update in curve shortening leaves the pair unchanged; today
   it deletes the pair. **Alternative considered:** check only in `rebuildDerivedGeodesicSegments`.
4. **Decided:** `createGeodesicIntervalObject` stores `reduceAdjacentInversePortalTraversals(input.portalWord ?? [])`.
   **Why:** a reduced word is the canonical key that `findEquivalentStableInterval` compares. **Alternative
   considered:** assert instead of reducing (an assert throws inside the frame loop).
5. **Decided:** when the conjugated word has no straight representative (the `[px]` example), the rebuild fails and
   the existing failure rules apply. `rebuildConnectedGeodesicBetweenEmitters` deletes the loop, or keeps the old
   segments when `preserveGeodesicOnRebuildFailure` is set (live carry). **Why:** this is the existing contract for a
   geodesic that cannot be realized; issue 68 asks for "a rebuild failure, not a diagonal loop".
   **Alternative considered:** keep the loop as a taut, non-straight path; that is job 26's model.
6. **Decided:** do not change `geodesicCannonTools.ts`. **Why:** it already calls site 1, and the rebuild uses the
   stored word.

## Steps

After each step, run `npx vitest run tests/world-objects/geodesicCannon.test.ts`. It must stay green.

### Step 1 - The helper

In `src/world-objects/geodesicCannon.ts`, directly above `reduceAdjacentInversePortalTraversals` (`:2501`), add:

```ts
// New portal word of `interval` after anchor `anchorObjectId` crossed a portal by `traversal`. The `end` role appends the
// traversal (the path gains one crossing at its end); the `start` role prepends its inverse (the path first steps back across
// the portal). When both roles sit on the anchor (a loop) both apply, which conjugates the word: w -> p^-1 w p. The result is
// freely reduced. Returns undefined when neither role is on the anchor. Does not check the cell chain; callers do.
function portalWordAfterAnchorCrossing(input: {
  readonly interval: GeodesicIntervalObject;
  readonly anchorObjectId: string;
  readonly traversal: GeodesicPortalTraversal;
}): readonly GeodesicPortalTraversal[] | undefined {
  const movesStart = input.interval.start.anchorObjectId === input.anchorObjectId;
  const movesEnd = input.interval.end.anchorObjectId === input.anchorObjectId;
  if (!movesStart && !movesEnd) {
    return undefined;
  }
  let word: readonly GeodesicPortalTraversal[] = input.interval.portalWord;
  if (movesEnd) {
    word = [...word, input.traversal];
  }
  if (movesStart) {
    word = [reverseGeodesicPortalWord([input.traversal])[0], ...word];
  }
  return reduceAdjacentInversePortalTraversals(word);
}
```

Both `if`s must stay plain `if`s, not `else if`.

### Step 2 - Carried emitter, explicit traversal (site 1)

In `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`, replace the block quoted in Background (site 1) with:

```ts
const portalWord = portalWordAfterAnchorCrossing({
  interval,
  anchorObjectId: input.carriedAnchorObjectId,
  traversal: input.traversal,
});
```

Keep the lines that follow it unchanged: the `portalWordMatchesCurrentEndpointCells` check, and the update of
`cellId`/`startCellId`. Replace the comment at `:2097-2098` with one line that refers to the helper. Rewrite the
docstring (`:2078-2085`) so that it says: "Appends the traversal when the carried anchor is the `end` anchor, and
prepends the inverse when it is the `start` anchor. A loop with both ends on the anchor gets both, which conjugates the
word (`p^-1 w p`). The result is freely reduced."

### Step 3 - Carried emitter, inferred traversal (site 2)

In `resolveCarriedIntervalPortalWord`, replace the two `if` blocks inside `if (input.carriedAnchorObjectId && carriedTraversal)`
(`:2343-2353`) with:

```ts
const word = portalWordAfterAnchorCrossing({
  interval: input.interval,
  anchorObjectId: input.carriedAnchorObjectId,
  traversal: carriedTraversal,
});
return word && portalWordMatchesCurrentEndpointCells(input.registry, input.interval, word) ? word : undefined;
```

Update the comment above the function (`:2301-2304`) in the same way as in Step 2.

### Step 4 - `updatePortalWordForMovedEndpoint` (site 3)

Replace the body of the exported `updatePortalWordForMovedEndpoint` with:

```ts
const word = portalWordAfterAnchorCrossing({
  interval: input.interval,
  anchorObjectId: input.interval[input.movedRole].anchorObjectId,
  traversal: input.traversal,
});
return word && portalWordMatchesCurrentEndpointCells(input.registry, input.interval, word) ? word : undefined;
```

Add this sentence to its docstring: "If the other role is on the same anchor (a loop), that role moves too and the word
is conjugated." Delete the private function `updatePortalWordForMovedEndpointWithAnchors`, together with its comment
(`:2160-2183`), but only after Step 5 has removed its only caller.

### Step 5 - Free loop in curve shortening (site 4)

In `advanceCurveShorteningPairs`, replace the whole `candidateIntervals` computation (`:3759-3783`) with:

```ts
const candidateIntervals = owned.intervals.map((interval) => {
  if (!traversal) {
    return interval;
  }
  const portalWord = portalWordAfterAnchorCrossing({ interval, anchorObjectId: pair.freeEndAnchorId, traversal });
  if (
    !portalWord ||
    !portalWordMatchesEndpointCellsWithAnchors({
      registry: request.registry,
      interval,
      word: portalWord,
      candidateAnchorsById: candidateAnchors,
    })
  ) {
    return interval;
  }
  const startMoved = interval.start.anchorObjectId === pair.freeEndAnchorId;
  return {
    ...interval,
    cellId: startMoved ? candidateFreeEnd.cellId : interval.cellId,
    startCellId: startMoved ? candidateFreeEnd.cellId : interval.startCellId,
    portalWord,
  };
});
```

Replace the comment block at `:3750-3755`, including the `TODO(issue 68)` line, with:

```ts
// If F crossed a portal during the move, F now lives in the neighbouring cell. Each arc's word changes by that traversal
// (`portalWordAfterAnchorCrossing`: append at an `end` role on F, prepend the inverse at a `start` role on F; a free loop has
// both roles on F and is conjugated). This is the only change of homotopy class a tick may make. Words that fail the
// cell-chain check are left unchanged (the preview then fails and nothing is committed).
```

Now delete `updatePortalWordForMovedEndpointWithAnchors` (Step 4). Run `npm run typecheck`; it must report no unused
function.

### Step 6 - Chain check in the lift functions (site 5)

In `liftGeodesicEndpoint`, directly after the `canObjectAttachGeodesics` check (`:936-938`), add:

```ts
if (!portalWordMatchesEndpointCellsWithAnchors({
  registry: input.registry,
  interval: input.interval,
  word: input.interval.portalWord,
})) {
  return undefined;
}
```

In `liftGeodesicEndpointWithAnchors`, add the same check after `:984-986`, and also pass
`candidateAnchorsById: input.candidateAnchorsById`. In the docstring of `liftGeodesicEndpoint` (`:921-922`), replace
"It does not check that the word chains between cells" with "Also returns `undefined` when the stored word does not
chain from the start anchor's cell to the end anchor's cell (`portalWordMatchesEndpointCellsWithAnchors`). It does not
check that the lifted chord is long enough."

Risky point: this check can make a caller fail that used to "work" with a stale word. Run the **whole** suite
(`npm test`) after this step. With the patched copy, nothing failed. If a test fails:

- If the test sets up a word that does not chain on purpose, keep the check. Change that test only if its assertion
  depends on drawing a mismatched word. Record each such test under `### Deviations`.
- Otherwise, keep the check, and record the test name and the failure under `### Uncertain`.
- If more than three tests fail and you cannot see why, revert this step only. Record it under `### Not done`.

### Step 7 - Reduce at creation (site 6)

In `createGeodesicIntervalObject`, change `portalWord: input.portalWord ?? [],` to
`portalWord: reduceAdjacentInversePortalTraversals(input.portalWord ?? []),`. Add to its docstring: "The word is
freely reduced (adjacent inverse traversals cancel)." The function is declared further down the file; it is a
function declaration, so it is hoisted.

### Step 8 - Module header and documentation

- `geodesicCannon.ts:36-38` ("carrying an emitter keeps the interval and updates its word by the portal the emitter
  crossed"): add "(both ends of a loop on that emitter move, so its word is conjugated: `w -> p^-1 w p`)".
- `geodesicCannon.ts:44-45`: replace "each arc's word is extended by that portal (`updatePortalWordForMovedEndpoint`)"
  with "each arc's word is updated by that portal (`portalWordAfterAnchorCrossing`; a free loop's word is
  conjugated)".
- `_docs/MATHEMATICAL_MODEL.md` §6, paragraph "Why words, not just positions": replace the sentence in parentheses
  with:
  "(`src/world-objects/geodesicCannon.ts#updatePortalWordForMovedEndpoint` appends the crossed portal p when the `end`
  anchor crosses it, prepends p⁻¹ when the `start` anchor crosses it, and does both when one anchor holds both ends of
  a loop. The loop's word then becomes the conjugate $p^{-1}wp$, the same loop read from the new base point. Words are
  always freely reduced.)"
- `_docs/MATHEMATICAL_MODEL.md` §11, bullet "Curve shortening": delete "a free loop crossing a portal probably stalls
  (only one of its two roles has its word updated);".
- Do not mention `portalWordAfterAnchorCrossing` in `_docs/*.md` with the `path#symbol` syntax; it is private.
  Mention it in plain backticks only.

## Tests and checks

Add all new tests to `tests/world-objects/geodesicCannon.test.ts`, in a new block
`describe("loop words under anchor portal crossings (job 05)", () => { ... })`. Place the block after the test
"detaches the two endpoint roles of a same-emitter loop into one curve-shortening free end" (`:1688`). Add
`liftGeodesicEndpoint` to the import list.

New fixtures go at the end of the file, next to `compileTorusLoopWorld`:

```ts
// Two 5 m cells glued into a 10 m cylinder: a's right side to b's left side, b's right side to a's left side.
function compileTwoCellCylinderWorld() {
  const square = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  return compileCellComplex({
    cells: [
      { id: "a", heightMeters: 3, baseVertices: square, portals: [
        { id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" },
        { id: "a-left", sideIndex: 3, targetCellId: "b", targetPortalId: "b-right" },
      ] },
      { id: "b", heightMeters: 3, baseVertices: square, portals: [
        { id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" },
        { id: "b-right", sideIndex: 1, targetCellId: "a", targetPortalId: "a-left" },
      ] },
    ],
  });
}

// Cell a's right side is glued to cell b's left side; b's bottom side is glued to b's own right side, which is a
// rotation by -90 degrees about b's corner (5, 0). A free loop around that corner has a kink, so it really moves.
function compileRotatedFreeLoopWorld() {
  const square = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  return compileCellComplex({
    cells: [
      { id: "a", heightMeters: 3, baseVertices: square, portals: [
        { id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" },
      ] },
      { id: "b", heightMeters: 3, baseVertices: square, portals: [
        { id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" },
        { id: "b-bottom", sideIndex: 0, targetCellId: "b", targetPortalId: "b-right" },
        { id: "b-right", sideIndex: 1, targetCellId: "b", targetPortalId: "b-bottom" },
      ] },
    ],
  });
}
```

Both worlds compile with the current `compileCellComplex`; this was checked. Build traversals with the existing helper
`createCarryPortalTraversal(world, cellId, portalId)` (`:2982`). Its parameter type is a union of two world types, but
every compiled world has the same type, so passing these worlds typechecks. Build emitters with
`createGeodesicCannonObject({ id, cellId, localPose: yawRigidTransform3(0, { x, y, z: 0 }) })`, and add each one with
`registry.add(...)`.

Use `toBeCloseTo(value, 6)` for lengths unless stated otherwise. `15 * Math.SQRT2` = 21.2132034.

1. `"conjugates a same-emitter torus loop when its emitter is carried across the top portal"`
   - World `compileTorusLoopWorld()`. Emitter `cannon-a` at (0, 6). Interval `g-loop` with both anchors `cannon-a`,
     `startCellId: "torus-room"`, word `[py, px]` =
     `[createCarryPortalTraversal(world, "torus-room", "top-bottom"), createCarryPortalTraversal(world, "torus-room", "right-left")]`.
   - `rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" })`. Expect
     `totalGeodesicLength(registry, "g-loop")` ≈ `15 * Math.SQRT2`.
   - `registry.update({ ...cannon, localPose: yawRigidTransform3(0, { x: 0, y: -7.4, z: 0 }) })`.
   - `updateLockedGeodesicPortalWordForCarriedAnchorTraversal({ registry, geodesicId: "g-loop", carriedAnchorObjectId: "cannon-a", traversal: py })`
     returns `[px, py]` (`toEqual`).
   - `rebuildConnectedGeodesicBetweenEmitters(...)` again returns 3 segments, and the last terminal is
     `{ kind: "emitter-hit", emitterId: "cannon-a" }`. `collectGeodesicPortalWord` gives `[px, py]`. The length is
     ≈ `15 * Math.SQRT2`.
2. `"conjugates a torus loop when the crossing is inferred from the emitter's motion"`
   - The same world and word, but the emitter starts at (0, 7.4). Keep the original object as `before`, rebuild, then
     update the emitter to (0, -7.4).
   - `rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop", carriedEmitterId: "cannon-a", carriedEmitterBeforeMove: before })`.
   - Expect `g-loop` to exist, its word to be `[px, py]`, and its length ≈ `15 * Math.SQRT2`. (Today the loop is
     deleted.)
3. `"fails to rebuild a horizontal torus loop carried across the perpendicular portal instead of making it diagonal"`
   - Emitter at (0, 6), word `[px]`. After the first rebuild, the length is 15.
   - Move the emitter to (0, -7.4). The `updateLocked...` call with `py` returns `[py⁻¹, px, py]`, that is
     `[createCarryPortalTraversal(world, "torus-room", "bottom-top"), px, py]`.
   - `rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" })` returns `[]`, and
     `registry.get("g-loop")` is `undefined`. (Today it returns segments of a 21.213203 m diagonal loop.)
4. `"keeps a same-emitter loop through a portal crossing in a two-cell world"`
   - World `compileTwoCellCylinderWorld()`. Emitter at (4.9, 2.5) in `a`. Word
     `[createCarryPortalTraversal(world, "a", "ab"), createCarryPortalTraversal(world, "b", "b-right")]`. After the
     first rebuild, the length is 10.
   - Run the test twice in a `for (const mode of ["explicit", "inferred"] as const)` loop, with a fresh registry each
     time. Move the emitter with `registry.update({ ...before, cellId: "b", localPose: yawRigidTransform3(0, { x: 0.1, y: 2.5, z: 0 }) })`.
     - `"explicit"`: call `updateLocked...` with the traversal `a:ab`; it returns
       `[b:b-right, a:ab]` (built with `createCarryPortalTraversal(world, "b", "b-right")` and `(world, "a", "ab")`).
       Then rebuild.
     - `"inferred"`: rebuild with `carriedEmitterId` and `carriedEmitterBeforeMove: before`.
   - In both modes, expect: the interval exists, `startCellId === "b"`, `cellId === "b"`, the word is
     `[b:b-right, a:ab]`, and the length is ≈ 10.
5. `"conjugates a free loop's word when curve shortening moves its free end through a portal"`
   - World `compileRotatedFreeLoopWorld()`.
   - Free end: `createFreeGeodesicEndObject({ id: "free-loop", cellId: "a", point: { x: 4.9, y: 1, z: geodesicRayBeamHeightMeters } })`.
   - Interval `g-loop`: both anchors `free-loop`, `startCellId: "a"`, `motionState: "moving"`, word
     `[a:ab, b:b-bottom, b:ba]`.
   - `rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })` must be truthy. The length is
     7.349830 (`toBeCloseTo(7.34983, 5)`).
   - Pair: `createCurveShorteningPairObject({ id: "pair-loop", first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" }, second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" }, freeEndAnchorId: "free-loop", previousTotalLengthMeters: <that length>, lastGoodFreeEndCellId: "a", lastGoodFreeEndPoint: { x: 4.9, y: 1, z: geodesicRayBeamHeightMeters } })`.
   - One `advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 })`.
   - Expect: `changed` equals `["g-loop"]`. The free end has `cellId` `"b"` and translation x ≈ 0.2925, y ≈ 0.9230
     (`toBeCloseTo(_, 3)`). The interval has `cellId` and `startCellId` `"b"`, and its `portalWord` equals
     `[createCarryPortalTraversal(world, "b", "b-bottom")]`. Its length is ≈ 6.784145 (`toBeCloseTo(6.784145, 4)`).
     The pair has `state` `"moving"` and `previousTotalLengthMeters` ≈ 6.784145.
   - Today the pair, loop and free end are all deleted.
   - The numbers come from the math. The descent direction at F is (0.98131, -0.19241), and the step is
     min(0.4·1, ¼·7.3498) = 0.4 m, so F moves to (5.2925, 0.9230) in `a`'s frame, which is (0.2925, 0.9230) in `b`.
     The new word `[ab⁻¹] + [ab, bb, ba] + [ab]` reduces to `[bb]`.
6. `"refuses to lift an interval whose word does not chain between its anchors' cells"`
   - World `compileLargePortalWorld()`. Emitters `cannon-a` in `a` at (4, 2.5) and `cannon-b` in `b` at (1, 2.5).
   - Interval `g-a` from `cannon-a` to `cannon-b`, `startCellId: "a"`, word `[]`:
     `liftGeodesicEndpoint({ world, registry, interval, sourceRole: "start" })` returns `undefined`. The same for
     `sourceRole: "end"`.
   - With the word `[createCarryPortalTraversal(world, "a", "ab")]`, it returns an object whose
     `targetPointInSourceCell.x` ≈ 6 (`toBeCloseTo(6, 6)`).
7. `"reduces the portal word when an interval is created"`
   - `createGeodesicIntervalObject({ ..., portalWord: [ab, ba] })` with `ab = createCarryPortalTraversal(world, "a", "ab")`
     and `ba = createCarryPortalTraversal(world, "b", "ba")` (world `compileLargePortalWorld()`) has `portalWord`
     equal to `[]`.

Run the tests of one file, then everything:

```sh
npx vitest run tests/world-objects/geodesicCannon.test.ts
npm run typecheck
npm test
npm run docs:check     # if it reports stale generated files: npm run docs:generate, then docs:check again
```

If an expected number differs from the one above by more than the stated tolerance, do not loosen the assertion
silently. First check the setup against this file. If the setup is right and the behaviour is otherwise correct (the
word is right, the length decreased, the loop exists), use the measured number. Record the old and new numbers under
`### Uncertain`.

## Do not

- Do not start job 25 (splitting `geodesicCannon.ts`) or job 26 (exact funnel solver). Do not move functions to other
  files.
- Do not change `src/render/three/geodesicCannonTools.ts`. Leave its legacy word path (`:973-985`) as it is.
- Do not change step sizes, tolerances or the absorb logic of curve shortening; that is job 06. Leave the
  `TODO(issue 66)` comment in place.
- Do not use `else if` in the helper; the loop case needs both branches.
- Do not relax `allowUnexpectedPortalWord` or the realized-word check in `previewRebuildGeodesicInterval` to make a
  conjugated word "fit".
- Do not edit `_docs/generated/*` by hand.
- Do not commit anything under `tests/scratch/`, if that folder exists.

## Done when

- [ ] The seven new tests exist and pass, and all existing tests pass. `npm run typecheck`, `npm test` and
  `npm run docs:check` pass.
- [ ] `grep -n "TODO(issue 68)" src/world-objects/geodesicCannon.ts` finds nothing, and
  `grep -n "updatePortalWordForMovedEndpointWithAnchors" -r src` finds nothing.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §6 and §11 are updated as in Step 8. `npm run docs:generate` was run, and any
  changed file under `_docs/generated/` is committed.
- [ ] If `### Uncertain` and `### Not done` are empty: close issue 68.
  - `git mv _issues/68_loop_endpoint_crossing_must_conjugate_portal_word.md _issues/_closed/`.
  - Set its `Status:` line to `Status: closed on <date>.` and its `Jobs:` link to
    `../../.agents/jobs/_done/05_conjugate_loop_word_on_anchor_crossing.md`.
  - Directly under the `Jobs:` line, add `## Outcome` (2-4 sentences: the helper, the four sites, the lift check, and
    reduction at creation) and `## Closing evidence` (a bullet list of the seven test names with their file, and the
    commit hash), in the style of `_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md`.
  - Fix links to the old path: `_issues/50_deep_code_audit_2026_10_09_index.md:89` becomes
    `_closed/68_...md`, and in `_issues/67_exact_curve_shortening_via_sleeve_funnel.md:85` `68_...md` becomes
    `_closed/68_...md`. In `.agents/jobs/25_split_geodesic_cannon_modules.md:96`, `../../_issues/68_...md` becomes
    `../../_issues/_closed/68_...md`. Run `grep -rn "68_loop_endpoint" --exclude-dir=node_modules .` to find any other.

  Otherwise, leave issue 68 open, and add under its `Status:` line the line
  `Job 05 landed on <date>; see its Report for open points.`
- [ ] The job file is moved with `git mv .agents/jobs/05_conjugate_loop_word_on_anchor_crossing.md .agents/jobs/_done/`.
  In the moved file, fix the relative links (`../../_issues/...` becomes `../../../_issues/...`, or
  `../../../_issues/_closed/...` if the issue was closed). Fix the link in `_issues/.../68_...md` (`Jobs:` line).
- [ ] The queue row in `.agents/jobs/README.md` becomes
  `| [05](_done/05_conjugate_loop_word_on_anchor_crossing.md) | ~~Conjugate a loop's portal word when its shared anchor crosses a portal~~ (done) | [68](../../_issues/_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md) |  |`.
  Use `../../_issues/68_...` if the issue stays open.
- [ ] The job file's `Status:` is `Status: done on <date>.` if `### Uncertain` and `### Not done` are empty; otherwise
  it is `Status: done, needs review on <date>.`. A `## Report` section is appended at the end, with these subsections:
  - `### Done`: what changed, with files, functions, test names and commit hashes.
  - `### Deviations`: where the work differs from the Steps, and why.
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them.
  - `### Not done`: anything skipped, and why.
  - `### Checks`: the commands you ran and their results, including failures.
- [ ] One commit, with a subject such as "Conjugate a loop's portal word when its shared anchor crosses a portal
  (job 05)" and a body in the style of `git log -1 e094b82`, ending with the co-author line the repository uses.

Never stop to ask. If something in this job turns out to be wrong (a line number, a name, an expected number), do the
closest correct thing, and record it under `### Deviations` or `### Uncertain`.

## Report

### Done
- `src/world-objects/geodesicCannon.ts`: added private `portalWordAfterAnchorCrossing` (append at `end`, prepend inverse at `start`, both for a loop, freely reduced) and routed `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`, `resolveCarriedIntervalPortalWord`, `updatePortalWordForMovedEndpoint` and `advanceCurveShorteningPairs` through it; removed `updatePortalWordForMovedEndpointWithAnchors` and the `TODO(issue 68)`. Both lift functions now return `undefined` for a word that does not chain between the anchors' cells. `createGeodesicIntervalObject` reduces its word. Module header and docstrings updated.
- `_docs/MATHEMATICAL_MODEL.md` sections 6 and 11 updated; `_docs/generated/ARCHITECTURE_REFERENCE.md` regenerated.
- `tests/world-objects/geodesicCannon.test.ts`: seven new tests in the block "loop words under anchor portal crossings (job 05)", fixtures `compileTwoCellCylinderWorld` and `compileRotatedFreeLoopWorld`, and the `liftGeodesicEndpoint` import. All passed on the first run with the numbers given in the job.
- Issue 68 closed and moved to `_issues/_closed/`; links in issues 41, 50, 67 and job 25 fixed; queue row updated.
- Commit: the single job 05 commit (see `git log`).
### Deviations
- Also fixed the link to issue 68 in `_issues/_closed/41_documentation_audit_findings.md` (it pointed to the old path; found by the grep the job asks for).
### Uncertain
### Not done
### Checks
- Baseline `npm run typecheck` and `npm test`: green (660 passed, 9 skipped).
- After the change: `npm run typecheck` green; `npm test` 666 passed (the only failure was the stale generated document, fixed by `npm run docs:generate`); `npm run docs:check` green after regenerating.
