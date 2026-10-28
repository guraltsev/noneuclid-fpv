/**
 * Menu logic for the in-world geometry computer, which edits the torus-skew parameters of the world and starts the deformation.
 * Pending target values live in the runtime menu state (geometryComputerOptions); the geometry session holds the current and target geometry. All lengths are meters: a is the x skew, b the depth, and the width is fixed.
 * Only worlds whose current or target geometry has kind torus-skew are supported; otherwise the actions refresh the menu as unavailable and do nothing.
 */
import {
  type RuntimeMenuState,
  closeRuntimeMenu,
  showRuntimeMenuGeometryComputerActions,
} from "../../runtime/runtimeMenuState";
import { createWorldGeometrySession } from "../../runtime/worldGeometrySession";
import { clampInteger } from "./runtimeSceneUtils";

/** Dependencies for {@link createGeometryComputerMenu}; createThreeApp#shell supplies the session by value and menu state through accessors. */
export interface GeometryComputerMenuDeps {
  /** Session holding the current and target geometry; setTarget starts the deformation toward a new target. */
  readonly geometrySession: ReturnType<typeof createWorldGeometrySession>;
  /** Getter: the current runtime menu state. */
  getMenuState(): RuntimeMenuState;
  /** Setter: replaces the shell's menu state. */
  setMenuState(next: RuntimeMenuState): void;
  /** Re-renders the desktop palette/menu UI after a menu state change. */
  syncDesktopPalette(): void;
}

/**
 * Creates the geometry computer menu actions.
 * Returns createGeometryComputerMenuOptions (menu options for a computer id), refreshOpenGeometryComputerMenu, setGeometryComputerPendingTarget, stepGeometryComputerPendingTarget (add a delta in meters to axis a or b) and startGeometryComputerDeformation. Targets are sanitized to integers: a in [0, 2w] and b in [w/2, 2w] where w is the torus width.
 */
export function createGeometryComputerMenu(deps: GeometryComputerMenuDeps) {
  const { geometrySession, syncDesktopPalette } = deps;

  // Pending (menu) targets take precedence over the session target; available is false for non-torus-skew geometries.
  function createGeometryComputerMenuOptions(computerId: string): Parameters<typeof showRuntimeMenuGeometryComputerActions>[1] {
    const state = geometrySession.state;
    const current = state.current.kind === "torus-skew" ? state.current : undefined;
    const target = state.target.kind === "torus-skew" ? state.target : undefined;
    const pending = deps.getMenuState().geometryComputerOptions;

    return {
      computerId,
      available: current !== undefined || target !== undefined,
      widthMeters: current?.widthMeters ?? target?.widthMeters,
      currentSkewXMeters: current?.skewXMeters,
      currentDepthMeters: current?.depthMeters,
      targetSkewXMeters: pending?.targetSkewXMeters ?? target?.skewXMeters,
      targetDepthMeters: pending?.targetDepthMeters ?? target?.depthMeters,
    };
  }

  // Re-derives menu options only when the geometry-computer actions page is open.
  function refreshOpenGeometryComputerMenu(): void {
    const computerId = deps.getMenuState().geometryComputerOptions?.computerId;
    if (deps.getMenuState().page !== "geometry-computer-actions" || !computerId) {
      return;
    }

    deps.setMenuState(showRuntimeMenuGeometryComputerActions(
      deps.getMenuState(),
      createGeometryComputerMenuOptions(computerId),
    ));
  }

  function setGeometryComputerPendingTarget(
    computerId: string,
    target: { readonly aMeters: number; readonly bMeters: number },
  ): void {
    const base = getGeometryComputerBaseState();
    if (!base) {
      refreshOpenGeometryComputerMenu();
      syncDesktopPalette();
      return;
    }

    const sanitized = sanitizeGeometryComputerTarget(base.widthMeters, target);
    deps.setMenuState(showRuntimeMenuGeometryComputerActions(
      deps.getMenuState(),
      {
        ...createGeometryComputerMenuOptions(computerId),
        targetSkewXMeters: sanitized.aMeters,
        targetDepthMeters: sanitized.bMeters,
      },
    ));
    syncDesktopPalette();
  }

  function stepGeometryComputerPendingTarget(computerId: string, axis: "a" | "b", deltaMeters: number): void {
    const base = getGeometryComputerBaseState();
    if (!base) {
      refreshOpenGeometryComputerMenu();
      syncDesktopPalette();
      return;
    }

    const pending = deps.getMenuState().geometryComputerOptions;
    const next = sanitizeGeometryComputerTarget(base.widthMeters, {
      aMeters: (pending?.targetSkewXMeters ?? base.skewXMeters) + (axis === "a" ? deltaMeters : 0),
      bMeters: (pending?.targetDepthMeters ?? base.depthMeters) + (axis === "b" ? deltaMeters : 0),
    });
    setGeometryComputerPendingTarget(computerId, next);
  }

  // Applies the pending (or base) target to the session and closes the menu. The computer id argument is unused.
  function startGeometryComputerDeformation(_computerId: string): void {
    const base = getGeometryComputerBaseState();
    if (!base) {
      refreshOpenGeometryComputerMenu();
      syncDesktopPalette();
      return;
    }

    const pending = deps.getMenuState().geometryComputerOptions;
    const target = sanitizeGeometryComputerTarget(base.widthMeters, {
      aMeters: pending?.targetSkewXMeters ?? base.skewXMeters,
      bMeters: pending?.targetDepthMeters ?? base.depthMeters,
    });

    geometrySession.setTarget({
      ...base,
      skewXMeters: target.aMeters,
      depthMeters: target.bMeters,
    });
    deps.setMenuState(closeRuntimeMenu(deps.getMenuState()));
    syncDesktopPalette();
  }

  // The current torus-skew geometry, falling back to the target geometry; undefined if neither is torus-skew.
  function getGeometryComputerBaseState() {
    const state = geometrySession.state;
    return state.current.kind === "torus-skew"
      ? state.current
      : state.target.kind === "torus-skew"
        ? state.target
        : undefined;
  }

  // Rounds each component to an integer and clamps it via clampInteger.
  function sanitizeGeometryComputerTarget(
    widthMeters: number,
    target: { readonly aMeters: number; readonly bMeters: number },
  ): { readonly aMeters: number; readonly bMeters: number } {
    return {
      aMeters: clampInteger(target.aMeters, 0, 2 * widthMeters),
      bMeters: clampInteger(target.bMeters, widthMeters / 2, 2 * widthMeters),
    };
  }

  return {
    createGeometryComputerMenuOptions,
    refreshOpenGeometryComputerMenu,
    stepGeometryComputerPendingTarget,
    startGeometryComputerDeformation,
    setGeometryComputerPendingTarget,
  };
}
