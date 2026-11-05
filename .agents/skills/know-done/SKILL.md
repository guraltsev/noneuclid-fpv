---
name: know-done
description: Wrap up the session for the project knowledge system. Use when the user says they are done, wants to wrap up, or types /know-done (Claude Code) or $know-done (Codex).
---

The user is finishing this conversation. Do these steps in order, without asking:

1. Save each non-obvious, reusable discovery of this session that you have not saved yet with `mcp__know__know_write`
   (evidence and uncertainty recorded, nothing invented).
2. For each note you opened, call `mcp__know__know_assess` once if you have not yet, with an outcome and a one-line reason.
3. Run `_scripts/know_session_job` (no arguments; the launcher also works from a Windows shell). It has a small model review the
   unread part of this session and save what is still missing as candidate notes.
4. Reply with one short summary: notes saved, notes rated, and what the job reported.
