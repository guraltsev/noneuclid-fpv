/**
 * `tests/render/firstUseTipController.test.ts` - unit tier.
 *
 * The first-use tip controller shows the first step the first time a tool is taken, moves on when the world reports the event the step waits for (once per frame), ends when the tool is put away or "Got it" is pressed, shows again for "Try it", remembers the tools it showed, and speaks through a toast in VR. The card is a fake; the world's writes come from a real change journal.
 */
import { describe, expect, it } from "vitest";
import { ChangeOp, createRuntimeObjectChangeJournal } from "../../src/world-objects/runtimeObjectChangeJournal";
import { createFirstUseTipController, tipEventsInChanges } from "../../src/render/three/firstUseTipController";
import type { TipCard, TipCardHandlers } from "../../src/render/dom/tipCard";

type Record = { readonly id: string; readonly kind: string; readonly intendedLengthMeters?: number };

function journalWith(writes: readonly { readonly op: ChangeOp; readonly object: Record; readonly before?: Record }[]) {
  const journal = createRuntimeObjectChangeJournal<never>();
  for (const write of writes) journal.record(write.op, write.object as never, write.before as never);
  return journal;
}

function setup(options: { xr?: boolean; stored?: string } = {}) {
  const shown: { text: string; hasNext: boolean }[] = [];
  const state = { visible: false, handlers: undefined as TipCardHandlers | undefined };
  const toasts: string[] = [];
  const stored = new Map<string, string>(options.stored === undefined ? [] : [["noneuclid.seenTips", options.stored]]);
  const controller = createFirstUseTipController({
    container: {} as HTMLElement,
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
    controlNames: () => ({ use: "Left click", menu: "Right click / F", hand: "0" }),
    isXr: () => options.xr === true,
    pushToast: (text) => toasts.push(text),
    createCard: (_container, handlers): TipCard => {
      state.handlers = handlers;
      return {
        root: {} as HTMLDivElement,
        show(text, hasNext) {
          shown.push({ text, hasNext });
          state.visible = true;
        },
        hide() {
          state.visible = false;
        },
        dispose() {},
      };
    },
  });
  return { controller, shown, state, toasts, stored };
}

describe("tip events in a frame's writes", () => {
  it("names a laser, a sign, a measurement and a longer beam, and nothing else", () => {
    const journal = journalWith([
      { op: ChangeOp.Added, object: { id: "e1", kind: "geodesicEmitters/emitter" } },
      { op: ChangeOp.Added, object: { id: "f1", kind: "placedFlags/flag" } },
      { op: ChangeOp.Added, object: { id: "m1", kind: "geodesicMeasurements/angle" } },
      { op: ChangeOp.Updated, object: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 6 }, before: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 4 } },
      { op: ChangeOp.Updated, object: { id: "a2", kind: "geodesicModel/arc", intendedLengthMeters: 4 }, before: { id: "a2", kind: "geodesicModel/arc", intendedLengthMeters: 4 } },
      { op: ChangeOp.Removed, object: { id: "f9", kind: "placedFlags/flag" } },
    ]);

    expect(tipEventsInChanges(journal as never)).toEqual(["laser-placed", "sign-placed", "measurement-placed", "beam-extended"]);
  });
});

describe("first-use tip controller", () => {
  it("shows the first step when a tool is first taken, and not the second time", () => {
    const { controller, shown, state } = setup();

    controller.toolTaken("geodesicEmitters/emitter");
    expect(shown.at(-1)).toEqual({ text: "Aim at the floor and use Left click to place a laser", hasNext: true });
    controller.toolPutAway();
    expect(state.visible).toBe(false);

    const count = shown.length;
    controller.toolTaken("geodesicEmitters/emitter");
    expect(shown.length).toBe(count);
    expect(state.visible).toBe(false);
    controller.dispose();
  });

  it("moves on for the event of the step, once per frame, and ends after the last step", () => {
    const { controller, shown, state } = setup();
    controller.toolTaken("geodesicEmitters/emitter");

    // A laser and a longer beam in one frame advance only one step.
    controller.observe(journalWith([
      { op: ChangeOp.Added, object: { id: "e1", kind: "geodesicEmitters/emitter" } },
      { op: ChangeOp.Updated, object: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 6 }, before: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 4 } },
    ]) as never);
    expect(controller.current()?.stepIndex).toBe(1);
    expect(shown.at(-1)?.text).toBe("Aim at the beam and use Left click to make it longer");

    controller.observe(journalWith([{ op: ChangeOp.Added, object: { id: "f1", kind: "placedFlags/flag" } }]) as never);
    expect(controller.current()?.stepIndex).toBe(1);

    controller.observe(journalWith([
      { op: ChangeOp.Updated, object: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 8 }, before: { id: "a1", kind: "geodesicModel/arc", intendedLengthMeters: 6 } },
    ]) as never);
    expect(controller.current()?.stepIndex).toBe(2);
    expect(shown.at(-1)).toEqual({ text: "Aim at a laser and use Right click / F for its menu: Aim, Add beam, Join, Delete", hasNext: false });

    state.handlers?.onGotIt();
    expect(controller.current()).toBeUndefined();
    expect(state.visible).toBe(false);
  });

  it("moves on by hand with Next", () => {
    const { controller, shown, state } = setup();
    controller.toolTaken("placedFlags/flag");
    state.handlers?.onNext();
    expect(controller.current()?.stepIndex).toBe(1);
    expect(shown.at(-1)?.hasNext).toBe(false);
  });

  it("shows again for Try it, remembers what it showed, and forgets on a reset", () => {
    const { controller, shown, stored } = setup({ stored: '["placedFlags/flag"]' });
    controller.toolTaken("placedFlags/flag");
    expect(shown).toEqual([]);

    controller.toolTaken("placedFlags/flag", true);
    expect(shown.at(-1)?.text).toBe("Aim at the floor and use Left click to put up a sign");

    controller.toolTaken("worldMap/map");
    expect(JSON.parse(stored.get("noneuclid.seenTips") ?? "[]")).toEqual(["placedFlags/flag", "worldMap/map"]);

    controller.resetSeen();
    controller.toolPutAway();
    const count = shown.length;
    controller.toolTaken("worldMap/map");
    expect(shown.length).toBe(count + 1);
  });

  it("ends the tip of a tool that was left for another that has seen its tip", () => {
    const { controller, state } = setup({ stored: '["worldMap/map"]' });
    controller.toolTaken("placedFlags/flag");
    expect(state.visible).toBe(true);
    controller.toolTaken("worldMap/map");
    expect(controller.current()).toBeUndefined();
    expect(state.visible).toBe(false);
  });

  it("speaks through a toast in VR and keeps the card hidden", () => {
    const { controller, toasts, state } = setup({ xr: true });
    controller.toolTaken("geodesicMeasurements/length");
    expect(toasts).toEqual(["Aim at a beam and use Left click to measure it"]);
    expect(state.visible).toBe(false);
  });
});
