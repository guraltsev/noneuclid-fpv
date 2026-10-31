import { describe, expect, it, vi } from "vitest";
import { createFrameErrorGuard } from "../../src/render/three/frameErrorGuard";

function createGuard(maxConsecutiveFailures = 3) {
  const report = vi.fn();
  const onPersistentFailure = vi.fn();
  const guard = createFrameErrorGuard({ maxConsecutiveFailures, report, onPersistentFailure });
  return { guard, report, onPersistentFailure };
}

describe("frame error guard", () => {
  it("keeps running frames after one throws and reports the error once", () => {
    const { guard, report } = createGuard();
    const recover = vi.fn();
    const rendered: number[] = [];
    let frameIndex = 0;

    for (let index = 0; index < 5; index += 1) {
      guard.runFrame(() => {
        frameIndex += 1;
        if (frameIndex === 2) {
          throw new Error("creature update failed");
        }
        rendered.push(frameIndex);
      }, recover);
    }

    expect(rendered).toEqual([1, 3, 4, 5]);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("frame", expect.any(Error));
    expect(guard.consecutiveFailures).toBe(0);
    expect(guard.totalFailures).toBe(1);
  });

  it("reports a repeated failure only once but counts every occurrence", () => {
    const { guard, report } = createGuard(100);

    for (let index = 0; index < 10; index += 1) {
      guard.runFrame(() => {
        throw new Error("same failure");
      }, () => undefined);
    }

    expect(report).toHaveBeenCalledTimes(1);
    expect(guard.consecutiveFailures).toBe(10);
    expect(guard.totalFailures).toBe(10);
  });

  it("signals persistent failure once per streak, at the threshold", () => {
    const { guard, onPersistentFailure } = createGuard(3);
    const fail = () => {
      throw new Error("broken");
    };

    for (let index = 0; index < 5; index += 1) {
      guard.runFrame(fail, () => undefined);
    }
    expect(onPersistentFailure).toHaveBeenCalledTimes(1);

    guard.runFrame(() => undefined, () => undefined);
    for (let index = 0; index < 3; index += 1) {
      guard.runFrame(fail, () => undefined);
    }
    expect(onPersistentFailure).toHaveBeenCalledTimes(2);
  });

  it("contains a failing phase without failing the frame", () => {
    const { guard, report } = createGuard();
    const afterPhase = vi.fn();
    const recover = vi.fn();

    guard.runFrame(() => {
      const ok = guard.runPhase("tooltip", () => {
        throw new Error("tooltip failed");
      });
      expect(ok).toBe(false);
      afterPhase();
    }, recover);

    expect(afterPhase).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("tooltip", expect.any(Error));
    expect(guard.consecutiveFailures).toBe(0);
  });

  it("never throws when recovery or reporting throws", () => {
    const guard = createFrameErrorGuard({
      maxConsecutiveFailures: 1,
      report: () => {
        throw new Error("report failed");
      },
      onPersistentFailure: () => {
        throw new Error("persistent handler failed");
      },
    });

    expect(() => guard.runFrame(() => {
      throw new Error("frame failed");
    }, () => {
      throw new Error("recover failed");
    })).not.toThrow();
    expect(guard.totalFailures).toBe(3);
  });
});
