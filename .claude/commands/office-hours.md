---
description: Step 1 of the pipeline — force-clarify feature scope with 6 questions before writing any code
---

You are at the **office-hours** step of the GeoChat pipeline (see [CLAUDE.md](../../CLAUDE.md)).

Feature to clarify: **$ARGUMENTS**

Ask up to **6 questions** to lock down scope (use AskUserQuestion). Cover:
1. What is the end-user goal of this feature? What does "done" mean?
2. Scope IN / OUT (what is explicitly NOT in this iteration).
3. Data model + DB changes (tables/columns/RLS)?
4. Important edge cases (network drop, concurrency, missing data).
5. Impact on existing features (realtime chat, identity)?
6. Acceptance criteria for the Checker to verify.

After receiving answers, write the scope summary to `docs/loops/<feature>-STATE.md`, then suggest running `/plan`.
