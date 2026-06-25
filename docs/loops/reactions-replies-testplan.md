# TEST PLAN — Message Reactions + Replies (DM + Group only)

> Mirrors the 9 acceptance criteria in `docs/loops/reactions-replies-STATE.md`. Conventions
> match `dm-chat`/`group-chat` test files (mock the Supabase client module for unit tests, no
> real network; Playwright multi-tab for realtime/RLS verification). Migration under test:
> `supabase/migrations/0010_message_reactions_and_replies.sql`.

## 0. Test file map (new files dev must create)

| File | Covers |
|---|---|
| `src/lib/use-dm-message-reactions.test.ts` | load, react (upsert/replace), unreact, realtime patch, cancelled-flag race safety |
| `src/lib/use-group-message-reactions.test.ts` | same shape for group |
| `src/lib/use-dm-messages.test.ts` (extend existing) | `send()` with `replyToMessageId` param, `replyToMessageId` round-trips through `rowToDmMessage` |
| `src/lib/use-group-messages.test.ts` (extend existing) | same for group |
| `src/components/message-bubble.test.tsx` | presentational-only contract: renders reactions/quoted slots from props, makes zero Supabase calls |
| `e2e/reactions-replies.spec.ts` | full multi-tab Playwright flow — react/unreact/replace, reply + quote, RLS rejection paths, cross-boundary reply rejection |

## 1. Unit tests (Vitest) — mock Supabase client

### 1.1 `useDmMessageReactions` / `useGroupMessageReactions` (near-identical test shape; list once, run for both)

| # | Case | Assert |
|---|---|---|
| U1 | `conversationId`/`groupId = null` | `reactionsByMessageId` empty Map, no Supabase call, `ready` reflects client config only |
| U2 | Bulk load for N messages in current window | Single `select * from dm_message_reactions where message_id in (...)` call (NOT N separate queries) — assert call count = 1 regardless of message count |
| U3 | Reaction summary aggregation | Multiple raw rows for the same `message_id` with different emoji/users correctly group into `ReactionSummary[]` with accurate `count`, `reactedByMe` (compares `user_id` to `identity.userId`), and `reactorUserIds` array |
| U4 | `react(messageId, "😍")` — first time reacting | Calls `upsert({message_id, user_id, emoji}, {onConflict: "message_id,user_id"})`; local state updates optimistically BEFORE the await resolves (assert intermediate state synchronously, matching design doc's "optimistic toggle" requirement) |
| U5 | `react(messageId, "❤️")` when user already reacted "😍" on that message (AC2/edge case #3) | Same `upsert` call (not a second insert) — old "😍" pill decrements/disappears, new "❤️" pill appears in local state; **assert exactly 1 row exists** for `(message_id, user_id)` is the contract being tested at the hook layer (mock returns single row post-upsert) |
| U6 | `react(messageId, "😍")` twice with the SAME emoji | Second call is a harmless re-upsert (same value) — no duplicate row, no UI flicker (assert pill count unchanged after 2nd call resolves) |
| U7 | `unreact(messageId)` | Calls `delete().eq("message_id", messageId).eq("user_id", me)`; local state removes the pill optimistically |
| U8 | `unreact(messageId)` when no reaction exists (edge case #4) | Delete resolves with 0 rows affected and `error: null` — hook treats as no-op, does NOT surface an error to the caller |
| U9 | `react()` call rejected by RLS (no longer friend/member — edge case #1) | Optimistic local state is REVERTED back to pre-react state; hook surfaces `reactBlockedReason`-style error for caller to show via existing blocked-banner pattern |
| U10 | Emoji input exceeding 8 chars sent to `react()` (edge case #7, DB backstop) | DB CHECK violation surfaces as an error from `upsert`; hook reverts optimistic state, returns `{error}` — verifies hook does NOT pre-trim/pre-validate silently (this is the DB's job per design) |
| U11 | Realtime INSERT on `dm_message_reactions`/`group_message_reactions` for a message in my loaded window | Patches `reactionsByMessageId` for that message_id without a refetch; deduped if the row is one I just optimistically added (no double-count) |
| U12 | Realtime UPDATE (someone re-reacts, replacing their emoji) | Patches the existing reactor's emoji in place, recomputes counts for old + new emoji |
| U13 | Realtime DELETE (someone un-reacts) | Removes that reactor from the relevant `ReactionSummary`, drops the emoji's pill entirely if count reaches 0 |
| U14 | **Race: `conversationId`/`groupId` changes from X to Y before `load(X)` resolves** | Port the exact `isCancelled()` test pattern from `use-dm-messages.test.ts`/`use-group-messages.test.ts` — assert final state reflects Y, not stale X reaction data |
| U15 | Realtime channel cleanup on unmount/id change | `supabase.removeChannel` called exactly once per channel per teardown — no leaked subscriptions (mirrors existing hook test pattern) |

### 1.2 `useDmMessages` / `useGroupMessages` — extended for replies

| # | Case | Assert |
|---|---|---|
| U16 | `send(body, replyToMessageId)` | Insert payload includes `reply_to_message_id: replyToMessageId` |
| U17 | `send(body)` without reply (existing call signature, backward-compat) | Insert payload has `reply_to_message_id: null`/omitted — no regression to plain-send behavior |
| U18 | Row→domain mapping includes `replyToMessageId` | `rowToDmMessage`/group equivalent maps `reply_to_message_id` (snake_case) → `replyToMessageId` (camelCase), `null` passthrough |
| U19 | `send()` rejected by the new DB trigger (edge case #6, cross-boundary reply attempted via a stale/buggy client state) | Error surfaces through the existing draft-restore contract (`{error}` returned, caller restores draft) — same shape as existing `sendBlockedReason` error path, no new error-handling code path required at the hook level beyond passing the error through |

### 1.3 `MessageBubble` (presentational contract)

| # | Case | Assert |
|---|---|---|
| U20 | Renders with `reactionsSlot`/`quotedSlot` populated | Renders both slots' content; component itself makes zero calls to `createClient()` or any Supabase import (static import-graph assertion or runtime spy showing zero network calls during render) |
| U21 | `onLongPress` callback fires on simulated long-press/click affordance | Callback invoked with `messageId`, no internal state mutation beyond visual (controlled component) |

## 2. E2E tests (Playwright) — `e2e/reactions-replies.spec.ts`

Requires the same seeded fixtures as `dm-chat`/`group-chat` specs: `userA`/`userB` mutually
friended with an existing DM conversation + existing messages; `userA`/`userB`/`userC` in an
existing group; `userD` with no relationship to any of them (stranger, for RLS-block tests).

| # | Case | AC# | Steps / assertion |
|---|---|---|---|
| E1 | React with 👍 on a DM message, realtime visible to peer | AC1 | A opens DM thread with B → long-press/hover a message → taps 👍 → pill `[👍 1]` appears immediately (optimistic) → B, in a separate browser context with the same thread open, sees the pill within 2000ms without reload |
| E2 | Same flow for group | AC1 | A reacts 👍 on a group message → B and C (both active members, separate contexts) see the pill within 2000ms |
| E3 | Duplicate same-emoji react is a no-op | AC2 | A reacts 👍 on a message already showing A's own 👍 reaction (re-tap) → pill count does NOT increment a second time; direct REST query confirms exactly 1 row for `(message_id, userA_id)` |
| E4 | Replace reaction (different emoji) | AC2 | A has 👍 on a message → A opens picker again, selects ❤️ → 👍 pill disappears (or decrements if others also had 👍) and ❤️ pill appears → direct REST query confirms exactly 1 row for `(message_id, userA_id)`, with `emoji = '❤️'` |
| E5 | Un-react removes pill, re-un-react is no-op | AC3 | A taps own 👍 pill (toggle off) → pill disappears for A and, within 2s, for B/C watching → A taps the (now-gone) pill location again / retries unreact via direct API → no error surfaced, UI doesn't break |
| E6 | **Cross-boundary reply rejected (edge case #6) — DM** | AC6 | Via direct `supabase.from("dm_messages").insert(...)` bypassing UI: A attempts to insert a message into DM conversation X with `reply_to_message_id` pointing to a real message_id that belongs to a DIFFERENT conversation Y (also A's own DM) → INSERT is rejected by the `dm_messages_check_reply_scope` trigger (assert error, not success) |
| E7 | **Cross-boundary reply rejected (edge case #6) — group** | AC6 | Same shape: A attempts to insert into group_messages for group X with `reply_to_message_id` pointing to a message in group Y → trigger rejects |
| E8 | Reply happy path with quoted preview, realtime | AC6, AC7 | A taps "Trả lời" on B's message "Hẹn 7h tối nay nhé" → reply preview bar shows the quote → A types "Ok chốt giờ đó nha" → sends → A's bubble shows `QuotedMessagePreview` with B's text/sender → B (separate context) sees the new message with the same quoted preview within 2000ms |
| E9 | Tap quoted preview scrolls to original (in loaded history) | — (design doc 3.10) | From E8's reply bubble, tap the quoted block → view scrolls to and briefly highlights the original message bubble |
| E10 | Tap quoted preview when original is outside loaded window | — (design doc 3.10, explicitly out of auto-fetch scope) | Simulate a reply whose target is not in the currently-rendered message list (e.g. paginate/truncate) → tapping the quote shows the "Không tìm thấy tin gốc trong lịch sử đã tải" toast, does NOT trigger additional history fetch |
| E11 | Non-member cannot react/reply via REST — DM | AC4 | As `userD` (not in the DM conversation), direct REST `insert` into `dm_message_reactions` for a real message_id in A/B's conversation → rejected (RLS, 0 effect) |
| E12 | Non-member cannot react/reply via REST — group | AC4 | As `userD`, direct REST `insert` into `group_message_reactions` for a real message_id in A/B/C's group → rejected |
| E13 | Ex-friend/ex-member blocked from NEW reactions (re-check at react time) | AC5 | A and B unfriend (DM) — A's existing thread still open (stale tab) → A attempts to react to an old message → RLS rejects (re-check at react time, not at original message send time); same shape for a removed group member reacting in their stale tab |
| E14 | `anon` fully blocked on reactions | AC8 | Unauthenticated REST client attempts INSERT/SELECT on `dm_message_reactions` and `group_message_reactions` → rejected/empty for both (no `to anon` policy on either table) |
| E15 | **Realtime RLS isolation gate — reactions (mandatory, 4th-time risk)** | — (STATE risk note, Product risk notes) | As `userD` (stranger to A/B's DM and A/B/C's group), subscribe directly to `postgres_changes` on `dm_message_reactions` and `group_message_reactions` (unfiltered or filtered by the known message_id) while A reacts → assert `userD`'s subscription receives **zero** matching payloads. This is the same class of gate `group-chat-testplan.md` E6 already established for messages — do not skip; if this fails, flag as a cross-feature regression affecting all 4 prior features simultaneously, not just this one. |
| E16 | DB CHECK backstop on long/invalid emoji string | edge case #7 | Direct REST insert into `dm_message_reactions` with `emoji` = a 9+ character string → rejected by `varchar(8)`/CHECK constraint, independent of any client-side validation |
| E17 | `npm run build && npm run lint && npm run test` | AC9 | CI gate — no new errors introduced by this feature |

## 3. Trade-off / open implementation notes for dev to lock in (flag back to architect if ambiguous at build time)

1. **Upsert conflict target** (`onConflict: "message_id,user_id"`) requires the
   `dm_message_reactions_one_per_user`/`group_message_reactions_one_per_user` UNIQUE
   constraints to exist exactly as named in migration 0010 — if dev renames/changes the
   constraint, the upsert's `onConflict` string must be updated to match, or the upsert will
   silently fall back to a plain insert and violate the "replace, not duplicate" contract
   (U5/E4 would fail at that point, catching this regression).
2. **Realtime channel separation** (messages channel vs reactions channel, see PLAN §2 table)
   is a deliberate choice to avoid overloading a single channel's `.on()` chain with two
   structurally different payload shapes. If dev merges them onto one channel for convenience,
   re-verify E1/E2/E15 still pass — functionally should be equivalent, but flag the deviation
   from PLAN to the Checker for explicit sign-off rather than silently diverging.
3. **`MessageBubble` extraction is optional-but-recommended per PLAN §0** — if dev decides NOT
   to extract it (continues duplicating JSX in `dm-panel.tsx`/`group-panel.tsx` instead),
   U20/U21 become N/A and should be removed/marked skipped, but the Checker should treat this
   as a deviation from the architect's explicit recommendation and ask for justification, not
   silently accept it.
