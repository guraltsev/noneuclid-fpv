# Working on the engine design (012)

- The next version (the app as a non-Euclidean engine with an API) is designed in `_docs/design/012-engine-api.md`,
  iterated in discussion with the maintainer. The status rules are in its header; what is not written there:
- The maintainer often disagrees with suggestions and refines them. Never record a suggestion as **Agreed** until they
  say so; record their reformulation, not yours. Corrections are frequent and welcome; log each one.
- After every outcome: edit the item in place, add a dated decision-log line, run `npm run docs:check`.
- Explain concretely. When they say they do not understand, use an example from the actual worlds (the cube corner with
  270 degrees, placing a flag through a portal) rather than more abstraction.
- Claims about the code in a design argument must be checked first. Symptom of skipping it: a stated rule that the code
  does not have (example: a "still emitter" precondition for tie-and-detach that does not exist).
- Related: [math-to-code-thesis.md](math-to-code-thesis.md), [optional-features-localized.md](optional-features-localized.md).
