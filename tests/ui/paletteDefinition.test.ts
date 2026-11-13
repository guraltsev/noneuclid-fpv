/**
 * `tests/ui/paletteDefinition.test.ts` â€” unit tier.
 *
 * `createPaletteDefinition` turns a `RuntimeMenuState` plus the app config into the renderer-neutral
 * `PaletteDefinition` both the desktop DOM menu and the VR panel (`scenePaletteAdapter`) draw from: which
 * options a page offers, which are disabled, and which sections the app config hides. These tests check that
 * decision directly, without going through either renderer. The scene adapter's own rendering mechanism (icon
 * lookup, the on-screen sign keyboard's key choice, suppressing an action for a connected geodesic) is covered in
 * `tests/render/scenePaletteAdapter.test.ts` instead, since none of it is decided here.
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig, normalizeAppConfig } from "../../src/glue/appConfig";
import {
  createRuntimeMenuState,
  showRuntimeMenuEditSign,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
  showRuntimeMenuMeasurementActions,
  showRuntimeMenuPlaceFlagOptions,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuSettings,
  showRuntimeMenuTutorial,
} from "../../src/runtime/runtimeMenuState";
import {
  createPaletteDefinition,
  type GeodesicCannonActionsPaletteContent,
  type MainPaletteContent,
  type PlaceFlagOptionsPaletteContent,
  type QuestionHelpPaletteContent,
  type SettingsPaletteContent,
  type TutorialPaletteContent,
} from "../../src/ui/paletteDefinition";
import { createTestPaletteDefinition } from "../support/tools";

describe("createPaletteDefinition", () => {
  it("makes the main page the main menu on desktop, with no tool tiles", () => {
    const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }));
    const content = definition.content as MainPaletteContent;

    expect(content.menuActions.map((action) => action.label)).toEqual(["Help", "Settings", "Go home", "Start over"]);
    expect(content.toolOptions).toEqual([]);
  });

  it("makes the main page the main menu in VR too, with no tool tiles (tools come from the belt)", () => {
    const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }), defaultAppConfig, "xr");
    const content = definition.content as MainPaletteContent;

    expect(content.kind).toBe("main");
    expect(content.menuActions.map((action) => action.label)).toEqual(["Help", "Settings", "Go home", "Start over"]);
    expect(content.toolOptions).toEqual([]);
  });

  it("lists every placed-flag type as a place-flag option", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuPlaceFlagOptions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
    ));
    const content = definition.content as PlaceFlagOptionsPaletteContent;

    expect(content.flagTypeOptions.map((option) => option.id)).toEqual(
      expect.arrayContaining(["WoodenSign1", "WoodenSign2"]),
    );
  });

  it("shows each contributed action with the availability the cannon options give it", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const available = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }],
    })).content as GeodesicCannonActionsPaletteContent;
    const unavailable = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: false }],
    })).content as GeodesicCannonActionsPaletteContent;

    expect(available.objectActions.map((action) => action.enabled)).toEqual([true]);
    expect(unavailable.objectActions.map((action) => action.enabled)).toEqual([false]);
  });

  it("marks a connected geodesic with a connection-symbol label; a free one with none", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
      connectedGeodesicIds: ["g-a"],
    })).content as GeodesicCannonActionsPaletteContent;
    const [connected, free] = content.geodesics;

    expect(connected.connected).toBe(true);
    expect(connected.connectionSymbolLabel).toBe("Linked beam: a beam from one laser to another");
    expect(free.connected).toBe(false);
    expect(free.connectionSymbolLabel).toBeUndefined();
  });

  it("hides the world and config picker sections exactly as the app config says to", () => {
    const shown = createTestPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })),
    ).content as SettingsPaletteContent;
    const hidden = createTestPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "001-basic-cube" })),
      normalizeAppConfig({ optionsMenu: { configSelectionSection: false, worldSelectionSection: false } }),
    ).content as SettingsPaletteContent;

    expect(shown.worldSelectionSectionEnabled).toBe(true);
    expect(shown.configSelectionSectionEnabled).toBe(true);
    expect(hidden.worldSelectionSectionEnabled).toBe(false);
    expect(hidden.configSelectionSectionEnabled).toBe(false);
  });

  it("disables tutorial paging at the first and last page, and labels the current one", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuTutorial(state, {
      objectId: "startingQuestionCube",
      pages: [
        { title: "Move", body: "Use arrows." },
        { title: "Act", body: "Click things." },
      ],
    })).content as TutorialPaletteContent;

    expect(content.pageLabel).toBe("1 / 2");
    expect(content.previousAction.disabled).toBe(true);
    expect(content.nextAction.disabled).toBe(false);
  });

  it("disables a help hub subpage exactly when it has no pages", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuQuestionHelp(state, {
      objectId: "startingQuestionCube",
      tutorialPages: [{ title: "Move", body: "Use arrows." }],
      goalPages: [],
    })).content as QuestionHelpPaletteContent;

    expect(content.options.find((option) => option.id === "tutorial")?.disabled).toBe(false);
    expect(content.options.find((option) => option.id === "goal")?.disabled).toBe(true);
  });

  it("disables the geometry computer's go action until the target differs from the current shape", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "torus" });
    const unchanged = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 0,
      targetDepthMeters: 15,
    }));
    const changed = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 1,
      targetDepthMeters: 20,
    }));

    expect((unchanged.content as { goAction: { disabled: boolean } }).goAction.disabled).toBe(true);
    expect((changed.content as { goAction: { disabled: boolean } }).goAction.disabled).toBe(false);
  });

  it("shows the moduli of current and target", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "torus" });
    const content = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 15,
      targetDepthMeters: 15,
      startSkewXMeters: 0,
      startDepthMeters: 15,
    })).content as { currentModuliLabel: string; targetModuliLabel: string };
    expect(content.currentModuliLabel).toContain("square");
    expect(content.currentModuliLabel).toContain("starting torus");
    expect(content.targetModuliLabel).toContain("1 Dehn twist");

    const unavailable = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: false,
    })).content as { currentModuliLabel: string; targetModuliLabel: string };
    expect(unavailable.currentModuliLabel).toBe("");
    expect(unavailable.targetModuliLabel).toBe("");
  });

  it("keeps the edit-sign flag id and message, capped at the placed-flag message limit", () => {
    const content = createTestPaletteDefinition(showRuntimeMenuEditSign(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { flagId: "sign-a", message: "A\nB" },
    )).content;

    expect(content).toMatchObject({ kind: "edit-sign", flagId: "sign-a", message: "A\nB" });
    expect((content as { maxLength: number }).maxLength).toBeGreaterThan(0);
  });
});

describe("disabled controls in palette definitions", () => {
  const cube = createRuntimeMenuState({ selectedWorldId: "cube" });
  const tutorialPages = [
    { title: "One", body: "First." },
    { title: "Two", body: "Second." },
  ];

  /** Every control a definition marks disabled, with the reason it carries ("" when it has none). The inert header placeholder is skipped. */
  function disabledControls(value: unknown, path = "content"): { path: string; reason: string }[] {
    if (value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap((item, index) => disabledControls(item, `${path}[${index}]`));
    const record = value as Record<string, unknown>;
    const found: { path: string; reason: string }[] = [];
    const reasonOf = (key: string): string => (typeof record[key] === "string" ? (record[key] as string) : "");
    if (record.id !== "none" && record.disabled === true) found.push({ path, reason: reasonOf("disabledReason") });
    if (record.enabled === false) found.push({ path, reason: reasonOf("disabledReason") });
    if (record.deleteDisabled === true) found.push({ path: `${path}.delete`, reason: reasonOf("deleteDisabledReason") });
    if (record.aimDisabled === true) found.push({ path: `${path}.aim`, reason: reasonOf("aimDisabledReason") });
    for (const [key, child] of Object.entries(record)) found.push(...disabledControls(child, `${path}.${key}`));
    return found;
  }

  const fixtures = (): readonly (readonly [string, ReturnType<typeof createTestPaletteDefinition>])[] => {
    const geometry = (available: boolean, target: number) => showRuntimeMenuGeometryComputerActions(
      createRuntimeMenuState({ selectedWorldId: "torus" }),
      { computerId: "gc", available, widthMeters: 15, currentSkewXMeters: 0, currentDepthMeters: 15, targetSkewXMeters: target, targetDepthMeters: 15 },
    );
    return [
      ["main", createTestPaletteDefinition(cube)],
      ["settings", createTestPaletteDefinition(showRuntimeMenuSettings(cube))],
      ["place sign options", createTestPaletteDefinition(showRuntimeMenuPlaceFlagOptions(cube))],
      ["edit sign", createTestPaletteDefinition(showRuntimeMenuEditSign(cube, { flagId: "s", message: "A" }))],
      ["laser with a free and a linked beam", createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(cube, {
        cannonId: "c",
        geodesicIds: ["g-a", "g-b"],
        connectedGeodesicIds: ["g-b"],
        objectActions: [
          { actionId: "tie-and-detach", label: "Join", iconId: "tie-and-detach", tooltip: "Join", enabled: false, disabledReason: "Needs two linked beams at this laser" },
        ],
      }))],
      ["shape machine off", createTestPaletteDefinition(geometry(false, 0))],
      ["shape machine at target", createTestPaletteDefinition(geometry(true, 0))],
      ["shape machine with a change", createTestPaletteDefinition(geometry(true, 15))],
      ["tutorial first page", createTestPaletteDefinition(showRuntimeMenuTutorial(cube, { objectId: "q", pages: tutorialPages, pageIndex: 0, view: "page" }))],
      ["tutorial last page", createTestPaletteDefinition(showRuntimeMenuTutorial(cube, { objectId: "q", pages: tutorialPages, pageIndex: 1, view: "page" }))],
      ["help hub with no goals", createTestPaletteDefinition(showRuntimeMenuQuestionHelp(cube, { objectId: "q", tutorialPages, goalPages: [] }))],
      ["help hub with no tutorial", createTestPaletteDefinition(showRuntimeMenuQuestionHelp(cube, { objectId: "q", tutorialPages: [], goalPages: tutorialPages }))],
    ];
  };

  it("gives every disabled control a reason in words", () => {
    let checked = 0;
    for (const [name, definition] of fixtures()) {
      const disabled = [
        ...disabledControls(definition.content),
        ...disabledControls({ ...definition.leftAction }, "leftAction"),
        ...disabledControls({ ...definition.rightAction }, "rightAction"),
      ];
      for (const control of disabled) {
        checked += 1;
        expect(control.reason.length, `${name}: ${control.path} has no reason`).toBeGreaterThan(3);
      }
    }
    // The walk must see the disabled controls of the fixtures, or it proves nothing.
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it("names the reasons the design asks for", () => {
    const [, laser] = fixtures().find(([name]) => name.startsWith("laser"))!;
    const content = laser.content as GeodesicCannonActionsPaletteContent;
    expect(content.objectActions[0]).toMatchObject({ enabled: false, disabledReason: "Needs two linked beams at this laser" });
    expect(content.geodesics[1]).toMatchObject({ aimDisabled: true, aimDisabledReason: "Linked beams cannot be aimed" });
    expect(content.geodesics[0]).toMatchObject({ aimDisabled: false });

    const [, atTarget] = fixtures().find(([name]) => name === "shape machine at target")!;
    expect((atTarget.content as { goAction: unknown }).goAction).toMatchObject({ disabled: true, disabledReason: "Nothing to change" });
    const [, withChange] = fixtures().find(([name]) => name === "shape machine with a change")!;
    expect((withChange.content as { goAction: unknown }).goAction).toEqual({ label: "GO!", disabled: false });
  });

  it("puts text on the laser menu actions, with the key after a dot", () => {
    const state = showRuntimeMenuGeodesicCannonActions(cube, { cannonId: "c", geodesicIds: [] });
    const desktop = createTestPaletteDefinition(state).content as GeodesicCannonActionsPaletteContent;
    expect(desktop.addAction.label).toBe("+ Add beam");
    expect(desktop.carryAction.label).toBe("Pick up · G");
    expect(desktop.deleteAction.label).toBe("Delete");

    const oneLeft = createPaletteDefinition(state, defaultAppConfig, "xr", Date.now(), "one-left").content as GeodesicCannonActionsPaletteContent;
    expect(oneLeft.carryAction.label).toBe("Pick up · X");
    const twoControllers = createPaletteDefinition(state, defaultAppConfig, "xr", Date.now(), "two-controllers").content as GeodesicCannonActionsPaletteContent;
    expect(twoControllers.carryAction.label).toBe("Pick up · A");
  });

  it("opens the measurement menu with a Delete button", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuMeasurementActions(cube, { measurementId: "m1", measurementKind: "length" }));
    expect(definition.pageId).toBe("measurement-actions");
    expect(definition.content).toMatchObject({ kind: "measurement-actions", measurementId: "m1", deleteAction: { label: "Delete", disabled: false } });
  });
});
