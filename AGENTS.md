# Agent instructions

## Knowledge base: `.agents/knowledge/`

`.agents/knowledge/index.md` lists short notes on traps and non-obvious facts of this repo.
**Read the index at the start of work and open the notes that match the task.**

**Keep it current.** When you find something that took real effort to discover and that would save a lot of effort next time
(a trap, a non-obvious invariant, a command that must be run a certain way, why a thing is the way it is), write it down before
finishing the task:

1. Add it to the fitting note in `.agents/knowledge/`, or create a new small note (one topic per file).
2. Add or update its one-line entry in `index.md`: the file link and the fact it holds, in a sentence.
3. Fix or delete a note that turns out to be wrong or stale; never leave two notes saying different things.

What belongs there:
- facts that are hard to find and costly to re-derive, stated as short, checkable lines with the symptom you would
see.
- meta-information about the project that cannot be encoded into its documentation

What does not: anything the code, `_docs` or `git log` already shows, the history of a task, or opinions.

When unsure, ask whether a future agent would have lost significant time without it.
