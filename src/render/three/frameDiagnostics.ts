/**
 * Frame-timing smoothing, WebGL render-info capture, and the initial XR debug state used by the debug overlay.
 * Timings are milliseconds. Smoothing is an exponential moving average applied once per frame, so it is frame-rate dependent.
 */
import * as THREE from "three";
import { type PlayerPose } from "../../movement/playerPose";
import { getPortalViewportPixels } from "./renderQuality";
import {
  type FramePerformanceRenderState,
  type WebGlRenderInfoState,
  type XrDebugRenderState,
} from "./renderState";
import { type XrSessionState } from "./xrSessionState";

/** Blends the new per-phase frame timings into the previous smoothed ones (returns next unchanged when there is no previous sample). */
export function smoothFramePerformance(
  previous: FramePerformanceRenderState | undefined,
  next: FramePerformanceRenderState,
): FramePerformanceRenderState {
  if (!previous) {
    return next;
  }

  return {
    totalMs: smoothNumber(previous.totalMs, next.totalMs),
    inputMs: smoothNumber(previous.inputMs, next.inputMs),
    moveMs: smoothNumber(previous.moveMs, next.moveMs),
    objectsMs: smoothNumber(previous.objectsMs, next.objectsMs),
    cameraMs: smoothNumber(previous.cameraMs, next.cameraMs),
    portalMs: smoothNumber(previous.portalMs, next.portalMs),
    uiMs: smoothNumber(previous.uiMs, next.uiMs),
    renderMs: smoothNumber(previous.renderMs, next.renderMs),
  };
}

/** Reads draw-call, triangle, line and point counts from the renderer's info of the last render, plus portal viewport pixels and pixel ratio. */
export function captureWebGlRenderInfo(renderer: THREE.WebGLRenderer): WebGlRenderInfoState {
  const viewportPixels = getPortalViewportPixels(renderer);

  return {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
    points: renderer.info.render.points,
    viewportPixels,
    pixelRatio: renderer.getPixelRatio(),
  };
}

/** Moves previous 15 percent of the way toward next. */
export function smoothNumber(previous: number, next: number): number {
  return THREE.MathUtils.lerp(previous, next, 0.15);
}

/** Creates the XR/location debug state at startup: desktop input, no blocked movement, and the player's current cell, position (meters) and yaw (radians). */
export function createInitialXrDebugState(xrSessionState: XrSessionState, playerPose: PlayerPose): XrDebugRenderState {
  return {
    secureContext: xrSessionState.secureContext,
    sessionStatus: xrSessionState.status,
    activeInputSource: "desktop",
    currentCellId: playerPose.cellId,
    playerPosition: playerPose.position,
    yawRadians: playerPose.yawRadians,
    lastMovementBlocked: false,
    sharedRenderRootCellId: undefined,
  };
}
