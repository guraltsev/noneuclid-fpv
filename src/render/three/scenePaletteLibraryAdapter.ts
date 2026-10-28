/**
 * Stable public entry point for the in-scene palette library adapter.
 * Re-exports the factory and option types from vrPaletteLibraryAdapter.ts, which implements the adapter for both XR and desktop palettes
 * (the "VR" name is historical). Consumers such as scenePaletteController.ts import from here so the implementation file can be renamed or split later.
 */
export {
  createScenePaletteLibraryAdapter,
  type ScenePaletteLibraryAdapter,
  type ScenePaletteLibraryAdapterOptions,
} from "./vrPaletteLibraryAdapter";
