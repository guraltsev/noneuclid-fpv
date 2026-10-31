# The project's purpose beyond the app: mapping mathematics to code

- The maintainer (a mathematician) runs a wider project on coding mathematical experiences. Its thesis, in their
  words: **there is a coding design philosophy that makes it possible** to map mathematical ideas to code organisation
  and visualisation, not just implement them. Principles are elements of that philosophy, not the thesis itself.
- **This project is a test case for that thesis.** A test case can fail: record counter-evidence (places where code
  organisation does not follow the mathematics) as carefully as evidence, in `_docs/CODING_MATH.md` (tensions).
- **It is also a development playground for refining the philosophy into precise principles.** The principle list in
  `_docs/CODING_MATH.md` is a working draft: when a concrete decision shows a principle too loose or wrong, propose the sharper wording and
  log the refinement.
- Consequence for documentation: explanation is tiered, top down: the mathematical model alone, then how the
  abstraction maps to code organisation and visualisation, then realisation, architecture, contracts, narration
  (agreed; tiers, traceability, principles, evidence and tensions in `_docs/CODING_MATH.md`).
- Consequence for design proposals: name the mathematical structure that motivates a code structure; keep the
  abstraction ("what is distance, what is a geodesic") apart from the representation ("how we compute").
- When mathematics settles an engineering question (an algebraic fact removes a mechanism, an invariant decides an
  ordering), point it out and record it in `_docs/CODING_MATH.md` (evidence): it is evidence for the thesis.
