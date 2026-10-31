/**
 * Fakes of the WebXR boundary: `navigator.xr`, an `XRSession`, and `XRInputSource`s with their gamepads. Covers
 * the surface `xrSessionState`, `xrSessionRestart` and `xrScenePaletteInput` read.
 */
import { vi } from "vitest";
import type { RestartableXrSession } from "../../src/render/three/xrSessionRestart";
import type { XrNavigatorLike } from "../../src/render/three/xrSessionState";

/** `navigator`-like object whose `xr.isSessionSupported` resolves to `supported` (or throws `rejection`). */
export function createFakeXrNavigator(supported: boolean, rejection?: unknown): XrNavigatorLike {
  return {
    xr: {
      isSessionSupported: async () => {
        if (rejection !== undefined) throw rejection;
        return supported;
      },
    },
  };
}

/** A gamepad fake: `buttons[index].pressed` for every requested index, `axes` as given; both default to empty. */
export function createFakeGamepad(options: { readonly pressedButtonIndexes?: readonly number[]; readonly buttonCount?: number; readonly axes?: readonly number[] } = {}): Gamepad {
  const buttonCount = options.buttonCount ?? Math.max(1, ...(options.pressedButtonIndexes ?? [0]).map((i) => i + 1));
  const pressed = new Set(options.pressedButtonIndexes ?? []);
  const buttons = Array.from({ length: buttonCount }, (_, index) => ({ pressed: pressed.has(index) }));

  return { buttons, axes: options.axes ?? [] } as unknown as Gamepad;
}

/** An `XRInputSource` fake: a handedness and a gamepad (defaults to one with no buttons pressed). */
export function createFakeXrInputSource(options: {
  readonly handedness?: XRHandedness;
  readonly gamepad?: Gamepad;
  readonly targetRaySpace?: unknown;
} = {}): XRInputSource {
  return {
    handedness: options.handedness ?? "none",
    gamepad: options.gamepad ?? createFakeGamepad(),
    targetRaySpace: options.targetRaySpace ?? {},
  } as unknown as XRInputSource;
}

/** An `XRFrame` fake whose `getPose` always returns the identity pose unless `pose` is given. */
export function createFakeXrFrame(pose: { readonly position?: Vector3Like; readonly orientation?: QuaternionLike } = {}): XRFrame {
  return {
    getPose: () => ({
      transform: {
        position: pose.position ?? { x: 0, y: 0, z: 0 },
        orientation: pose.orientation ?? { x: 0, y: 0, z: 0, w: 1 },
      },
    }),
  } as unknown as XRFrame;
}

type Vector3Like = { readonly x: number; readonly y: number; readonly z: number };
type QuaternionLike = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };

/**
 * A `RestartableXrSession` fake: `end()` resolves (override with `vi.mocked(session.end).mockRejectedValueOnce`),
 * and `dispatchEnd()` runs every `"end"` listener the code under test registered.
 */
export function createFakeXrSession(): RestartableXrSession & { dispatchEnd(): void } {
  const listeners: Array<() => void> = [];

  return {
    end: vi.fn(async () => undefined),
    addEventListener(type, listener) {
      if (type === "end") {
        listeners.push(listener);
      }
    },
    dispatchEnd() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
