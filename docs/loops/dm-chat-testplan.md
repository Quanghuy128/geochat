# Test Plan — 1-on-1 Private DM Chat

> Companion file to `docs/loops/dm-chat-STATE.md` > PLAN. Written by architect, executed by dev (unit) + QA (e2e/live).
> Maps directly to the 10 acceptance criteria in `dm-chat-STATE.md` > ANALYZE > "Acceptance criteria (đo được)".
> Prerequisite for ANY live/e2e test: migration `0005_friend_requests.sql` AND `0006_dm_chat.sql` must both be applied on the real Supabase project (Studio SQL Editor). Static/unit tests do not require this.

---

## 0. Test environment notes

- Unit tests (Vitest) mock the Supabase client the same way existing tests do (check `src/lib/*.test.ts` if any exist for `use-friends`/`use-friend-requests` patterns — otherwise mock `createClient()` to return a stub with `.from()`, `.channel()`, `.removeChannel()`).
- E2E/live tests (Playwright + 2 real browser contexts/tabs, OR 2 separate Supabase test accounts) require:
  - Migrations 0005 + 0006 applied.
  - At least 2 test users with profiles (`@test_a`, `@test_b`) already `accepted` friends, and a 3rd user `@test_c` NOT friends with either.
- All live tests must be run against a Supabase project that is NOT production data (use a dedicated test project or clean up rows after, per CLAUDE.md DB safety rules — no destructive cleanup commands without WHERE).

---

## 1. Unit tests (Vitest)

### 1.1 `use-dm-conversations.test.ts`

| Case | Assertion |
|---|---|
| `findOrCreate` — no existing conversation | Calls SELECT first (no match), then INSERT; returns the new `conversationId`. |
| `findOrCreate` — existing conversation found | Calls SELECT, finds a match, returns existing `conversationId` WITHOUT calling INSERT. |
| `findOrCreate` — INSERT race (unique violation `23505`) | Mock INSERT to reject with Postgres error code `23505`; assert hook catches it, falls back to a second SELECT, and returns the conversation id from that fallback SELECT (not an error). |
| `findOrCreate` — RLS rejects INSERT (not friends) | Mock INSERT response with empty `data`/RLS error; assert hook returns `{ conversationId: null, error: "Chỉ chat riêng được với bạn bè đã kết bạn." }` (or equivalent mapped message) — NOT a generic/raw Postgres error string leaking to UI. |
| Load — maps conversation rows to `DmConversation[]` with peer username joined correctly (verify peer resolution picks `user_b_id` when `auth.uid() === user_a_id` and vice versa). |
| Load — empty list when `identity` is `null` (not logged in), no error thrown. |
| Realtime handler — INSERT event on `conversations` not involving current user is ignored (no refetch triggered). |
| Realtime handler — INSERT event on `dm_messages` for a conversation already in local list updates `lastMessageBody`/`lastMessageAt` and re-sorts that conversation to the top, without a network refetch. |
| Cleanup — unmounting the hook calls `removeChannel` for both subscribed channels (conversations + dm_messages). |

### 1.2 `use-dm-messages.test.ts`

| Case | Assertion |
|---|---|
| Load — fetches up to 100 messages for given `conversationId`, ordered ascending by `created_at` (matches `useMessages` convention). |
| `send()` — empty/whitespace-only body is a no-op (no Supabase `.insert()` call), matching `useMessages.send` behavior (edge case #4). |
| `send()` — trims body before insert. |
| `send()` — success: does NOT optimistically append to local `messages` state (no temp local message) — matches `ChatPanel`/`useMessages` non-optimistic convention. |
| `send()` — RLS rejection response (simulated unfriended state) returns `{ error: <message> }` AND sets `sendBlockedReason` to `"unfriended"` reactively. |
| `send()` — network/generic error returns `{ error: <message> }` without mutating `sendBlockedReason`. |
| `canSend`/`sendBlockedReason` — initial friend-status check: when no `accepted` friend_requests row exists between current user and peer, `canSend=false` and `sendBlockedReason="unfriended"` immediately on mount (before any send attempt). |
| Realtime handler — dedups incoming INSERT by `id` (an event for a message id already in local state does not duplicate it) — matches `useMessages` dedup pattern. |
| Realtime channel — subscribes with filter `conversation_id=eq.<id>` (assert the `.on("postgres_changes", {...filter...})` call args include the correct filter string). |
| Changing `conversationId` prop — old channel is removed and a new channel for the new id is subscribed (no leaked old subscription). |
| Cleanup — unmount removes the channel. |

### 1.3 Component tests (if component-level testing is in scope for this repo's Vitest setup — check existing patterns first; if none exist for `ChatPanel`/`FriendsPanel`, skip and rely on e2e only, do not introduce a new testing pattern unilaterally)

| Case | Assertion |
|---|---|
| `DmThread` — renders blocked-send banner (3.11) when `sendBlockedReason === "unfriended"`, with input `disabled`. |
| `DmThread` — input is NOT cleared when `send()` returns an error (edge case #11) — draft text persists for retry. |
| `DmConversationRow` — last message preview is prefixed with "Bạn: " when `lastMessageMine === true`, no prefix otherwise. |
| `ChatTabs` — switching tabs updates `activeTab` state and unmounts the inactive panel (per PLAN's "unmount on tab switch" decision) — assert via a mount/unmount spy or absence of DOM nodes for the inactive tab. |

---

## 2. E2E / Live tests (Playwright + 2 real accounts)

> These map directly to the 10 acceptance criteria. Run AFTER migrations 0005+0006 are applied to a real (non-prod) Supabase project.

### AC1 — Idempotent conversation creation
1. Login as `@test_a` (friend of `@test_b`, `accepted`).
2. Open Friends panel, tap "Nhắn tin" on `@test_b`'s row.
3. Assert: DM Thread opens for `@test_b` (empty state if first time).
4. Note the conversation (e.g. via network inspection of the `conversations` row id, or count rows directly in DB — read-only `SELECT count(*)` check, no destructive query).
5. Go back to inbox, open `@test_b` thread again (same session) AND/OR login as `@test_b` in a second browser context, open DM with `@test_a` from their side.
6. **Assert**: exactly 1 row exists in `conversations` for the pair `(test_a, test_b)` after both opens — verified via a `select count(*)` read-only query.

### AC2 — Realtime delivery within 2 seconds
1. Two browser tabs/contexts: `@test_a` and `@test_b`, both with the same DM thread open.
2. `@test_a` sends a message.
3. **Assert**: message appears in `@test_b`'s thread within 2 seconds, without manual reload (poll/assert via Playwright's auto-waiting `expect(locator).toBeVisible({ timeout: 2000 })`).

### AC3 — RLS blocks third party (`@test_c`, not a friend of either)
1. As `@test_c`, attempt direct REST call to Supabase (e.g. via `fetch` with `@test_c`'s JWT) to `SELECT * FROM dm_messages WHERE conversation_id = <A-B's conversation id>`.
2. **Assert**: response returns 0 rows (RLS silently filters, no error needed — Postgrest behavior).
3. Attempt `INSERT INTO dm_messages` into that conversation as `@test_c`.
4. **Assert**: insert is rejected (RLS violation / 0 rows returned from `.select()` after insert).
5. **Assert (Realtime)**: subscribe `@test_c` to a channel listening to `dm_messages` INSERT with filter on A-B's `conversation_id` — confirm `@test_c` does NOT receive the payload when `@test_a` sends a message to `@test_b`. **This is the critical, previously-unverified risk inherited from the friends feature ("RLS-enforced postgres_changes") — must pass before ship.**

### AC4 — Blocked: open DM with non-friend
1. As `@test_a`, attempt to call `findOrCreate`/insert a conversation with a user who is NOT an accepted friend (e.g. via direct Supabase client call bypassing the UI, simulating a manipulated client state — since the UI itself won't expose a "Nhắn tin" button for non-friends).
2. **Assert**: INSERT rejected by RLS `conversations_insert_friends_only`. UI (if reachable via 3.10 error state) shows a clear error, no conversation row created.

### AC5 — Empty/whitespace message blocked
1. UI: attempt to send an empty string or whitespace-only string in DM Thread input.
2. **Assert**: no network request fires (client-side guard), `[Gửi]` effectively no-ops.
3. Bypass UI: directly call Supabase insert with `body: "   "`.
4. **Assert**: DB CHECK constraint rejects it (`char_length(body) between 1 and 2000` — whitespace-only string of length >=1 still passes the CHECK numerically, so this specifically tests that the CLIENT trim+guard is the real defense for whitespace; the DB CHECK is the safety net for the LENGTH bound, not whitespace semantics — document this distinction in the test assertion, do not assume CHECK rejects pure whitespace).

### AC6 — Over-length message blocked
1. UI: attempt to send a message with `body.length > 2000` characters.
2. **Assert**: client-side blocks before DB call (if client validation implemented) OR DB CHECK constraint rejects insert with length > 2000.
3. Bypass UI: directly call Supabase insert with a 2001-character string.
4. **Assert**: insert rejected by CHECK constraint.

### AC7 — Unfriend blocks new sends in old conversation
1. `@test_a` and `@test_b` are friends with an existing DM conversation containing history.
2. `@test_a` unfriends `@test_b` (via Friends panel — `friend_requests.status` transitions `accepted` → `cancelled`).
3. `@test_a` opens the existing DM thread with `@test_b` (history should still be visible — see AC-adjacent check below).
4. **Assert**: thread shows existing message history (THINK #3 — old history preserved).
5. `@test_a` attempts to send a NEW message.
6. **Assert**: insert is rejected by RLS `dm_messages_insert_member_and_friends` (re-check at send time) — UI shows blocked-send banner (3.11), message NOT persisted.
7. Repeat from `@test_b`'s side (symmetric — either party unfriending blocks both from sending, since friend status is symmetric in the schema).

### AC8 — Build/lint/test pass
1. `npm run build && npm run lint && npm run test` — all pass with no new errors introduced by this feature's files.

### AC9 — Anon cannot read/write DM data
1. Using an anonymous (unauthenticated) Supabase client (`anon` key, no session), attempt `SELECT * FROM conversations` and `SELECT * FROM dm_messages`.
2. **Assert**: 0 rows returned (RLS policies are `to authenticated` only — `anon` role has no matching policy, contrast explicitly with `messages` table which DOES allow anon SELECT — this is the key behavioral difference to verify).
3. Attempt anon INSERT into both tables.
4. **Assert**: rejected.

### AC10 — Inbox shows only own conversations
1. `@test_a` has DMs with `@test_b` and `@test_d` (assume both accepted friends with separate conversations).
2. `@test_c` has a DM with `@test_d` (unrelated to `@test_a`).
3. Login as `@test_a`, open "Tin nhắn" tab.
4. **Assert**: inbox shows exactly 2 rows (`@test_b`, `@test_d`), does NOT show `@test_c`'s conversation with `@test_d` even though `@test_d` is shared.

---

## 3. Additional edge-case e2e checks (from STATE edge cases #2, #7, #8, #11)

| Edge case | Test |
|---|---|
| #2 Self-DM | Attempt `findOrCreate`/insert with `user_a_id === user_b_id` directly via client call — assert CHECK constraint `conversations_no_self` rejects it. |
| #7 Concurrent create race | Fire two near-simultaneous `findOrCreate(peerId)` calls (e.g. `Promise.all` from two separate Supabase client instances representing `@test_a` and `@test_b` both initiating) — assert exactly 1 conversation row exists afterward, both calls resolve to the SAME conversation id. |
| #8 Reopen routes to same conversation | Open DM with `@test_b` from Friends panel, send a message, navigate back to inbox, tap the `@test_b` row — assert thread shows the same message (same conversation, not a duplicate). |
| #11 Network drop on send | Simulate by mocking the Supabase insert call to reject (e.g. Playwright route interception to fail the REST call) — assert draft text remains in the input field after failure (not cleared), an inline error appears, and no message row was created. |

---

## 4. QA gate — explicit go/no-go before `/ship`

The following MUST be verified live (not just unit-mocked) before this feature ships, per PLAN's risk notes:

- [ ] Migrations `0005_friend_requests.sql` and `0006_dm_chat.sql` both applied successfully on the target Supabase project, no errors.
- [ ] AC3 step 5 (Realtime RLS isolation — `@test_c` does not receive postgres_changes payload for a conversation they are not a member of) — **PASS required, this is the highest-risk unverified assumption inherited from the friends feature.**
- [ ] AC2 (2-second realtime delivery) verified with 2 real browser tabs, not mocked.
- [ ] AC7 (unfriend blocks new sends, re-checked at send time, not just creation time) verified live with a real unfriend action followed by a real send attempt.
- [ ] AC9 (anon fully blocked) verified with a real anon Supabase client (no session), confirming the explicit contrast with the `messages` table's open-anon policy.
- [ ] `npm run build && npm run lint && npm run test` all green.
