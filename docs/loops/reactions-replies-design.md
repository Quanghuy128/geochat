# DESIGN — Message Reactions + Replies (DM + Group only)

> Input: `docs/loops/reactions-replies-STATE.md` (ANALYZE + THINK locked). Scope = DM (`dm-panel.tsx`
> → `DmThread`) and Group (`group-panel.tsx` → `GroupThread`) only. Global chat excluded.
> Visual conventions matched against the actual code in `src/components/dm-panel.tsx` and
> `src/components/group-panel.tsx` — note: despite CLAUDE.md mentioning shadcn/ui, the codebase
> as built has **no shadcn primitives installed** (`src/components/ui/` only contains
> `states.tsx`, hand-rolled Tailwind). This design follows the hand-rolled Tailwind pattern
> actually in use (`rounded-full`/`rounded-xl`/`rounded-2xl`, `border-zinc-200 dark:border-zinc-800`,
> `bg-blue-600` for own/primary actions, Vietnamese copy) rather than assuming shadcn components
> exist. Open Design Question #6 flags this explicitly for the architect.

---

## 1. User Journey

**Happy path — react to a message:**

1. User is in a DM thread or group thread, scrolled through message history.
2. User long-presses (mobile) or hovers-then-clicks a small affordance (desktop) on a message
   bubble — own or someone else's. No reaction button is visible by default (per THINK #8).
3. A compact emoji picker pops up anchored to that message: a quick-pick row of common emoji
   (👍 ❤️ 😂 😮 😢 🙏 — UI convenience shortcut, NOT a DB whitelist, free input still applies)
   plus a "+" / "Khác…" affordance that opens a free-text emoji input.
4. User taps an emoji (quick-pick) or types/pastes one and confirms (free input path).
5. Picker closes immediately (optimistic). A reaction pill appears under the message: `[😍 1]`.
   If user already had a different reaction on this message, the old pill's count decrements by
   1 (or the pill disappears if it was their only reactor) and the new pill appears/increments —
   Messenger-style replace, no flicker if old and new pill are the same emoji.
6. Other members in the same conversation see the same pill update within ~2s via Realtime, no
   reload (matches existing dm/group message latency pattern).
7. User taps an existing reaction pill (not to react, but to inspect) → a small popover/sheet
   opens showing the list of usernames who used that emoji (e.g. "@minh, @lan đã react 😍").
8. User taps a pill that is their OWN reaction → tapping it again (one tap, not long-press) is the
   fast path to un-react (toggle off), consistent with Messenger; long-press still opens the full
   picker if they want to switch emoji instead of removing it. *(See Open Design Question #1 —
   single-tap-pill semantics need explicit confirmation.)*

**Happy path — reply to a message:**

1. User long-presses (or the same picker surface) reveals a row of two actions: emoji picker
   trigger AND a "Trả lời" button (per THINK #8 — dedicated button, no swipe).
2. User taps "Trả lời" → the action sheet/picker closes, and a reply-preview bar appears pinned
   directly above the composer input, showing a one-line quote of the original message (sender +
   truncated body) and an `[×]` to cancel the reply.
3. User types their reply text in the normal input and taps "Gửi" (or presses Enter) as usual.
4. On send, the reply-preview bar clears, input clears, and the new message appears in the thread
   with an inline quoted-preview block (sender + truncated body of the original) stacked above the
   message's own bubble content.
5. Any member viewing the thread (including the reply preview) can tap the quoted-preview block
   inside the reply to jump/scroll to the original message in the currently loaded history. If the
   original message is found in the DOM, the view scrolls to it and briefly highlights it
   (flash background). If NOT currently loaded/visible (e.g. scrolled out of the loaded window),
   show a brief inline toast/feedback "Không tìm thấy tin gốc trong lịch sử đã tải" — per STATE
   scope, NOT required to fetch additional history to find it.

**Blocked path — no longer a member:**

1. User who has left a group / unfriended in a DM still has the thread open (stale tab) and tries
   to react or reply.
2. The action is attempted, RLS rejects it server-side. UI shows the same blocked-state pattern
   already used for sending messages (`sendBlockedReason` banner: "Bạn không còn là thành viên
   nhóm này…" / "Bạn không còn là bạn bè…") — reactions/replies share this existing blocked state,
   no new banner copy needed, see Interaction Notes.

---

## 2. Screen Inventory

| # | Screen / surface | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **Message Action Sheet** (emoji quick-pick + "Trả lời" button) | Long-press (mobile) or click affordance (desktop) on any message bubble in DmThread/GroupThread | Tap emoji (commits reaction, closes) / tap "Trả lời" (opens reply mode, closes) / tap outside or `[×]` (dismiss, no-op) |
| 2 | **Free Emoji Input** (sub-state of Action Sheet) | Tap "+" / "Khác…" inside Action Sheet | Confirm (submits typed emoji) / Cancel (back to Action Sheet) |
| 3 | **Reaction Pills Row** (on message bubble, persistent) | Renders automatically once a message has ≥1 reaction | Tap pill → opens Reactor List Popover; tap own pill → toggle un-react |
| 4 | **Reactor List Popover/Sheet** | Tap any reaction pill | Tap outside / `[×]` / swipe down (mobile sheet) |
| 5 | **Reply Preview Bar** (composer, transient) | Tap "Trả lời" in Action Sheet | Send message (clears) / tap `[×]` (cancel reply, clears) |
| 6 | **Quoted Message Preview** (inside a sent reply bubble, persistent) | Renders automatically on any message that has `reply_to_message_id` | Tap quoted block → scroll-to-original (in-place, not a separate screen) |
| 7 | **Blocked-action feedback** (reuses existing banner) | React/reply attempt while `sendBlockedReason !== null` | N/A — banner is already persistent while blocked, per existing pattern |

---

## 3. ASCII Wireframes

### 3.1 Message bubble — no reactions, default state (baseline, unchanged visually)

```
┌────────────────────────────────────────┐
│ @minh · 14:02                           │
│ ┌──────────────────────────────┐        │
│ │ Hẹn 7h tối nay nhé             │        │
│ └──────────────────────────────┘        │
└────────────────────────────────────────┘
  ↑ long-press / hover anywhere on bubble → opens Action Sheet (3.3)
```

### 3.2 Message bubble — with 1-3 reaction pills

```
┌────────────────────────────────────────┐
│ @minh · 14:02                           │
│ ┌──────────────────────────────┐        │
│ │ Hẹn 7h tối nay nhé             │        │
│ └──────────────────────────────┘        │
│  [😍 2] [👍 1] [+]                       │
│   ↑ tap → Reactor popover (3.5)         │
│           [+] tap → reopen Action Sheet │
└────────────────────────────────────────┘
```
- Own reaction pill rendered with a highlighted ring/border to distinguish "this is mine":
```
  [😍·2] (ring-blue-500 if mine reacted 😍) [👍 1]
```

### 3.3 Message bubble — many distinct emoji types (no display limit, per THINK #9)

```
┌────────────────────────────────────────┐
│ @lan · 14:05                            │
│ ┌──────────────────────────────┐        │
│ │ Ai đi muộn nữa thì ở nhà 😤    │        │
│ └──────────────────────────────┘        │
│  [😂 5] [👍 3] [😮 2] [❤️ 1] [🙏 1] [+]  │
│   ← wraps to 2nd line if pane is narrow→ │
│  [😢 1] [🔥 1]                           │
└────────────────────────────────────────┘
```
Pills wrap (flex-wrap) onto multiple lines rather than truncating with "+N more" — consistent
with THINK #9 ("no limit at MVP").

### 3.4 Action Sheet — opened via long-press/tap on a message

```
            ┌───────────────────────────────┐
            │  👍   ❤️   😂   😮   😢   🙏   │  ← quick-pick row (UI convenience,
            │                          [+]  │     not a DB whitelist)
            ├───────────────────────────────┤
            │  [ Trả lời ]                  │  ← dedicated reply button
            └───────────────────────────────┘
┌────────────────────────────────────────┐
│ @minh · 14:02                           │
│ ┌──────────────────────────────┐        │
│ │ Hẹn 7h tối nay nhé             │ ◄──── │  anchor message (dimmed/highlighted
│ └──────────────────────────────┘        │  background while sheet is open)
└────────────────────────────────────────┘
        ↑ tap outside sheet → dismiss, no-op
```
Mobile: renders as a bottom sheet (full-width, slides up from bottom, dark overlay behind).
Desktop/wide pane: renders as a small popover anchored just above/below the bubble.

### 3.5 Free Emoji Input — sub-state after tapping "+"

```
            ┌───────────────────────────────┐
            │  ( 😀 dán hoặc gõ emoji…    )  │  ← free text input, emoji-only
            │                    [Hủy] [OK] │     soft-validated client-side
            └───────────────────────────────┘
```
- Input accepts paste/emoji-keyboard input. Client-side soft check: reject if resulting string
  looks like plain ASCII text (no emoji codepoint detected) — show inline `⚠ Vui lòng nhập emoji`
  without blocking submission entirely if detection is ambiguous (DB CHECK ≤8 chars is the real
  backstop, per STATE edge case #7).
- `[OK]` disabled while input is empty.

### 3.6 Reactor List Popover — opened by tapping a reaction pill

```
┌────────────────────────────────────────┐
│ @minh · 14:02                           │
│ ┌──────────────────────────────┐        │
│ │ Hẹn 7h tối nay nhé             │        │
│ └──────────────────────────────┘        │
│  [😍 2] [👍 1] [+]                       │
│   └──┬──┘                                │
│      ▼                                   │
│  ┌─────────────────────┐                 │
│  │ 😍 (2)               │                 │
│  │ ─────────────────── │                 │
│  │ @lan                 │                 │
│  │ @huy                 │                 │
│  └─────────────────────┘                 │
└────────────────────────────────────────┘
```
Mobile: bottom sheet listing avatars/usernames (same `EmptyState`/list row visual language as
`MemberRow` in group-panel.tsx). Desktop: small popover card anchored to the pill.

### 3.7 Composer — Reply Preview Bar active

```
│                                          │
│  (rest of thread above, unchanged)      │
│                                          │
├──────────────────────────────────────────┤
│ ┃ Trả lời @minh                    [×]  │  ← reply preview bar, sits ABOVE input
│ ┃ "Hẹn 7h tối nay nhé"                  │     left accent bar (border-l-2 blue),
├──────────────────────────────────────────┤     truncated quote, cancel button
│ ( Nhập tin nhắn… )              [ Gửi ] │  ← unchanged input row
└──────────────────────────────────────────┘
```
- Tapping `[×]` clears reply mode, returns composer to normal state (3.8 baseline), draft text
  in the input is preserved (not cleared) — only the reply target is cleared.
- If user taps "Trả lời" on a DIFFERENT message while one reply preview is already active, the
  bar simply swaps to the new target (no stacking, single active reply target at a time).

### 3.8 Composer — baseline (no reply active, unchanged from current dm-panel.tsx/group-panel.tsx)

```
├──────────────────────────────────────────┤
│ ( Nhập tin nhắn… )              [ Gửi ] │
└──────────────────────────────────────────┘
```

### 3.9 Sent message showing inline quoted reply

```
┌────────────────────────────────────────┐
│ Bạn · 14:10                              │
│ ┌──────────────────────────────┐        │
│ │ ┃ @minh                       │        │  ← quoted block, tappable,
│ │ ┃ Hẹn 7h tối nay nhé          │        │     left accent bar, smaller/
│ │ ─────────────────────────────│        │     dimmer text than reply body
│ │ Ok chốt giờ đó nha             │        │  ← actual reply body, normal size
│ └──────────────────────────────┘        │
└────────────────────────────────────────┘
   ↑ tap the quoted block (top portion only, not whole bubble) → scroll-to-original
```

### 3.10 Tap-to-jump interaction — original found vs not found

```
Found in loaded history:                  Not found in loaded history:
┌──────────────────────────┐              ┌──────────────────────────┐
│ ... scrolls up ...        │              │ (toast, bottom of pane)   │
│ ┌──────────────────────┐ │              │ ┌──────────────────────┐ │
│ │ @minh                 │ │ ← briefly    │ │ Không tìm thấy tin    │ │
│ │ Hẹn 7h tối nay nhé    │ │   flashes    │ │ gốc trong lịch sử đã  │ │
│ └──────────────────────┘ │   bg-yellow   │ │ tải                   │ │
│   (highlight fades ~1s)  │   then fades  │ └──────────────────────┘ │
└──────────────────────────┘              └──────────────────────────┘
```

### 3.11 Blocked-state — reacting/replying after losing membership

```
┌────────────────────────────────────────┐
│ @minh · 14:02                           │
│ ┌──────────────────────────────┐        │
│ │ Hẹn 7h tối nay nhé             │        │
│ └──────────────────────────────┘        │
│  [😍 2] [👍 1]                           │  ← pills still VIEWABLE (read-only)
└────────────────────────────────────────┘
        ↑ long-press → Action Sheet does NOT open;
          instead surfaces existing banner inline (see 3.12)

├──────────────────────────────────────────┤
│ ⓘ Bạn không còn là thành viên nhóm này  │  ← EXISTING banner, reused verbatim
│   nên không thể gửi tin nhắn mới.       │     (sendBlockedReason === "removed")
├──────────────────────────────────────────┤
│ ( Không còn là thành viên… )    [ Gửi ] │  ← input already disabled (existing)
└──────────────────────────────────────────┘
```
No NEW banner copy needed — reusing `sendBlockedReason` state. The Action Sheet trigger itself
becomes inert (long-press does nothing, or shows a 1-line toast "Bạn không thể thực hiện hành
động này" if a long-press explicitly fires) when `sendBlockedReason !== null`. Existing pills
remain visible (history is still readable, matches "read-only after leaving" precedent already
established for messages themselves).

---

## 4. Component Breakdown

> Per STATE risk notes, message-bubble JSX duplication between `DmThread`/`GroupThread` has
> already been flagged as a recurring problem. Recommend extracting a **shared, presentation-only
> `MessageBubble` component** (or at minimum the reaction/reply sub-pieces below) parameterized by
> props rather than by hook — this keeps the shared piece dumb (no Supabase awareness) so it
> doesn't reopen the "unify the 3 message tables" debate; it only deduplicates *rendering*, not
> data-fetching. Architect should confirm this is in-scope for `/plan` (flagged as Open Design
> Question #5 below — best-guess default applied: YES, build shared presentational components).

| Component | New/Existing | Used by | Props (interface contract, no implementation) |
|---|---|---|---|
| `MessageReactions` | New | Rendered inside both `DmThread` and `GroupThread` message-row JSX (or inside a shared `MessageBubble` if adopted) | `reactions: { emoji: string; count: number; reactedByMe: boolean; reactorUsernames: string[] }[]`, `disabled: boolean` (true when `sendBlockedReason !== null`), `onToggleMine(emoji: string): void` (tap own pill → un-react), `onOpenReactorList(emoji: string): void`, `onOpenPicker(): void` (the `[+]` affordance) |
| `MessageActionSheet` | New | Triggered from a long-press/click handler wrapping each message row in `DmThread`/`GroupThread` | `open: boolean`, `anchorMessageId: string`, `disabled: boolean`, `quickEmoji: string[]` (hardcoded UI shortcut list, e.g. `["👍","❤️","😂","😮","😢","🙏"]` — NOT a DB constraint), `onPickEmoji(emoji: string): void`, `onOpenFreeInput(): void`, `onReply(): void`, `onClose(): void` |
| `EmojiFreeInput` | New | Sub-state inside `MessageActionSheet`, shown after tapping "+" | `value: string`, `onChange(v: string): void`, `onSubmit(): void`, `onCancel(): void`, `error: string \| null` (client-side soft-validation message) |
| `ReactorListPopover` | New | Triggered by tapping a pill in `MessageReactions` | `open: boolean`, `emoji: string`, `usernames: string[]`, `loading: boolean`, `onClose(): void` |
| `ReplyPreviewBar` | New | Rendered above the composer `<input>` in `DmThread`/`GroupThread`, conditionally on `replyTarget !== null` | `replyTarget: { messageId: string; senderLabel: string; bodyPreview: string } \| null`, `onCancel(): void` |
| `QuotedMessagePreview` | New | Rendered inside a message bubble when `message.replyToMessageId !== null` | `senderLabel: string`, `bodyPreview: string`, `onJumpToOriginal(): void`, `foundInView: boolean` (controls jump vs. "not found" toast — set by parent based on whether `messageId` exists in currently rendered list) |
| `MessageBubble` (optional consolidation) | New (recommended, not required) | Would replace inline `.map()` JSX currently duplicated in `DmThread` (dm-panel.tsx:272-291) and `GroupThread` (group-panel.tsx:411-430) | `message: { id, body, senderLabel, createdAt, mine, replyPreview?, reactions? }`, `onLongPress(messageId): void`, `reactionsSlot?: ReactNode`, `quotedSlot?: ReactNode` — kept presentation-only, no hook coupling, so DM/Group keep separate data hooks per THINK #4 (no unification) |

All new components are **presentation-only** (controlled, no internal Supabase/hook calls) —
data fetching and mutation stay in hooks the architect designs (`useDmMessages`/`useGroupMessages`
extended, or new `useMessageReactions(messageId)` — architect's call, not designer's).

---

## 5. Interaction Notes

- **Long-press timing**: standard ~400-500ms long-press on touch; on desktop, a small low-opacity
  "···" affordance appears on hover over a bubble (top-right corner) as the click target — avoids
  needing actual long-press emulation with a mouse.
- **Optimistic reaction toggle**: tapping an emoji should apply the pill change immediately in
  local state before the server round-trip resolves (matches the snappy feel expected of
  reactions in every modern chat app); on error, revert the pill and show a small inline toast
  near the message ("Không thể thêm reaction, thử lại"). This is the one place in this feature
  where optimistic UI is justified — unlike message sending (`dm-panel.tsx`/`group-panel.tsx`
  explicitly avoid optimistic insert for messages), because un-reacting/re-reacting needs to feel
  instant or it reads as broken/laggy (the STATE abuse-vector note about rapid toggling already
  anticipates this).
- **Debounce on rapid toggle**: per STATE product-risk-notes, if a user taps the same emoji
  rapidly, debounce the network call (e.g. trailing 300ms) so a "tap-tap-tap" doesn't generate 3
  insert/delete/insert Realtime events — UI shows the LAST intended state immediately, network
  catches up.
- **Loading state — Reactor List Popover**: show 2-3 skeleton rows (reuse `SkeletonRows`-style
  pulse) while usernames are being fetched, in case this requires a separate query rather than
  being embedded in the realtime payload.
- **Empty state — no reactions**: simply render nothing (no pills row at all) — matches "no
  reaction button always visible" direction; the `[+]` affordance to open the picker ONLY appears
  once at least the Action Sheet has been invoked once OR... actually for discoverability, the
  pills row is entirely absent until first reaction exists; subsequent picker access is always via
  long-press/hover on the bubble itself (not a persistent `[+]`), to avoid UI clutter on every
  message. *(Reconsidered from 3.2/3.3 wireframes which show a trailing `[+]` chip — see Open
  Design Question #2: keep trailing `[+]` chip once ≥1 reaction exists, for fast "add another"
  re-entry, OR rely solely on bubble long-press always. Best-guess default applied: keep the
  trailing `[+]` chip — cheap affordance, avoids forcing users to long-press again once they've
  already discovered the row exists.)*
- **Error state — react/reply blocked (non-member)**: covered in wireframe 3.11. No new copy;
  reuse `sendBlockedReason` banner verbatim. The long-press/hover affordance should still register
  visually (cursor feedback) but tapping it either does nothing or surfaces a 1-line transient
  toast — NOT a modal, to avoid being heavier than the action itself.
- **Error state — free emoji input rejected by DB CHECK (>8 chars)**: server returns an error;
  surface inline under the free-input field: `⚠ Emoji không hợp lệ hoặc quá dài`. Picker stays
  open so user can retry without re-triggering long-press.
- **Reply target message deleted**: per STATE, MOOT for this feature (no delete feature exists
  yet) — no UI needed now. Flagged as roadmap note only.
- **Reply across conversation boundary**: enforced at DB/RLS layer per STATE edge case #6 — UI
  simply never offers a path to do this (the "Trả lời" button is always scoped to the message
  currently in view inside the SAME open thread), so no client-side error state is needed for this
  specific case; if it somehow occurred via a stale client state bug, treat as generic send error.
- **Scroll-to-original when not in loaded view**: per STATE scope ("not required to load more
  history to find it") — toast feedback is sufflicient, no infinite-scroll-to-find behavior in
  this iteration. Flagged as a Future Idea below if user wants it later.
- **Pills row wrapping on narrow viewports**: flex-wrap, no horizontal scroll — matches
  mobile-first principle; many distinct emoji types simply grow the bubble's vertical footprint
  (acceptable per THINK #9 "no limit").
- **Own reaction pill visual distinction**: ring/border highlight (e.g. `ring-1 ring-blue-500`)
  consistent with existing `bg-blue-600` used for "mine" message bubbles — keeps the existing
  blue = "yours" visual language consistent across the whole app.
- **Dark mode**: every new component must carry `dark:` variants matching the existing
  `dark:border-zinc-800` / `dark:bg-zinc-800` / `dark:text-zinc-400` conventions already used
  throughout `dm-panel.tsx`/`group-panel.tsx`.

---

## 6. Open Design Questions (taste calls — best-guess default applied per autopilot instructions, flagged for confirmation, NOT blocking)

| # | Question | Best-guess default applied in this design | Why flagged |
|---|---|---|---|
| 1 | Should tapping (single tap, not long-press) one's OWN existing reaction pill toggle it OFF directly, or should every pill tap (including own) always open the Reactor List Popover, requiring a separate explicit "remove" action inside that popover? | **Single-tap on own pill = instant toggle-off** (Messenger pattern); tapping someone else's pill (or a pill with no reaction from me) opens the Reactor List. | This is a real behavior fork affecting `onToggleMine` vs `onOpenReactorList` wiring — a one-tap-removes-reaction pattern can also surprise users who only meant to see who else reacted. Needs explicit user confirmation before `/plan` locks the prop contract. |
| 2 | Once a message has ≥1 reaction, should the pills row keep a persistent trailing `[+]` chip for fast re-entry into the picker, or should re-opening the picker ALWAYS require long-press/hover on the bubble (no persistent `[+]` chip at all, keeping the "no always-visible reaction button" principle strict)? | **Keep the trailing `[+]` chip** once ≥1 reaction exists (cheap, low-clutter, improves discoverability for adding a 2nd distinct emoji type to a message that already has reactions). | THINK #8 says "no button always visible" was about the FIRST reaction on a clean message; it's ambiguous whether that principle extends to messages that already display a pills row. A stricter reading would remove the `[+]` chip entirely. |
| 3 | Mobile bottom-sheet vs desktop popover for both `MessageActionSheet` and `ReactorListPopover` — same component with responsive variants, or genuinely two different surfaces? | **Single component, responsive variant via CSS breakpoint** (sheet slides from bottom under a `sm:` breakpoint, popover anchored above that) — avoids component duplication. | Affects whether architect should plan for `useMediaQuery`-style logic or pure CSS; minor but worth a quick confirm since no existing component in the codebase currently has a responsive sheet/popover split to copy from. |
| 4 | Should the quoted-reply preview (3.9) be tappable on the WHOLE bubble, or only the quoted block portion (as currently designed)? | **Only the quoted block portion** is tappable for jump-to-original; the rest of the bubble has no special tap behavior (consistent with bubbles not being tappable elsewhere in the app today). | Low risk, but worth flagging since "tap whole bubble" is a common alternate pattern (e.g. Telegram) and changes the touch target size meaningfully on mobile. |
| 5 | Should `DmThread`/`GroupThread` adopt a shared presentation-only `MessageBubble` component now (to host reactions + quoted-reply rendering once), or should reactions/replies be added by duplicating the rendering logic into both files again (consistent with how the THINK #4 decision explicitly chose to keep DATA layers separate, which could be read as "keep everything separate, including UI")? | **Adopt a shared presentational `MessageBubble`/sub-components** (no data coupling) — this only deduplicates rendering JSX, does not reopen the schema-unification debate that THINK #4 already closed. | This is squarely the kind of decision the STATE history explicitly says should not be silently decided by habit — THINK #4 was about SCHEMA, not UI, but a literal-minded reading of "keep things separate" could be mistakenly extended to component structure. Flagging for explicit architect/user sign-off even though the designer's recommendation is fairly confident. |
| 6 | This design assumes hand-rolled Tailwind (matching what's actually in the codebase) rather than shadcn/ui primitives (Popover, Sheet, Dialog) as CLAUDE.md nominally specifies. Should the architect introduce actual shadcn components now (first real shadcn install in this codebase) for `ReactorListPopover`/`MessageActionSheet`, or continue the hand-rolled pattern for consistency with `dm-panel.tsx`/`group-panel.tsx`? | **Continue hand-rolled Tailwind** for this feature, matching the existing 100%-hand-rolled codebase reality over the aspirational CLAUDE.md stack note — introducing shadcn now would create a visual/structural seam between this feature and every other existing screen. | This is a meaningful process question (codebase drift from documented stack) beyond just this feature's scope — worth the architect/user explicitly deciding rather than the designer quietly picking a side. |

---

## Future ideas (explicitly OUT of this iteration's scope — do not build now)

- Auto-fetching additional message history to locate an original message that's outside the
  currently loaded window when jumping to it from a reply quote (STATE explicitly scoped this out:
  "không bắt buộc load thêm lịch sử để tìm").
- Animated reaction "burst" effects (e.g. Messenger's emoji float-up animation) — purely
  delight-layer, not required for MVP.
- Reaction picker search/filter for free emoji input (e.g. type "heart" to filter to ❤️🧡💛) — the
  current free-input design is raw paste/type only, no search UI.
- Read receipts / "seen" indicators — unrelated feature, mentioned only because it shares UI
  surface area (small badges near messages) and was referenced in STATE as a likely "Run 4"
  candidate for the unification question.
