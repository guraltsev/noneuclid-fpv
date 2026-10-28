/**
 * Pure model of the immersive-VR session lifecycle shown in the UI and debug state, plus support detection.
 * Typical flow: unknown -> (detect) available | unsupported | insecure-context | failed -> entering -> active -> ended; entering can go to failed.
 * States are immutable values; `transitionXrSessionState` derives the next one while preserving `secureContext` and `immersiveVrSupported`.
 * createThreeApp#shell holds the current state and passes it to xrEntryUi.
 */

/**
 * Lifecycle status of the immersive VR session; see the module header for the usual transitions.
 */
export type XrSessionStatus =
  | "unknown"
  | "unsupported"
  | "insecure-context"
  | "available"
  | "entering"
  | "active"
  | "ended"
  | "failed";

/**
 * Immutable snapshot of session status plus capability flags.
 */
export interface XrSessionState {
  readonly status: XrSessionStatus;
  /** Short human-readable status text (includes the failure message for `failed`). */
  readonly label: string;
  /** Whether the page is in a secure context (HTTPS/localhost), which WebXR requires. */
  readonly secureContext: boolean;
  /** Whether `isSessionSupported("immersive-vr")` reported true; kept across later transitions except to "unsupported". */
  readonly immersiveVrSupported: boolean;
  /** Error text for `failed`; undefined otherwise. */
  readonly failureMessage?: string;
}

/**
 * Structural subset of `navigator` used by `detectXrSessionState`; `xr` is absent in unsupported browsers.
 */
export interface XrNavigatorLike {
  readonly xr?: {
    isSessionSupported(mode: "immersive-vr"): Promise<boolean>;
    requestSession?(mode: "immersive-vr", options?: XRSessionInit): Promise<XRSession>;
  };
}

const labels: Record<XrSessionStatus, string> = {
  unknown: "Checking VR support",
  unsupported: "VR unsupported",
  "insecure-context": "VR requires HTTPS or localhost",
  available: "VR available",
  entering: "Entering VR",
  active: "VR active",
  ended: "VR ended",
  failed: "VR failed",
};

/**
 * Builds a state for `status`. Omitted options default: `secureContext` true unless status is "insecure-context"; `immersiveVrSupported` true only for "available" or "active".
 */
export function createXrSessionState(
  status: XrSessionStatus,
  options: {
    readonly secureContext?: boolean;
    readonly immersiveVrSupported?: boolean;
    readonly failureMessage?: string;
  } = {},
): XrSessionState {
  return {
    status,
    label: status === "failed" && options.failureMessage ? `${labels.failed}: ${options.failureMessage}` : labels[status],
    secureContext: options.secureContext ?? status !== "insecure-context",
    immersiveVrSupported: options.immersiveVrSupported ?? (status === "available" || status === "active"),
    failureMessage: options.failureMessage,
  };
}

/**
 * Returns the label text for `status`; for "failed" the optional message is appended.
 */
export function statusLabel(status: XrSessionStatus, failureMessage?: string): string {
  return createXrSessionState(status, { failureMessage }).label;
}

/**
 * Probes WebXR support and returns the initial state: "insecure-context" if not secure, "unsupported" if `navigator.xr` is missing or reports no immersive-vr support,
 * "available" if supported, or "failed" (with a readable message) if `isSessionSupported` rejects. Never throws.
 */
export async function detectXrSessionState(
  navigatorLike: XrNavigatorLike,
  secureContext: boolean,
): Promise<XrSessionState> {
  if (!secureContext) {
    return createXrSessionState("insecure-context", {
      secureContext: false,
      immersiveVrSupported: false,
    });
  }

  if (!navigatorLike.xr) {
    return createXrSessionState("unsupported", {
      secureContext,
      immersiveVrSupported: false,
    });
  }

  try {
    const supported = await navigatorLike.xr.isSessionSupported("immersive-vr");

    return createXrSessionState(supported ? "available" : "unsupported", {
      secureContext,
      immersiveVrSupported: supported,
    });
  } catch (error) {
    return createXrSessionState("failed", {
      secureContext,
      immersiveVrSupported: false,
      failureMessage: readableError(error),
    });
  }
}

/**
 * Returns the state for `status`, keeping `secureContext` and `immersiveVrSupported` from `state` (support is cleared only when moving to "unsupported").
 * `failureMessage` is attached only to the new state; it is not carried over automatically.
 */
export function transitionXrSessionState(
  state: XrSessionState,
  status: XrSessionStatus,
  failureMessage?: string,
): XrSessionState {
  return createXrSessionState(status, {
    secureContext: state.secureContext,
    immersiveVrSupported: status === "unsupported" ? false : state.immersiveVrSupported,
    failureMessage,
  });
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unable to check immersive VR support.";
}
