# Optional optimisations: keep them, but localized

- When a measurement shows an optimisation gains little, the maintainer prefers keeping it as an opt-in plugin over
  deleting it, provided it is **localized**: a few well-defined hook points, not sprawling, not symbiotic with the main
  pipeline, which must work unchanged without it; its debug views live with it.
- "Exactly one call site" is too strong; the maintainer's word is "localized".
- When proposing removal or isolation, report how many places the feature touches today (example: on 2026-10-30 the
  static cull was referenced by ten files outside its own modules; see 012, section 6).
