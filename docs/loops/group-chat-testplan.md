# TEST PLAN — Group Chat

> Mirrors acceptance criteria in `docs/loops/group-chat-STATE.md` (10 ACs). Each test case
> below references the AC# it verifies. Conventions match `dm-chat`/`friends` test files
> (`src/lib/use-dm-conversations.test.ts`, `src/lib/use-dm-messages.test.ts`,
> `src/lib/use-send-friend-request.test.ts`) — mock the Supabase client module, assert on
> calls made and state transitions, no real network in unit tests.

## 0. Test file map (new files dev must create)

| File | Covers |
|---|---|
| `src/lib/use-group-conversations.test.ts` | inbox load, realtime append/refetch, `createGroup` race/error paths |
| `src/lib/use-group-messages.test.ts` | thread load, send, blocked-send detection, **cancelled-flag race safety** |
| `src/lib/use-group-members.test.ts` | member list load, add/remove/leave, cap-reached error surface, realtime membership update |
| `e2e/group-chat.spec.ts` | full multi-tab Playwright flow (create → send → realtime receive → add → remove → leave) |

## 1. Unit tests (Vitest) — mock Supabase client

### 1.1 `useGroupConversations` (inbox)

| # | Case | Assert |
|---|---|---|
| U1 | `identity = null` | `groups = []`, no Supabase call made, `ready` reflects client config only |
| U2 | Load with 2 groups, joins last message + sender username | Each `GroupConversation` has `lastMessageSenderUsername`/`lastMessageMine` correctly derived; sorted by `lastMessageAt` desc |
| U3 | Group with 0 messages | `lastMessageBody = null`, `lastMessageAt` falls back to `group_conversations.created_at` |
| U4 | `createGroup(name, memberIds)` happy path | Inserts `group_conversations` (creator_id = me), then inserts N+1 `group_members` rows (creator + each memberId), all `left_at = null`; returns `{ groupId, error: null }` |
| U5 | `createGroup("", [...])` | Client-side validation rejects before any Supabase call (name empty after trim) |
| U6 | `createGroup("name", [])` | Client-side validation rejects before any Supabase call (zero members — THINK #11) |
| U7 | `createGroup` — DB rejects one member insert (friend-gating fails for 1 of N members) | Whole creation surfaces as error; assert dev's chosen all-or-nothing semantics (see Trade-off #1 below) — test locks in whichever behavior is implemented |
| U8 | Realtime INSERT on `group_members` for a brand-new group I'm now part of | Triggers refetch; new group appears in `groups` list without manual reload |
| U9 | Realtime INSERT on `group_messages` for an existing group in my list | Updates that group's `lastMessageBody`/`lastMessageAt`/`lastMessageSenderUsername` in place, re-sorts list, **without** a full refetch (parallel to `useDmConversations` INSERT-on-dm_messages handler) |
| U10 | Hook unmounts mid-flight (`createGroup` awaiting) | No `setState` after unmount — cancelled-flag pattern verified (same class of fix as `use-dm-messages.ts` review fix) |

### 1.2 `useGroupMessages` (thread) — **must ship with cancelled-flag from day one**

| # | Case | Assert |
|---|---|---|
| U11 | `groupId = null` | `messages = []`, `canSend = true`, `sendBlockedReason = null`, no Supabase call |
| U12 | Load 100 most recent messages, ascending order | `select().eq("group_id", id).order("created_at",{ascending:true}).limit(100)` called exactly once |
| U13 | Each message includes `senderUsername` (joined) | Distinct from DM — verify join query / profiles lookup happens and is attached per-message |
| U14 | **Race: `groupId` changes from X to Y before `load(X)` resolves** | Using a manually-resolved promise mock: start `load(X)`, switch `groupId` to Y (unmounts/cleans up X's effect), resolve X's pending Supabase calls — assert `messages`/`canSend`/`sendBlockedReason` reflect **Y**, not stale X data (directly port the `isCancelled()` test pattern from `use-dm-messages.test.ts`) |
| U15 | `send("hello")` success | Inserts into `group_messages` with `sender_id = me`, no optimistic append (state only updates via realtime echo) |
| U16 | `send("")` / `send("   ")` | No-op, no Supabase call, returns `{ error: null }` |
| U17 | `send()` when RLS rejects (removed mid-session) | `canSend` flips to `false`, `sendBlockedReason = "removed"`, draft-restore contract returns `{ error: <message> }` for caller to restore input (parallel to DM edge case #11) |
| U18 | Initial membership hint check on load (mirrors DM's friend-status hint) | Queries `group_members` for `(group_id, user_id=me)` with `left_at is null`; sets `canSend=false`/`sendBlockedReason="removed"` if no active row found, even before any send attempt |
| U19 | Realtime INSERT on `group_messages` filtered by `group_id` | Dedupes by `id` (matches DM's `prev.some(m => m.id === incoming.id)` guard) |
| U20 | Realtime UPDATE on `group_members` where the row is mine and `left_at` transitions null→timestamp | Reactively flips `canSend=false`/`sendBlockedReason="removed"` without requiring a failed send first (Interaction Notes section 5 requirement) |

### 1.3 `useGroupMembers`

| # | Case | Assert |
|---|---|---|
| U21 | Load members for a group I'm active in | Returns only `left_at is null` rows, includes `isCreator` per row (derived from `group_conversations.creator_id`), `isCreator: boolean` flag for the *viewer* |
| U22 | `addMembers([friendId1, friendId2])` as creator, both are accepted friends | Each becomes an `insert`/`update` (re-join path) on `group_members` with `left_at: null`; returns `{ error: null }` |
| U23 | `addMembers([strangerId])` — not a friend of creator | RLS rejects; hook surfaces `{ error: "..." }`, no partial state mutation client-side beyond what DB confirms |
| U24 | `addMembers` exceeding 50-member cap | DB trigger raises; hook maps to `{ error: "Nhóm đã đầy, không thể thêm." }` (or equivalent), no client-side optimistic increment |
| U25 | `removeMember(userId)` as creator on a non-creator member | `update group_members set left_at = now() where group_id=X and user_id=userId`; on success, member disappears from `members` list |
| U26 | `removeMember` attempted by a non-creator | RLS rejects (`using` clause requires creator or self); hook surfaces error; **client should not even expose this control to non-creators** (UI-level redundant defense, test both layers) |
| U27 | `leaveGroup()` as a regular member | `update group_members set left_at = now() where group_id=X and user_id=me`; on success, calls `onLeft()` |
| U28 | `leaveGroup()` as creator | Allowed (THINK #9 — orphaning accepted), no special-case rejection |
| U29 | Re-add an ex-member (creator re-adds someone who previously left) | `update ... set left_at = null where (group_id,user_id)` — NOT a fresh insert (primary key already exists); re-checks friend-gating at this update (re-join must still pass creator-friend check, not grandfathered) |
| U29b | **Post-review fix**: `addMembers([id])` where `id` is already an ACTIVE member (per already-loaded `members` state) | Returns `{ error: "đã là thành viên" }` immediately — no UPDATE/INSERT call made at all (previously this silently no-op'd via the UPDATE-to-same-value path and returned `error: null` as if a genuine add happened, masking edge case #4 / AC5 at the hook layer; not reachable via UI since `AddMemberPicker` pre-filters, but must be correct at the hook/API layer) |
| U30 | Realtime UPDATE on `group_members` (someone else removed/left while I have Member List open) | That member's row disappears from `members` live |
| U31 | Realtime INSERT/UPDATE on `group_members` adding a new member while I have Member List open | New member's row appears live |

### 1.4 Cross-cutting

| # | Case | Assert |
|---|---|---|
| U32 | `not exists` guard pattern: hooks gracefully no-op when Supabase isn't configured | `ready = false`, no throw, empty/default state (mirrors every existing hook's null-safety contract) |
| U33 | Group name validation (client-side, mirrors `name` CHECK) | Empty/whitespace-only rejected before DB call; name >100 chars rejected client-side (matches DB `char_length(btrim(name)) between 1 and 100`) |

## 2. E2E tests (Playwright) — `e2e/group-chat.spec.ts`

Requires 3 seeded test accounts already mutually-or-partially friended via existing
`friend_requests` fixtures (reuse seeding approach from `dm-chat`/`friends` e2e specs):
- `userA` (will be creator), `userB`, `userC` — A is friends with B and C; **B and C are
  NOT friends with each other** (this is the key scenario THINK #1 must prove out).
- `userD` — friends with nobody (used for the "stranger cannot join/read" tests).

| # | Case | AC# | Steps / assertion |
|---|---|---|---|
| E1 | Create group with valid name + 2 members | AC1 | A logs in → Nhóm tab → "+ Tạo nhóm" → name "Đi Đà Lạt", select B + C → submit → lands on Group Thread → B and C, in their own sessions/tabs, see "Đi Đà Lạt" appear in their Group Inbox within a few seconds (poll/reload acceptable) |
| E2 | Empty/whitespace name blocked | AC2 | Submit with name = "" and name = "   " → button stays disabled / inline error shown → assert **no network request fires** (intercept route, assert zero POST to `group_conversations`) |
| E3 | DB-level CHECK as defense-in-depth | AC2 | Bypass client validation via direct `supabase.from("group_conversations").insert({name: ""})` in a test script (not through UI) → expect DB error (CHECK constraint violation) |
| E4 | Realtime message delivery within 2s | AC3 | A sends a message in "Đi Đà Lạt" thread (open in A's tab) while B has the same thread open in a second browser context → assert B's UI shows the new bubble within 2000ms, no manual reload |
| E5 | Non-member cannot read via REST directly | AC4 | As `userD` (not a member), call `supabase.from("group_messages").select("*").eq("group_id", groupId)` directly (bypassing UI) → assert empty result set (RLS blocks, not just UI hiding) |
| E6 | Non-member cannot read via Realtime payload | AC4 | As `userD`, subscribe to `postgres_changes` on `group_messages` filtered by the group's id (or unfiltered, checking received rows) while A sends a message → assert `userD`'s subscription receives **zero** matching payloads — this is the **highest-priority gate** per STATE's repeated risk note; do not skip |
| E7 | Duplicate add blocked | AC5 | Creator (A) attempts to add `userB` who is already an active member → UI shows them already in the filtered "not yet in group" list (excluded from picker) AND, if forced via direct API call, primary-key/RLS update path produces a clear error, not a duplicate row |
| E8 | Member self-leave removes inbox entry, blocks new sends, preserves history | AC6 | B opens Member List → "Rời nhóm" → confirms → B's Group Inbox no longer lists "Đi Đà Lạt"; B reopens the (now stale) thread link directly (if reachable) → sees blocked-send banner, history still visible; A and C still see B's old messages and can still chat normally |
| E9 | Removed member loses send ability immediately | AC7 | A removes C via Member List → C's open thread (if already on screen) flips to blocked-send state on next send attempt or next realtime membership update → C's direct `insert` into `group_messages` for that group is RLS-rejected |
| E10 | `anon` fully blocked | AC8 | Unauthenticated REST client attempts SELECT and INSERT on `group_conversations`, `group_members`, `group_messages` → all rejected/empty (no `to anon` policy exists on any of the 3 tables) |
| E11 | Member list shows only current members | AC9 | After E8 (B left) and E9 (C removed), A's Member List for "Đi Đà Lạt" shows only A — B and C absent despite their `group_members` rows still existing (soft-deleted via `left_at`) |
| E12 | Creator-only controls hidden from non-creator | — (supports AC9/AC7 architecture) | B (before leaving), viewing Member List, does NOT see `[Xóa]` next to A or C, and does NOT see "+ Thêm thành viên" |
| E13 | 50-member cap enforced | — (Edge case #5) | Seed a group at 49 active members; creator attempts to add 2 more in one action → UI caps selection at 1 / shows "Đã đạt giới hạn"; if forced via direct API to insert the 50th and 51st simultaneously (two parallel requests), assert exactly one succeeds and the other receives the trigger's exception |
| E14 | Friend-gating: creator can add a friend who is a stranger to existing members | AC1 / THINK #1 | A creates group with B; A later adds C (C is A's friend, but C and B are NOT friends with each other) → C is added successfully; B and C can now both message in the group despite not being mutual friends — this is the **core privacy-model assertion** for the whole feature |
| E15 | Non-creator cannot add or remove members via direct API | — | As B (non-creator, still active), call `group_members` insert/update directly bypassing UI → RLS rejects |
| E16 | `npm run build && npm run lint && npm run test` | AC10 | CI gate — no new errors introduced by this feature |
| E17 | **Post-review fix (migration 0009): ex-member cannot see members who joined AFTER they left** | — (architect NEEDS-WORK #1) | A creates group with B; B leaves (`left_at = t1`); A later adds C at `t2 > t1` (C's `joined_at = t2`). As B, `select * from group_members where group_id = groupId` directly (bypassing UI) → assert B's row and A's row (joined before t1) are visible, but **C's row is NOT visible** to B (joined after B's own `left_at`). As A (still active, `left_at is null`), the same query returns ALL rows including C — active members are unaffected by the tightened policy. |

> **E17 supersedes the unbounded-visibility behavior previously implied by Trade-off #3 below**
> — see updated note in mục 3 for the corrected scope of what ex-members can/cannot see.

## 3. Trade-off / open implementation decisions for dev to lock in (flag back to architect if ambiguous at build time)

1. **Atomicity of group creation** (group_conversations + N member inserts): no Postgres
   transaction is exposed through the Supabase JS client across multiple `.insert()` calls
   by default. Recommend implementing `createGroup` as a **Postgres RPC function**
   (`create_group(name text, member_ids uuid[])`, `security invoker`, wraps the inserts in
   one transaction) rather than sequential client-side inserts — avoids a partial-failure
   state (group created but 0 members, or some members added and others rejected
   mid-sequence). This was NOT in the original migration scope (no RPC included in
   0007) — **dev must add this RPC in a follow-up migration (0008) or inline in 0007
   revision**, OR accept sequential inserts with explicit client-side rollback-by-delete-row
   on partial failure (more error-prone, not recommended). Architect default: **add the RPC**,
   flagging this as a gap in 0007 that build phase must close before `createGroup` can be
   correctly atomic.
2. **U7's exact behavior** (one of N initial members fails friend-gating) depends on whether
   the RPC above is implemented as all-or-nothing (transaction rollback) — strongly preferred
   — or best-effort. Lock this in at build time and update this test case description to
   match, do not leave ambiguous.
3. **Ex-member's ability to see `group_conversations.name`/`group_members` (other rows) after
   leaving**: per the migration's RLS design (`group_conversations`/`group_members` SELECT
   policies gate on "ever had a row", not "currently active"), an ex-member retains read
   access to group name and a **snapshot of the historical membership list** (including
   other ex-members) — only `group_messages` INSERT and the ability to be counted toward the
   50-cap are truly cut off. This is intentionally permissive for simplicity (avoids needing
   a separate "frozen snapshot" mechanism) — flag to QA/Checker as an explicit accepted
   trade-off, not a bug, but confirm it doesn't violate any unstated privacy expectation.

   **UPDATE (post-review fix, migration `0009_group_members_visibility_fix.sql`)**: the
   original `group_members_select_ever_member` policy (0007) had NO time-bound — an
   ex-member's visibility into `group_members` rows kept growing forever as new members
   joined AFTER the ex-member had already left (architect NEEDS-WORK #1 — broader leak than
   the "snapshot at departure" intent described above). Fixed in 0009: an ex-member viewer
   (`left_at is not null` on their OWN row) can only see OTHER members whose `joined_at <=`
   the viewer's own `left_at` (i.e. present while the viewer was still around) — this makes
   the "historical membership list" an actual bounded **snapshot at the time of departure**,
   not a live-growing view. Active viewers (`left_at is null`) are unaffected — they still
   see all current members, exactly as before. The viewer's own row is always visible
   regardless. See E17 above for the test case; see 0009's migration comments for the exact
   policy SQL and reversibility (rollback restores the original unbounded 0007 policy text).
