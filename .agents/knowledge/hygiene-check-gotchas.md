# Hygiene check (`scripts/tests/hygiene.mjs`) gotchas

- **H4 (no test/debug-only name) scans the whole file's source text**, not just imports: any identifier matching
  `/ForDebug|ForTests/` anywhere — including inside a `/** module comment */` that merely *mentions* the name
  (e.g. explaining why a test stopped using `leaderForDebug`) — trips the rule. Symptom: `uses \`xForDebug\`, a name
  marked test/debug-only` even though the file no longer imports it. Fix: describe the accessor in prose without
  writing its exact identifier (e.g. "the runtime's debug-only leader accessor").
- **H6's 90-character name limit is measured on the literal source text of the `it(...)` call**, not the
  interpolated string at runtime. A template literal like `` it(`keeps X (${zoneOnLeft ? "left" : "right"}` `) `` is
  measured with the `${...}` expression's own characters included, so it reads much longer than the two concrete
  strings it actually produces. Compute candidate lengths against the *source* text, not a runtime-evaluated
  example, before trusting a manual character count.
