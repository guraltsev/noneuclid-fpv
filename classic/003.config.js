// Locked-down starter configuration for the 003 Flat Torus scenario.

export default {
  startingWorld: "torus",

  optionsMenu: {
    configSelectionSection: false,
    worldSelectionSection: false,
    debugSection: false,
  },

  tools: {
    // Sign placement and editing.
    placeFlags: true,

    // Geodesic construction and measurement tools.
    geodesicEmitters: true,
    distances: true,
    angles: true,
  },

  debug: {
    level: "off",
    portalPanels: "none",
    renderQuality: false,

    overlay: {
      enabled: false,
      items: {
        fps: false,
        location: false,
        "portal-quantities": false,
      },
    },

    options: {
      "runtime-diagnostics": false,
      "portal-path-debug": false,
      "portal-static-cull-debug": false,
      "portal-visible-path-debug": false,
      "portal-path-overlays": false,
      "portal-path-overlay-instances": false,
      "forbidden-zone-wireframes": false,
      "object-collision-wireframes": false,
      "selectable-hitboxes": false,
      "aim-collision-outlines": false,
    },
  },
};
