/**
 * Tests of the renderer-neutral toast queue: expiry after the duration, at most two visible, a repeated text restarting its timer, and the action being kept.
 */
import { describe, expect, it } from "vitest";
import { createToastQueue } from "../../src/ui/toastQueue";

const config = { durationMs: 2500, maxVisible: 2 } as const;

describe("toast queue", () => {
  it("shows a toast until its duration has passed", () => {
    const queue = createToastQueue(config);
    queue.push("Laser", { nowMs: 1000 });
    queue.tick(3499);
    expect(queue.visible().map((toast) => toast.text)).toEqual(["Laser"]);
    queue.tick(3500);
    expect(queue.visible()).toEqual([]);
  });

  it("shows at most two and drops the oldest when a third arrives", () => {
    const queue = createToastQueue(config);
    queue.push("one", { nowMs: 0 });
    queue.push("two", { nowMs: 10 });
    queue.push("three", { nowMs: 20 });
    expect(queue.visible().map((toast) => toast.text)).toEqual(["two", "three"]);
  });

  it("restarts the timer of an identical visible toast instead of stacking", () => {
    const queue = createToastQueue(config);
    queue.push("Laser", { nowMs: 0 });
    queue.push("Ruler", { nowMs: 100 });
    queue.push("Laser", { nowMs: 2000 });
    expect(queue.visible().map((toast) => toast.text)).toEqual(["Laser", "Ruler"]);
    queue.tick(2600);
    expect(queue.visible().map((toast) => toast.text)).toEqual(["Laser"]);
    queue.tick(4500);
    expect(queue.visible()).toEqual([]);
  });

  it("keeps the action and gives each new toast its own id", () => {
    const queue = createToastQueue(config);
    queue.push("World reset", { nowMs: 0, action: { label: "Undo", id: "undo" } });
    queue.push("Laser", { nowMs: 0 });
    const [reset, laser] = queue.visible();
    expect(reset.action).toEqual({ label: "Undo", id: "undo" });
    expect(laser.action).toBeUndefined();
    expect(reset.id).not.toBe(laser.id);
  });

  it("stamps a push without a time from the configured clock", () => {
    let clock = 5000;
    const queue = createToastQueue({ ...config, now: () => clock });
    queue.push("Laser");
    clock = 7499;
    queue.tick(clock);
    expect(queue.visible()).toHaveLength(1);
    queue.tick(7500);
    expect(queue.visible()).toHaveLength(0);
  });
});
