/**
 * Defines RuntimeCommand, the closed discriminated union of application-level actions that menus and palettes can request without knowing about the renderer.
 * Commands are plain immutable data; they are executed by appCommandDispatcher.ts.
 */
/**
 * Application-level action requested by the UI: reload the world, go home, change world by id, or set the debug overlay flag.
 */
export type RuntimeCommand =
  | { readonly kind: "reload-world" }
  | { readonly kind: "go-home" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "set-debug-overlay"; readonly enabled: boolean };
