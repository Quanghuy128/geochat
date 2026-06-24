---
description: Security audit (OWASP Top 10 + STRIDE) via an independent security-reviewer
---

**cso** (Chief Security Officer) step of the GeoChat pipeline.

Scope: **$ARGUMENTS** (default: current diff / feature being worked on).

**Invoke the `security-reviewer` subagent** (independent security Checker) via the Agent tool.

Pass to it:
- Files/diff to audit (run `git diff` to determine scope).
- Feature context from `docs/loops/<feature>-STATE.md`.
- GeoChat focus areas: Supabase RLS, secret/NEXT_PUBLIC handling, auth callback, input validation.

Receive findings 🔴/🟠/🟡/🟢 + PASS/NEEDS-WORK verdict.
- 🔴/🟠 finding → return to `/build` for the Maker to fix (pass findings), then re-run cso.
- PASS → write result to STATE, proceed to `/qa` or `/ship`.

When to run: any change touching auth, RLS, migrations, user input, secrets, or API routes.
