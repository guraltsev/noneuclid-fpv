/**
 * The `window.noneuclidGeometry` helpers and the `geometry` API namespace that drive the torus-skew deformation by hand.
 *
 * They are installed while the active deformation is a torus skew or the debug level is not `off`, and removed otherwise. The module
 * keeps no state: it reads the geometry session and the debug settings each time it is asked to install.
 */
import type { AppSession } from "../../runtime/appSession";
import { setApiNamespace } from "../../runtime/publicApi";
import type { WorldGeometrySession } from "../../runtime/worldGeometrySession";
import {
  type GeometryDebugHelpers,
  type WindowWithGeometryDebugHelpers,
  uninstallGeometryDebugHelpers,
} from "./appDebugHelpers";

/** Dependencies of {@link createGeometryDebugHelpers}. */
export interface GeometryDebugHelpersDeps {
  readonly session: AppSession;
  readonly geometrySession: WorldGeometrySession;
}

/** Handle to the geometry helpers created by {@link createGeometryDebugHelpers}. */
export interface GeometryDebugHelpersHandle {
  /** Installs the helpers when they are available for the active deformation or debug level, else removes them. */
  installIfAvailable(): void;
}

/** Creates the installer of the geometry debug helpers. */
export function createGeometryDebugHelpers(deps: GeometryDebugHelpersDeps): GeometryDebugHelpersHandle {
  const { session, geometrySession } = deps;

  function installIfAvailable(): void {
    if (geometrySession.state.current.kind !== "torus-skew" && session.get().debugSettings.debugLevel === "off") {
      uninstallGeometryDebugHelpers();
      return;
    }

    const helpers: GeometryDebugHelpers = {
      SetTorusSkew(skewXMeters) {
        const current = geometrySession.state.current;
        if (current.kind !== "torus-skew") {
          throw new Error("World deformation is not available for the active world.");
        }

        geometrySession.setTarget({
          ...current,
          skewXMeters,
        });
      },
      StepTorusSkew(deltaXMeters) {
        const state = geometrySession.state;
        const base = state.target.kind === "torus-skew"
          ? state.target
          : state.current.kind === "torus-skew"
            ? state.current
            : undefined;
        if (!base) {
          throw new Error("World deformation is not available for the active world.");
        }

        geometrySession.setTarget({
          ...base,
          skewXMeters: base.skewXMeters + deltaXMeters,
        });
      },
      Cancel() {
        geometrySession.cancel();
      },
      get state() {
        return geometrySession.state;
      },
    };

    (window as WindowWithGeometryDebugHelpers).noneuclidGeometry = helpers;
    setApiNamespace("geometry", {
      setTorusSkew: (m: number) => helpers.SetTorusSkew(m),
      stepTorusSkew: (dm: number) => helpers.StepTorusSkew(dm),
      cancel: () => helpers.Cancel(),
      state: () => helpers.state,
    });
  }

  return { installIfAvailable };
}
