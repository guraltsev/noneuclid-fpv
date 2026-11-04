# knowledge

Project knowledge for coding agents (Claude Code and Codex): short Markdown notes that agents save as they learn a
project, and that later sessions are briefed on. Everything runs locally, in your own repository.

- [Overview](#overview)
- [Installation](#installation)
- [Detailed description](#detailed-description)
- [Architecture](#architecture)
- [Reference](#reference): [commands](#commands), [MCP tools](#mcp-tools), [configuration](#configuration), [exit codes](#exit-codes)
- [Safety, privacy and cost](#safety-privacy-and-cost)
- [Known limits](#known-limits)
- [Further reading](#further-reading)

## Overview

**The problem.** Every agent session starts knowing nothing about your project. What one session learned (a root cause, a
build quirk, an approach that failed) is gone for the next.

**What this does.**

1. An agent saves a *note* when it finds something non-obvious and reusable.
2. At the start of a later session, a *brief* of the few relevant note summaries is placed in front of the agent. It
   opens a note only if it looks useful.
3. After the session, a small model *grades* the notes the agent opened (did it help, or mislead?) and may propose notes
   the agent forgot to save.
4. Reports show which notes earn their place, and a *curator* proposes reversible clean-up.

**What it is, concretely.**

| Part | Where it lives |
| --- | --- |
| Notes and usage events | An orphan Git branch `knowledge` in your repository, checked out as a worktree at `.agents/knowledge.d/`. Code branches never contain them. |
| Search | Keywords (BM25) plus local embeddings, merged. No network service. |
| Agent interface | An MCP server `know` (four tools), plus a command line, one launcher per command. |
| Automation | Three hooks per runtime: a brief at the first prompt, and a background job at compaction and session end. |

**Principles.**

- Notes are *reference data, never instructions*. Current source code and tests outrank notes.
- Nothing is pushed anywhere. The tool never touches your global configuration (`~/.claude/`, `~/.codex/`).
- Every model-calling feature that costs money can be switched off, and the report shows what it cost.
- A hook that fails never blocks a prompt.

## Installation

**Requirements:** Python 3.11 or later, Git 2.42 or later, and the repository must use the agents-md drop-in
(`.agents/agents.md.d/` and `.agents/agents-md/agents-md.py`), because that is how the agent instructions reach
`AGENTS.md`.

**Steps.**

```sh
# 1. Copy this folder into the repository, so that it is <repository>/.agents/knowledge/
# 2. From the repository root:
python .agents/knowledge/install.py     # private venv, pinned dependencies, launchers, registrations
_scripts/know_init                      # create the branch and the worktree (once per clone)
_scripts/agents-md build                # put the agent instructions into AGENTS.md
```

On Windows shells the launchers are `.cmd` files; call them the same way (`_scripts\know_init`).

**What the installer changes** (project files only; running it again changes nothing unless `requirements.txt` changed):

| Change | Purpose |
| --- | --- |
| `.agents/.state/knowledge/venv/` | Private Python environment with the pinned requirements. |
| `_scripts/know_<command>` and `.cmd` | One thin launcher per command (generated, gitignored). |
| `.gitignore` | Ignores the worktree, the state folder and `_scripts/`. |
| `.claude/settings.json` | Three Claude Code hooks, merged with the hooks already there. |
| `.mcp.json` | The MCP server `know`. |
| `.codex/hooks.json`, `.codex/config.toml` | The same hooks and server for Codex. |
| `.agents/agents.md.d/70-knowledge.md` | The agent instructions (then `agents-md build` updates `AGENTS.md`). |

**If the repository does not use agents-md,** the installer prints a loud warning, changes nothing, and asks
`Proceed anyway? [y/N]` (default no). Without a terminal it stops unless you pass `--yes`, which skips the question but
never the warning. If you proceed, it prints the agent instructions for you to paste into `AGENTS.md` by hand.

**Per machine.** `.claude/settings.json`, `.mcp.json`, `.codex/hooks.json` and `.codex/config.toml` contain the path of
this machine's private Python, so do not commit them; run `install.py` on each machine and operating system. A settings
file whose shape the installer cannot merge into is reported and left untouched.

**First use.**

- Claude Code asks you to approve the `know` server the first time.
- Codex reads project files only for a trusted project and runs a hook only after you review it with `/hooks`. The
  installer cannot do that for you.
- The first search downloads the embedding model (about 130 MB) into `.agents/.state/knowledge/models/`. Offline, or with
  `retrieval.embedding_enabled = false`, search uses keywords only and says so on stderr.
- Fresh clones run `_scripts/know_init` again to attach the worktree to the existing branch.

**Upgrading from the earlier names** (`_scripts/knowledge`, server `knowledge`, tools `mcp__knowledge__*`): run the
installer again. It removes the old launchers and registrations it wrote, recognised by content, and lists the old tool
names so you can update your own permission rules to `mcp__know__know_*`. Then run `_scripts/agents-md build`.

## Detailed description

### Notes

A note is a Markdown file with YAML frontmatter, named by its ID (`K-20261101-7f3a`: date plus random hex, stable across
edits). Its main fields:

| Field | Values or meaning |
| --- | --- |
| `title`, `summary` | What the brief shows. The summary is the line that decides whether an agent opens the note. |
| `type` | `discovery`, `procedure`, `decision`, `constraint`, `antipattern`, `environment`, `open_question` |
| `status` | `candidate`, `active`, `superseded`, `stale`, `archived` |
| `confidence` | `low`, `medium`, `high`, `unknown` |
| `evidence` | `observed`, `reproduced`, `tested`, `source_verified`, `hypothesis` |
| `trust` | `normal`, or `external` when the evidence came from outside content (web pages, fetched files) |
| `source_files`, `tags`, `valid_when`, `source_branch`, `source_commit` | Where it applies, so drift can be detected |

The body holds the finding, why it matters, the evidence, the conditions, and failed alternatives. A note's *version* is
the Git blob hash of its file, so the exact text an agent saw can always be recovered. Writes go through validation, a
secret scan and a duplicate check; a probable duplicate is refused unless forced.

Statuses: only `active` and `candidate` notes are searched, and candidates always rank below active ones. `know_status`
changes a status with a reason and can restore an `archived` note.

### A session, step by step

1. **Brief.** On the first prompt of a session (and after a compaction), the hook searches with the prompt, packs the
   best matches into a budget (default 5 notes, 350 tokens) and gives the agent a `<project-knowledge>` block of
   summaries and IDs. If nothing is relevant, it gives nothing.
2. **Work.** The agent calls `know_search` when it starts on an unfamiliar failure, `know_read` to open a note, and
   `know_write` to save a discovery. Each call is logged as an event.
3. **Feedback.** When a task is done, the agent calls `know_assess` once per note it opened (`used`, `helpful`,
   `not_needed`, `irrelevant`, `misleading`, `stale`), the negative outcomes as readily as the positive ones.
4. **Session job.** At `PreCompact` and `SessionEnd`, a detached background job reads the part of the transcript not yet
   read, logs usage (tokens, turns, tool calls), then builds a compact digest.
5. **Grading.** If the session opened a note or shows a discovery signal, a small model (Haiku through `claude -p`, or
   `codex exec`) grades each opened note with evidence, and may propose notes the agent never saved. Those are written as
   `candidate` notes. The digest is never stored. A range whose grading failed is retried by the next job, at most three
   times.
6. **Reports and curation.** `know_report` summarises events; `know_curate` reads them and proposes maintenance.

### Search

Two rankings are merged by reciprocal rank fusion: BM25 over the title, summary, tags and source files (weighted up) and
the body, and cosine similarity of
local embeddings (`BAAI/bge-small-en-v1.5` through fastembed). A minimum fused score drops weak matches. Optionally
(`retrieval.small_model_select`, off) a small model picks the relevant notes among the top 20.

### Reports

`know_report` shows, with counts beside every rate and an `insufficient_data` flag for small samples:

- the funnel: notes surfaced, read, graded, and the outcomes;
- usage by session, runtime and model;
- **spend**: every call of the grader, brief selection and curator (failed, empty and retried calls included), their
  tokens and dollars, next to the sessions' own tokens, for sessions that read a note and for the rest;
- per-note rows and slices.

A figure the runtime did not report (Codex prints no tokens or cost) is shown as unknown, never as zero. For a dollar
estimate of the sessions, fill in the optional `[pricing."<model name>"]` tables of `config.toml` (`input`, `output`,
`cache_read`, `cache_write`, USD per million tokens, with the model name exactly as the report prints it). No prices are
built in.

### Curator

`know_curate` reports weak summaries, useful notes, misleading and duplicate notes, drift (a missing `source_files`
path), candidates, and external-trust notes. It proposes reversible actions: add tags, rewrite a weak summary, link
related notes, archive, promote a candidate, mark stale. **Every action has its own `[maintenance]` switch in
`config.toml`, all off by default.** An action is one commit on the knowledge branch plus a `curated` or
`status_changed` event with the reason. Rewriting a technical claim, merging notes and deleting are never done.
`know_curate --dry-run` changes nothing.

### Experiments

`[experiment] holdout_fraction` (off, `0.0`) withholds the brief from that random share of sessions, records it in the
usage event, and lets the report compare the two groups.

## Architecture

### Data flow

```text
 agent session                              project repository
 ─────────────                              ──────────────────
 first prompt ──hook──> brief ──────────┐   code branches (never hold notes)
 know_search/read/write/assess (MCP) ───┼─> .agents/knowledge.d/   worktree of the orphan `knowledge` branch
                                        │      notes/K-….md           one commit per note change
 PreCompact / SessionEnd ──hook──> detached session job                events/yyyy/mm/<runtime>-<session>.jsonl
        │                                        │                     config.toml
        ▼                                        ▼
  read new transcript range ─> usage event      .agents/.state/knowledge/   (derived, gitignored)
        │                                          venv/  embeddings.npz  cursors.json  lock  models/
        ▼
  digest ─> small model (claude -p / codex exec) ─> graded events + candidate notes
```

### Storage

- **Notes and events live on the `knowledge` branch.** Git history is the version history; a note edit is a commit, and
  each session's event file is one commit. Event files are per session and IDs are collision-resistant, so merging
  branches across machines does not conflict.
- **Derived state lives in `.agents/.state/knowledge/`** and can be deleted and rebuilt (`know_reindex` rebuilds the
  embedding cache). A file lock there serialises writers on one machine.
- Pushing the branch to a remote is optional and manual; `git.auto_push` must stay false. If the project directory is
  synchronised by a file-sync tool, exclude `.agents/knowledge.d/` and `.agents/.state/` and use Git for the branch.

### Code layout

The code is the package `project_knowledge/`, entered through `knowledge.py`. Layers, from the bottom:

| Module | Role |
| --- | --- |
| `notes`, `config`, `events` | Note format and validation, configuration, the event log. No side effects beyond their files. |
| `store` | The only module that runs Git: branch, worktree, commits, lock. |
| `search/` | `bm25`, `embeddings`, `fusion`, `hybrid`, `brief` (packing within a budget), `duplicates`. |
| `transcripts/` | Readers for Claude Code (`claude_code`) and Codex (`codex`), `cursors`, `chunks`, and the runtime-neutral `digest`. |
| `usage` | Token, turn and tool-call statistics from transcript records. |
| `grading` | The only module that starts the small model; versioned grader prompt, strict validation. |
| `operations` | Compositions of the above: write, read, search, brief, assess, the session job. |
| `reports`, `curate` | Reports over events; the curator and its switch-gated actions. |
| `hooks`, `mcp_server`, `cli` | The interfaces. Only these print or fail open. |

Rules that hold across the code: only `store` runs Git; only `grading` starts the grader; only the interface modules
print; hooks always exit 0.

### Hooks and runtimes

| Event | Claude Code | Codex | Does |
| --- | --- | --- | --- |
| `UserPromptSubmit` | yes | yes | Brief with the first prompt, and after a compaction |
| `PreCompact` | yes | yes | Starts the detached session job |
| `SessionEnd` | yes | yes | Starts the detached session job |

Claude Code hooks are registered in exec form (the private Python and the entry script, no shell), which works under
PowerShell as well as POSIX shells. Codex hooks are shell commands, the form Codex documents. The runtimes share
everything except the transcript reader and the hook field mapping. If no brief arrives (hooks inactive), the agent
instructions tell the agent to call `know_search` before starting a task.

### Safety properties

- **No recursion.** `KNOWLEDGE_DISABLE=1` makes every hook do nothing. The grader's own child session runs with it set.
- **The grader is isolated.** Its child session loads no user settings, no MCP servers, no slash commands and no tools,
  so a transcript cannot steer it.
- **Trust.** Notes from outside content get `trust: external`; the curator only reports them and never lets one retire a
  good note.
- **Redaction.** Secrets are scanned on write and redacted from digests. Prompt excerpts are not stored by default.
- **Reversible.** Every change to a note is a commit; no automatic action deletes.

## Reference

### Commands

Every command is a launcher `_scripts/know_<command>` and takes `--json`, `--root`, `--session`, `--runtime`, `--model`
and `--now`. `session-job` is `know_session_job`.

| Command | Does |
| --- | --- |
| `know_init` | Create the branch and worktree, or attach to an existing branch. |
| `know_write` | Save a note from JSON on standard input; revise one by including its `id`. |
| `know_search "<query>"` | Print the summaries of matching notes (logged as surfaced). |
| `know_brief --query "<text>"` | Print the session-start block; nothing if nothing is relevant. |
| `know_read <id>` | Print a full note with its version (logged as read). |
| `know_assess <id> <outcome> [reason]` | Record your own rating of a note you read. |
| `know_status <id> <status> --reason "…"` | Change a note's lifecycle status; `active` restores an `archived` note. |
| `know_report` | The funnel, grades, usage, spend and slices. |
| `know_curate [--dry-run]` | Report what the history shows; do the maintenance whose switch is on. |
| `know_reindex` | Rebuild the embedding cache. |
| `know_flush` | Commit pending event files. |
| `know_session_job --transcript FILE` | Log usage of the unread part of a transcript and grade it (what the hooks start). |
| `know_hook <event>` | Run a hook with its JSON payload on stdin; always exits 0. |
| `know_mcp` | Run the MCP server on standard input and output. |

`know_hook` and `know_mcp` are started by the runtimes, not by people: the registrations call the private Python and
`knowledge.py` directly (exec form), not these launchers. Examples:

```sh
echo '{"title": "...", "summary": "...", "type": "discovery", "confidence": "high", "body": "..."}' | _scripts/know_write
_scripts/know_search "what you are looking at"
_scripts/know_status K-20261101-7f3a archived --reason "superseded by the new build"
```

### MCP tools

Server `know`; full tool names look like `mcp__know__know_read`.

| Tool | Does |
| --- | --- |
| `know_search(query, limit)` | Return the `<project-knowledge>` block of summaries and IDs. |
| `know_read(id)` | Return the full note with its ID and version. |
| `know_write(note, idempotency_key, allow_duplicate)` | Save a note, or revise one when `note` has an `id`. |
| `know_assess(id, outcome, reason)` | Record the agent's own rating of a note it opened. |

A failing tool returns an error and logs an `operational_error` event; the server keeps running.

### Configuration

`config.toml` lives on the knowledge branch (`.agents/knowledge.d/config.toml`) and is versioned with the notes. An
invalid file is rejected with the offending key.

| Section | Controls |
| --- | --- |
| `[brief]` | When the brief is given (`trigger`, `after_compaction`), `max_items`, `token_budget`, `max_summary_tokens`. |
| `[retrieval]` | `embedding_enabled`, `embedding_model`, `min_quality`, `small_model_select` (off). |
| `[capture]` | `agent_write`, `session_extract`, `extract_status` of proposed notes. |
| `[session_job]` | Triggers, `digest_max_tokens` (default 40000), `grade_only_if_reads_or_signals`. |
| `[grader]` | `runtime` (`auto`, `claude`, `codex`, `off`), `model`, `timeout_seconds`. |
| `[git]` | `lock_timeout_seconds` (default 10: how long a command waits for the lock). `auto_commit` must stay true and `auto_push` false. |
| `[maintenance]` | One switch per curator action (all off) and the curator's thresholds. |
| `[experiment]` | `holdout_fraction` (off). |
| `[privacy]` | `store_prompt_excerpt`, `redact_secrets`. |
| `[pricing."<model>"]` | Optional USD per million tokens, for the spend estimate. Empty by default. |

The full list with defaults is in design section 18.

### Exit codes

`0` success, `1` error, `2` usage error, `3` `write` refused as a probable duplicate (add `--allow-duplicate`, or revise
the existing note by writing again with its `id`) or the installer refused without confirmation.

## Safety, privacy and cost

- **Turn everything off:** set `KNOWLEDGE_DISABLE=1` in the environment (hooks do nothing), or remove the hook entries.
- **Turn grading off:** `[grader] runtime = "off"`. The brief, search, write and reports keep working; you lose grades and
  the capture of unsaved discoveries.
- **Bound grading:** lower `[session_job] digest_max_tokens`. Grading runs only for sessions that opened a note or show a
  discovery signal.
- **What costs model tokens:** the grader (one small-model call per graded range), brief selection (off), and the curator's
  summary rewrites (off). The brief itself adds at most its token budget to a session. `know_report` shows all of it.
- **What leaves the machine:** nothing, apart from the small-model call of the runtime CLI you already use. Embeddings run
  locally.
- **Concurrent sessions** in one repository share `.agents/.state/knowledge/active-session.json`: the session of the last
  prompt wins, so events of another session may be logged under it.

## Known limits

- Only Windows has been exercised. POSIX locking, launchers, process spawning and hook command forms are untested.
- Codex has not been seen working end to end: hook trust is stored in `~/.codex/`, so a person must trust the project and
  review the hooks. The Codex grader command is unverified. See `tests/manual_smoke.md` M3.
- The curator's thresholds are untuned defaults, and the quality of grades and briefs needs real use to judge
  (`tests/manual_smoke.md` M1, M4, M5).
- The `usage` figures of the real `claude -p` output follow the documented shape; if it differs, token columns read
  unknown.

## Further reading

- The design and the contract: `_docs/project-knowledge-system-design.md` in the template repository this drop-in comes from.
  Section 13 has the output format of every command; section 18 the full default configuration.
- Manual checks that need a real runtime: `tests/manual_smoke.md` in the same repository.
