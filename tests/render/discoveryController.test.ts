/**
 * `tests/render/discoveryController.test.ts` - unit tier.
 *
 * The discovery controller is the shell's side of the discoveries: shown one frame at a time, it announces each discovery with two toasts (the name after "Discovery!", then the question), keeps the session record that Start over clears, reads the beam events from the world's writes and the state of joined beams from the functions it is given, and answers the Discoveries page. The world's writes come from a real change journal.
 */
import { describe, expect, it } from "vitest";
import { ChangeOp, createRuntimeObjectChangeJournal } from "../../src/world-objects/runtimeObjectChangeJournal";
import { createDiscoveryController, discoveryQuestionDurationMs, discoveryToastDurationMs } from "../../src/render/three/discoveryController";

function setup(options: { spec?: Parameters<typeof createDiscoveryController>[0]["spec"] } = {}) {
  const toasts: { text: string; durationMs: number }[] = [];
  const state = { tied: 0, atRest: true, beams: 0, objects: new Map<string, unknown>() };
  const warnings: string[] = [];
  const controller = createDiscoveryController({
    spec: options.spec,
    homeCellId: "front",
    pushToast: (text, durationMs) => toasts.push({ text, durationMs }),
    getObject: (id) => state.objects.get(id) as never,
    tiedVertexCount: () => state.tied,
    curvesAtRest: () => state.atRest,
    beamCount: () => state.beams,
    warn: (message) => warnings.push(message),
  });
  return { controller, toasts, state, warnings };
}

const crossing = { sourceCellId: "front", portalId: "side-1", targetCellId: "right", targetPortalId: "side-3" };
const here = { cellId: "front", position: { x: 0, y: 0 }, crossings: [] as never[] };

describe("discovery controller", () => {
  it("announces a discovery with the name and then the question, and lists it on the page", () => {
    const { controller, toasts } = setup();

    expect(controller.observe({ ...here })).toEqual([]);
    expect(toasts).toEqual([]);

    expect(controller.observe({ cellId: "right", position: { x: 0, y: 0 }, crossings: [crossing] })).toEqual(["across-an-edge"]);
    expect(toasts).toEqual([
      { text: "Discovery! Across an edge", durationMs: discoveryToastDurationMs },
      { text: "Which face did you land on? Was it the one you expected?", durationMs: discoveryQuestionDurationMs },
    ]);
    expect(controller.isFound("across-an-edge")).toBe(true);
    expect(controller.pageEntries().find((entry) => entry.id === "across-an-edge")).toMatchObject({ found: true, action: "show-edges" });
    expect(controller.pageEntries().filter((entry) => !entry.found)).toHaveLength(5);
  });

  it("does not announce the same discovery twice", () => {
    const { controller, toasts } = setup();
    controller.observe({ cellId: "right", position: { x: 0, y: 0 }, crossings: [crossing] });
    controller.observe({ cellId: "right", position: { x: 0, y: 0 }, crossings: [crossing] });
    expect(toasts).toHaveLength(2);
  });

  it("forgets what was found on reset and notices it again", () => {
    const { controller, toasts } = setup();
    controller.observe({ cellId: "right", position: { x: 0, y: 0 }, crossings: [crossing] });
    controller.reset("front");
    expect(controller.isFound("across-an-edge")).toBe(false);
    expect(controller.pageEntries().every((entry) => !entry.found)).toBe(true);

    controller.observe({ cellId: "right", position: { x: 0, y: 0 }, crossings: [crossing] });
    expect(toasts).toHaveLength(4);
  });

  it("notices a new shape once, in the observation after the shape machine changed the world", () => {
    const { controller } = setup();
    controller.noteShapeChanged();
    expect(controller.observe({ ...here })).toEqual(["new-shape"]);
    expect(controller.observe({ ...here })).toEqual([]);
  });

  it("notices a string that stopped straightening from the state of joined beams", () => {
    const { controller, state } = setup();
    state.tied = 2;
    state.atRest = false;
    state.beams = 3;
    expect(controller.observe({ ...here })).toEqual([]);
    state.atRest = true;
    expect(controller.observe({ ...here })).toEqual(["tight-string"]);
  });

  it("reads a beam that ended in a corner from the writes of the frame", () => {
    const { controller } = setup();
    const journal = createRuntimeObjectChangeJournal<never>();
    journal.record(ChangeOp.Added, { id: "g1:segment:0", kind: "geodesicModel/segment", geodesicId: "g1", terminal: { kind: "forbidden-zone-hit", junctionId: "front:vertex-0" } } as never);
    expect(controller.observe({ ...here, changes: journal as never })).toEqual(["beam-hits-corner"]);
  });

  it("reads a beam that came home to its own laser through the registry", () => {
    const { controller, state } = setup();
    state.objects.set("g1", { id: "g1", kind: "geodesicModel/arc", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e1" } });
    const journal = createRuntimeObjectChangeJournal<never>();
    journal.record(ChangeOp.Updated, { id: "g1:segment:2", kind: "geodesicModel/segment", geodesicId: "g1", terminal: { kind: "emitter-hit", emitterId: "e1" } } as never);
    expect(controller.observe({ ...here, changes: journal as never })).toEqual(["beam-came-home"]);
  });

  it("leaves out disabled discoveries and names the mistakes of an authored section", () => {
    const { controller, warnings } = setup({
      spec: {
        disable: ["new-shape"],
        add: [{ id: "new-shape", name: "Again", question: "Q?", teaser: "T", detector: { kind: "visitFace", cellId: "right" } }],
        markers: [],
      },
    });
    expect(controller.definitions().some((definition) => definition.id === "new-shape")).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it("finds an authored discovery by its detector", () => {
    const { controller, toasts } = setup({
      spec: {
        disable: [],
        add: [{ id: "corner", name: "The corner", question: "How many squares?", teaser: "three squares", detector: { kind: "approach", cellId: "front", position: { x: 5, y: 5, z: 0 }, radius: 1 } }],
        markers: [],
      },
    });
    expect(controller.observe({ cellId: "front", position: { x: 5.5, y: 5.5 }, crossings: [] })).toEqual(["corner"]);
    expect(toasts.map((toast) => toast.text)).toEqual(["Discovery! The corner", "How many squares?"]);
  });
});
