# Design — 1-on-1 Private DM Chat

> Phase: **DESIGN**. Input: `docs/loops/dm-chat-STATE.md` (ANALYZE + THINK locked — do NOT re-litigate). Output consumed by `/plan` (architect).
> Locked scope reminder: global chat becomes one special "conversation" (architecture detail for `/plan`, not a UI concern here); DM gated on friend status (`accepted` at send-time, re-checked, not just at creation); no typing indicator, no read receipts, no unread badge count; no pagination (load last 100 messages, same as current global chat); UI = tab switcher "Global" / "Direct Messages" inside the existing layout, NOT a separate route; opening a DM is triggered from a `FriendRow` in `FriendsPanel`.

## 0. Existing conventions observed (must match)

- No real shadcn `components/ui/*` primitives exist — everything is hand-rolled Tailwind. `FriendsPanel` set the precedent for **slide-over drawer** (not native `<dialog>`) for panel-style UI; `AuthModal` still uses native `<dialog>` for simple centered modals. DM UI is panel-like (list + thread), so it follows the `FriendsPanel` drawer/overlay convention, not `AuthModal`.
- Message bubble styling already exists in `ChatPanel` (`src/components/chat-panel.tsx`) — sender name + time row (`text-xs text-zinc-500`), bubble (`rounded-2xl px-3 py-2 text-sm`, mine = `bg-blue-600 text-white`, theirs = `bg-zinc-100 dark:bg-zinc-800`). **DM thread must reuse this exact bubble look**, not reinvent it.
- Input bar convention (`ChatPanel` footer): `rounded-full border` text input + `rounded-full bg-blue-600` "Gửi" button, `disabled:opacity-50` when `!canSend`.
- Row/card convention (`FriendsPanel`): `rounded-xl border border-zinc-200 dark:border-zinc-800 p-3` for list rows; `[⋯]` kebab pattern for row actions; inline confirm-expansion (no native `confirm()`).
- Tab convention (`FriendsPanel`'s `TabButton`): underline style, `border-b-2`, active = `border-blue-600 text-blue-600`, inactive = `border-transparent text-zinc-500`.
- Skeleton/Error/Empty shared sub-components already exist in `friends-panel.tsx` (`SkeletonRows`, `ErrorState`, `EmptyState`) — **reuse the same visual pattern** (ideally architect extracts these three into a shared file during `/plan`/`/build`, since DM screens need the identical states).
- `page.tsx` header currently hosts: title block (left) + `FriendsButton` + `HeaderAuth` (right). The Chat|Map grid is `md:grid-cols-2`. The new Global/DM tab switcher must live in the Chat pane's slot (left column), not the header, since the header is reserved for app-level nav (Friends, Auth) — DM is content-level, like switching what's inside the chat pane.
- Vietnamese UI copy throughout, `@username` prefix convention.

This design treats the **Chat pane** as now hosting a tab switcher ("Global" / "Tin nhắn") above whichever sub-view is active, instead of always rendering `ChatPanel` directly. The DM side introduces an inbox list (new) and reuses the message-list + input visual pattern from `ChatPanel` almost verbatim.

---

## 1. User Journey (happy path)

1. **Entry**: User is logged in, looking at the existing Chat | Map layout. The Chat pane (left column on desktop, top on mobile) now has two tabs at its header: **"Chung" (Global)** and **"Tin nhắn" (Direct Messages)**. "Chung" is selected by default (matches current behavior — no regression for existing global chat users).
2. User opens the **Friends panel** (header "Bạn bè" button, unchanged from `friends-design.md`), goes to the **Bạn bè** tab, and sees their friend list. Each `FriendRow` now has an additional **"Nhắn tin"** action next to the existing `[⋯]` kebab.
3. User taps **"Nhắn tin"** on `@alice99`'s row.
   - System resolves (or creates, idempotently) the 1-1 conversation between the user and `@alice99`.
   - Friends panel closes automatically.
   - Chat pane switches to the **"Tin nhắn"** tab, and within it, the DM Thread view for the `@alice99` conversation opens directly (skipping the inbox list — direct-to-thread navigation, since the user explicitly chose who to talk to).
4. User sees the **DM Thread view**: a back button (to return to DM inbox), `@alice99`'s name in the thread header, message history (or empty state "Hãy bắt đầu trò chuyện" if this is a brand new conversation), and the familiar input bar at the bottom (same look as `ChatPanel`).
5. User types a message, hits Enter or taps **[Gửi]** → message appears in the thread immediately (after server confirmation, non-optimistic — matches `ChatPanel`/`useMessages` pattern of no optimistic insert).
6. `@alice99`, if she has the app open with the "Tin nhắn" tab on this same thread, sees the new message appear live within ~2s via Realtime, no refresh needed (same Postgres-changes pattern as global chat).
7. User taps **[‹ Tin nhắn]** back button in the thread header → returns to the **DM Inbox** list, showing all their existing conversations sorted by most recent activity, each row showing the other person's `@username` + a one-line preview of the last message + relative timestamp.
8. User taps the **"Chung"** tab → instantly switches back to the familiar global `ChatPanel` view (unchanged), Map pane untouched throughout.
9. Later, user taps **"Tin nhắn"** tab again → lands on the **DM Inbox** (not the last thread — inbox is the tab's home view; a specific thread is only entered via inbox row tap or a fresh "Nhắn tin" trigger from Friends panel) → taps a different conversation row (e.g. `@bob_tran`) → DM Thread view opens for that conversation, replacing the previous one.

---

## 2. Screen Inventory

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **Chat pane tab switcher** ("Chung" / "Tin nhắn") | Always visible at top of Chat pane when logged in | N/A (always present) |
| 2 | **Global tab content** | Tap "Chung" tab (default) | Tap "Tin nhắn" tab |
| 3 | **DM Inbox — empty state** (no conversations yet) | Tap "Tin nhắn" tab, `conversations.length === 0` | Tap a friend's "Nhắn tin" in Friends panel → creates first conversation → routes to Thread |
| 4 | **DM Inbox — with conversations** | Tap "Tin nhắn" tab, has existing conversations | Tap a row → DM Thread; tap "Chung" tab → Global |
| 5 | **DM Inbox — loading** | Tab just opened, fetch in flight | resolves to #3 or #4 |
| 6 | **DM Inbox — error** | Fetch failed | Retry button / switch tab |
| 7 | **DM Thread — empty (new conversation, no messages yet)** | From Friends panel "Nhắn tin", or inbox row with 0 messages | Back button → Inbox |
| 8 | **DM Thread — with messages** | From inbox row tap, or "Nhắn tin" trigger when history exists | Back button → Inbox; "Chung" tab → Global |
| 9 | **DM Thread — loading** | Thread just opened, fetch in flight | resolves to #7 or #8 |
| 10 | **DM Thread — error** (fetch failed / RLS denied) | Fetch failed, or attempted open of non-friend conversation | Back button → Inbox / Retry |
| 11 | **DM Thread — blocked-send state** (conversation exists but current friend status is not `accepted`, e.g. after unfriend) | Opening a thread where friend status check fails at send-time | Back button → Inbox (history still visible, only sending is blocked) |
| 12 | **"Nhắn tin" trigger row state** (in FriendsPanel's `FriendRow`) | Always visible per friend row | Tap → navigates to DM Thread (closes Friends panel) |
| 13 | **Not logged in state** (Tin nhắn tab content if session expires mid-use) | Tab opened while `!user` | Login CTA |

Not a separate route — all of the above are states within the existing Chat pane, switched via the new tab control, per THINK decision #9 (tab in existing layout, not `/dm/[id]`).

---

## 3. ASCII Wireframes

### 3.1 Chat pane — tab switcher shell (replaces bare `ChatPanel` mount in `page.tsx`)

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │  ← new tab bar, sits where ChatPanel's
├──────────────────────────────────┤     <header> used to be — same border-b style
│                                    │
│   ...active tab content...        │
│                                    │
└──────────────────────────────────┘
```

- Tab bar style matches `FriendsPanel`'s `TabButton` (underline active state).
- "Tin nhắn" tab shows no badge/count (THINK #7 — no unread badge for MVP). Plain label only.

### 3.2 Global tab (unchanged — existing `ChatPanel`, mounted as-is)

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│  Realtime (Supabase) · bạn là... │  ← existing ChatPanel header subtitle
├──────────────────────────────────┤
│  Bob · 14:02                     │
│  ┌───────────────┐               │
│  │ Chào mọi người │               │
│  └───────────────┘               │
│                       14:03 · Tôi│
│               ┌────────────────┐ │
│               │ Hi Bob!        │ │
│               └────────────────┘ │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │
└──────────────────────────────────┘
```

No visual change from current `ChatPanel` — only its container shifts under the new tab bar.

### 3.3 DM Inbox — empty state

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│  Tin nhắn riêng                  │  ← inbox header
├──────────────────────────────────┤
│                                    │
│         💬  Chưa có cuộc trò      │
│             chuyện nào             │
│   Mở "Bạn bè" và chọn "Nhắn tin"  │
│   với một người bạn để bắt đầu    │
│                                    │
└──────────────────────────────────┘
```

No CTA button here (unlike Friends-empty, which had "+ Thêm bạn") — the entry point lives in the Friends panel, not the inbox itself, per the locked trigger flow.

### 3.4 DM Inbox — with conversations

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│  Tin nhắn riêng                  │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ @alice99                     │ │
│ │ Hẹn gặp lúc 7h nhé      14:32│ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @bob_tran                     │ │
│ │ Bạn: ok đã nhận       Hôm qua│ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @diana_k                      │ │
│ │ 👋 Chào!               3 ngày│ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

- Sorted by most recent message time, descending.
- Last-message preview prefixed with `"Bạn: "` if the current user sent it (mirrors Messenger/Zalo convention), otherwise no prefix.
- Relative timestamp (`14:32` for today, `Hôm qua` for yesterday, `3 ngày` for older — same granularity level as needed, exact formatting rule is an open question, see section 6).
- Tapping a row opens DM Thread for that conversation.

### 3.5 DM Inbox — loading

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│  Tin nhắn riêng                  │
├──────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← SkeletonRows pattern, reused from
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │     FriendsPanel
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────┘
```

### 3.6 DM Inbox — error

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│  Tin nhắn riêng                  │
├──────────────────────────────────┤
│                                    │
│   ⚠ Không tải được danh sách     │
│        cuộc trò chuyện            │
│   Lỗi: <error message>            │
│           [ Thử lại ]             │
│                                    │
└──────────────────────────────────┘
```

### 3.7 DM Thread — empty (brand new conversation, no messages yet)

```
┌──────────────────────────────────┐
│ [‹ Tin nhắn]   @alice99          │  ← back + peer username (no avatar)
├──────────────────────────────────┤
│                                    │
│        💬  Hãy bắt đầu trò        │
│             chuyện với @alice99    │
│                                    │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │
└──────────────────────────────────┘
```

### 3.8 DM Thread — with messages

```
┌──────────────────────────────────┐
│ [‹ Tin nhắn]   @alice99          │
├──────────────────────────────────┤
│  @alice99 · 14:01                │
│  ┌───────────────┐               │
│  │ Chào bạn!      │               │
│  └───────────────┘               │
│                       14:02 · Bạn│
│               ┌────────────────┐ │
│               │ Hi alice, khoẻ │ │
│               │ không?         │ │
│               └────────────────┘ │
│  @alice99 · 14:32                │
│  ┌──────────────────────┐        │
│  │ Hẹn gặp lúc 7h nhé    │        │
│  └──────────────────────┘        │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │
└──────────────────────────────────┘
```

- Bubble styling identical to `ChatPanel`: mine = `bg-blue-600 text-white` right-aligned, theirs = `bg-zinc-100 dark:bg-zinc-800` left-aligned, sender label + time above bubble.
- No typing indicator row (THINK #2 — deferred), no read-receipt marks under "mine" bubbles (THINK #6 — deferred).
- Auto-scroll to bottom on new message (same `bottomRef.scrollIntoView` pattern as `ChatPanel`).

### 3.9 DM Thread — loading

```
┌──────────────────────────────────┐
│ [‹ Tin nhắn]   @alice99          │
├──────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │  ← input visible but disabled while loading
└──────────────────────────────────┘
```

### 3.10 DM Thread — error (fetch failed / not-a-friend access denied)

```
┌──────────────────────────────────┐
│ [‹ Tin nhắn]   @alice99          │
├──────────────────────────────────┤
│                                    │
│    ⚠ Không thể mở cuộc trò        │
│       chuyện này                  │
│    Lỗi: <error message>           │
│           [ Thử lại ]             │
│                                    │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )    [Gửi] (off)│
└──────────────────────────────────┘
```

Used both for generic fetch failure AND for the case in edge case #1 from STATE (trying to open a DM with someone who is not an `accepted` friend) — though per the locked flow, the "Nhắn tin" trigger only ever appears on rows that are already friends, so this path should only be reachable via stale/manipulated state, not normal navigation.

### 3.11 DM Thread — blocked-send state (history visible, sending disabled — e.g. after unfriend)

```
┌──────────────────────────────────┐
│ [‹ Tin nhắn]   @alice99          │
├──────────────────────────────────┤
│  @alice99 · Hôm qua               │
│  ┌───────────────┐               │
│  │ Chào bạn!      │               │
│  └───────────────┘               │
│                     Hôm qua · Bạn │
│               ┌────────────────┐ │
│               │ Hi alice!      │ │
│               └────────────────┘ │
├──────────────────────────────────┤
│  ⓘ Bạn không còn là bạn bè với   │
│    @alice99 nên không thể gửi    │
│    tin nhắn mới.                  │
├──────────────────────────────────┤
│ ( Đã hủy kết bạn — không thể... )│  ← input disabled, placeholder explains
│                      [Gửi] (off) │     why, no [Gửi] action possible
└──────────────────────────────────┘
```

- This is visually distinct from the generic "logged out" disabled input (`ChatPanel`'s existing pattern) — the placeholder text and the info banner above the input both make the *reason* explicit, since silently disabling would be confusing (user previously could send here).
- History remains fully visible and scrollable (THINK #3 — old history stays visible after unfriend).
- The banner uses an "info" tone (`bg-zinc-50 text-zinc-600` or similar neutral, NOT `bg-red-50` — this is not an error, it's an expected state), see Interaction Notes for exact color call.

### 3.12 "Nhắn tin" trigger — FriendRow extended (in FriendsPanel, modifies existing row from `friends-design.md` 3.5)

```
│  ┌────────────────────────────────────────────────────┐  │
│  │ @alice99                    [ Nhắn tin ]   [ ⋯ ]    │  │
│  └────────────────────────────────────────────────────┘  │
```

- New `[ Nhắn tin ]` button inserted between the username and the existing `[⋯]` kebab.
- Tapping it: closes `FriendsPanel` (`onOpenChange(false)`), switches Chat pane to "Tin nhắn" tab, opens/creates the DM Thread for that friend. This requires a callback prop threaded from `page.tsx` down into `FriendsPanel` → `FriendsTab` → `FriendRow` (see Component Breakdown).

### 3.13 Not logged in state (Tin nhắn tab content, mirrors Friends panel's pattern)

```
┌──────────────────────────────────┐
│  [ Chung ]   [ Tin nhắn ]        │
├──────────────────────────────────┤
│   Đăng nhập để xem tin nhắn      │
│        riêng của bạn              │
│        [ Đăng nhập ]              │
└──────────────────────────────────┘
```

---

## 4. Component Breakdown

> Repo has no real shadcn `components/ui/*` primitives. As with `friends-design.md`, each item lists (a) the closest shadcn mapping for future migration and (b) the actual hand-rolled build target now.

### `ChatTabs` (new, wraps the Chat pane's mount point in `page.tsx`)
- Maps to: shadcn `Tabs` (`TabsList` + `TabsTrigger` + `TabsContent`).
- New component, replaces the bare `<ChatPanel fallback={...} />` mount in `page.tsx`'s grid.
- Props: `fallback: Message[]` (passed through to `ChatPanel` for the Global tab, unchanged contract).
- Internal state: `activeTab: "global" | "dm"`.
- Must expose an imperative way to be told "open this DM thread now" from outside (the Friends panel trigger) — see `dmNavigation` contract below. Likely implemented as a small piece of state lifted to `page.tsx` (e.g. `openDmConversationId: string | null`) passed down, since `page.tsx` already centrally owns cross-panel state (it already owns `friendsOpen` and lifts `useFriendRequests`).
- Composes `ChatPanel` (Global, unchanged) and a new `DmPanel` (DM, new).

### `DmPanel` (new)
- Maps to: no single shadcn equiv — a container switching between inbox/thread, similar role to how `FriendsPanel` switches between Friends/Requests tabs but it's not a drawer here (it's inline content within the Chat pane's tab, not an overlay).
- Props: `pendingOpenConversationId: string | null` (set externally when "Nhắn tin" is tapped from Friends panel — triggers immediate navigation to that thread, bypassing inbox), `onConsumedPendingOpen: () => void` (clears the external trigger once handled, avoiding re-trigger loops).
- Internal state: `view: "inbox" | "thread"`, `activeConversationId: string | null`.
- Composes `DmInbox` and `DmThread`.

### `DmInbox` (new)
- Maps to: shadcn `ScrollArea` + list rows (`Card`-equivalent), same family as `FriendsTab`'s friend list.
- Props: none external — reads from a `useDmConversations()` hook (architect to define): `{ conversations, loading, error, refetch }` where each conversation includes `{ id, peerUsername, lastMessageBody, lastMessageAt, lastMessageMine }`.
- Renders `DmConversationRow[]`, `EmptyState`, `ErrorState`, or `SkeletonRows` depending on hook state (identical branching pattern to `FriendsTab`/`RequestsTab`).
- Emits `onOpenConversation: (conversationId: string) => void` upward to `DmPanel` to switch `view` to `"thread"`.

### `DmConversationRow` (new)
- Maps to: shadcn `Card`/list item, sibling pattern to `FriendRow` but simpler (no kebab menu, no actions — just navigation).
- Props: `conversation: { id: string; peerUsername: string; lastMessageBody: string | null; lastMessageAt: string; lastMessageMine: boolean }`, `onClick: () => void`.
- No internal state (pure display + click).

### `DmThread` (new)
- Maps to: shadcn equivalent is closest to a `Card` containing a scrollable message list + footer `Input`/`Button` — essentially the same shape as `ChatPanel` itself.
- Props: `conversationId: string`, `peerUsername: string`, `onBack: () => void`.
- Reads from a `useDmMessages(conversationId)` hook (architect to define, parallel to existing `useMessages`): `{ messages, loading, error, canSend, sendBlockedReason, send }`.
  - `canSend: boolean` — false if current friend status with peer is not `accepted` (re-checked live, not just at load time — ideally hook subscribes to friend-status changes too, or re-validates on each send attempt server-side and surfaces the error).
  - `sendBlockedReason: "unfriended" | null` — drives the 3.11 banner copy specifically (vs. a generic network error).
- Internal state: `draft: string` (mirrors `ChatPanel`'s draft state).
- Reuses message bubble rendering logic from `ChatPanel` — **recommend extracting `ChatPanel`'s message-list-rendering + input-bar into a shared presentational sub-component** (e.g. `MessageList` + `MessageComposer`) during `/plan`/`/build` so `ChatPanel` and `DmThread` share one implementation instead of copy-pasting JSX. This is a build-time refactor suggestion, not a new visual element.

### `FriendRow` (existing, modified)
- Add prop: `onMessage: (friendId: string) => void` (new callback, threaded from `page.tsx` through `FriendsPanel` → `FriendsTab` → `FriendRow`).
- Add the `[ Nhắn tin ]` button (3.12) — `rounded-full border` ghost-style button matching existing kebab/secondary button conventions, placed before the `[⋯]` kebab.
- No new internal state needed on `FriendRow` itself — clicking just calls `onMessage(friend.id)` and lets the parent (`page.tsx`) handle closing the Friends panel + switching tabs + resolving/creating the conversation.

### `FriendsPanel` / `FriendsTab` (existing, modified)
- Thread the new `onMessage` callback down: `FriendsPanel` gets a new prop `onMessageFriend: (friendId: string) => void`, passes to `FriendsTab`, which passes to each `FriendRow`.

### `EmptyState`, `ErrorState`, `SkeletonRows` (existing, reused as-is)
- Currently defined inline inside `friends-panel.tsx` — **recommend architect extracts these three into a shared file** (e.g. `src/components/ui/states.tsx` or similar) since `DmInbox` and `DmThread` both need the identical visual pattern. Avoids a second copy-paste of these three components.

### `page.tsx` (existing, modified)
- New lifted state: `openDmConversationFriendId: string | null` (or resolved conversation id — architect decides whether resolution happens in `page.tsx` or inside `DmPanel`/a hook) and `activeChatTab: "global" | "dm"`.
- Wires `FriendsPanel`'s new `onMessageFriend` to: set `activeChatTab = "dm"`, set the pending-open target, close Friends panel (`setFriendsOpen(false)`).

---

## 5. Interaction Notes

- **Tab switch (Chung ↔ Tin nhắn)**: instant, no fetch re-trigger if DM inbox data already loaded this session (same "prefetch once, switch is free" pattern as `FriendsPanel`'s Friends/Requests tabs). Global tab's `ChatPanel` stays mounted (or remounts cheaply) — no loss of global chat scroll position is NOT guaranteed in MVP (acceptable; not in acceptance criteria).
- **"Nhắn tin" trigger → thread open**: this is a multi-step transition (close Friends panel, switch tab, open thread) — should feel like one motion, not three jarring jumps. Recommend: close Friends panel panel immediately (no animation needed beyond its existing close transition), then tab+thread appear already-switched (no separate "now switching tabs" animation) — i.e. the thread should just be the visible state the instant the Friends panel finishes closing.
- **Conversation creation latency**: per FR #1 in STATE, opening a DM may need to create a conversation row server-side if one doesn't exist yet (idempotent get-or-create). This means there's a brief async step between tapping "Nhắn tin" and the thread being ready. Show the **DM Thread — loading** state (3.9) immediately upon trigger (header shows `@alice99` right away, since we know the peer username synchronously; only the message list area shows skeleton) rather than blocking on a spinner before navigating at all. This keeps the transition feeling instant even though there's a network round-trip underneath.
- **Sending a message**: non-optimistic, matching `ChatPanel`/`useMessages` convention exactly — input clears on submit, message appears only after server confirms (no temporary local bubble). If send fails (network drop, edge case #11), input is NOT cleared-and-lost — recommend restoring the draft text into the input on failure with an inline error line under the input bar (e.g. `⚠ Không gửi được, thử lại`), consistent with not creating "rác state" per STATE's edge case #11.
- **Realtime receive**: new message fades in at the bottom of the thread + auto-scrolls into view, same as `ChatPanel`'s existing `bottomRef.scrollIntoView({ behavior: "smooth" })` on `list.length` change. No sound/toast — quiet, consistent with the app's no-toast convention seen in Friends panel design.
- **DM Inbox row ordering update**: when a new message arrives in any conversation (even one not currently open), if the inbox view is mounted/visible, the corresponding row should re-sort to the top and update its preview text live (requires inbox to also subscribe to relevant realtime events, or simply refetch the list on any DM message insert — architect's call on efficiency, but the visual expectation is "inbox always reflects latest activity without manual refresh").
- **Blocked-send (unfriended) state**: NOT styled as a hard error (no red). Use a neutral/info tone — `bg-zinc-50 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400` for the banner (3.11), distinguishing it clearly from `ErrorState`'s red `bg-red-50 text-red-600`. This is an expected, named state (you unfriended this person), not a malfunction. Input's `disabled` styling matches existing `disabled:opacity-50` convention, placeholder text explains why inline (no separate tooltip needed).
- **Detecting the blocked-send state**: should be checked (a) once when the thread opens (so the banner shows immediately if already unfriended) and (b) the actual block is enforced server-side via RLS at send-time regardless of client state (per STATE's locked technical decision — RLS re-checks friend status at send time, not just creation time) — so even if the client's friend-status cache is stale, a send attempt that gets rejected by RLS should fall back to showing this same banner reactively (treat an RLS-denial response on send the same as the pre-detected case, swapping the input to the disabled blocked state immediately after the failed attempt).
- **Loading states**: `SkeletonRows` pattern reused identically for both DM Inbox (3.5) and DM Thread message area (3.9) — 3 pulsing rows, no separate skeleton design needed for DM.
- **Empty states**: DM Inbox empty (3.3) is purely informational, no CTA (entry point lives in Friends panel only — by design, keeps a single, unambiguous way to start a DM, avoiding two competing "start chat" affordances). DM Thread empty (3.7) for a freshly created conversation is also purely informational — input bar is still fully active and focused, inviting the user to type the first message immediately.
- **Error states**: red `bg-red-50 text-red-600` block + `[ Thử lại ]` retry button, identical to `FriendsPanel`'s `ErrorState`, for both inbox fetch failure and thread fetch failure.
- **Keyboard**: thread input submits on Enter (matches `ChatPanel`'s `onKeyDown` pattern exactly — recommend literally sharing the composer component, see Component Breakdown note on extracting `MessageComposer`).
- **Mobile layout**: on mobile (`<md`), the Chat pane is the full-width top/primary panel already (per existing `page.tsx` grid: `grid-cols-1` stacks Chat above Map). The tab switcher (3.1) sits at the very top of that stacked Chat pane, same position `ChatPanel`'s header currently occupies. No new mobile-specific navigation pattern needed — the existing single-column stacking already accommodates inbox/thread/global swapping within the same pane.
- **Desktop layout**: no layout change to the `md:grid-cols-2` Chat | Map split — DM inbox/thread render within the same left-column slot `ChatPanel` already occupies. No third column, no overlay (unlike `FriendsPanel`, which is a drawer because Friends needed to coexist visually with Chat+Map; DM does not need to coexist with Global chat, since they're mutually exclusive tab states of the same pane).

---

## 6. Future ideas (explicitly out of scope — do not build now)

- Typing indicator in DM (THINK #2 — deferred; would need `typing-dm-{conversationId}` channel scoping per STATE's risk notes).
- Read receipts / "đã xem" marks (THINK #6 — deferred).
- Unread badge count on the "Tin nhắn" tab or per-conversation (THINK #7 — deferred; MVP is "open it, see new messages live" only).
- Pagination / infinite scroll for long DM history (THINK #4 — deferred; load-last-100 is sufficient for MVP).
- Rate limiting / spam prevention on DM sends (THINK #10 — deferred, consistent with friends feature's "no limits" stance).
- Media/file attachments in DM (explicitly OUT per ANALYZE).
- Group chat / multi-person conversations (explicitly OUT per ANALYZE — this DM model is intentionally not a foundation for group chat without a redesign).
- Search within DM history.
- Push notifications for new DMs when the app is closed/backgrounded.
- A persistent "last opened thread" memory (re-opening "Tin nhắn" tab always lands on inbox, not the last thread, per the locked journey in section 1 — could reconsider later as a convenience).

---

## 7. Open Design Questions

Genuine new taste calls not already locked in THINK. Since this is a full unattended autopilot run, a best-guess default is applied to each so `/plan` is not blocked — flagged here for human override before/while `/plan` proceeds.

1. **Relative timestamp formatting in DM Inbox** (3.4). Exact granularity/labels for "today = HH:MM, yesterday = 'Hôm qua', older = 'N ngày'" vs. an exact date — not specified anywhere in STATE. Default applied: the three-tier scheme shown in 3.4 (`HH:MM` today / `Hôm qua` / `N ngày`), loosely matching common chat-app conventions (Messenger/Zalo). A precise cutoff rule (e.g. what happens after 7 days — switch to a date?) is left to `/build`-time implementation detail, not re-specified here.
2. **Direct-to-thread vs. direct-to-inbox after "Nhắn tin" tap.** Section 1's journey assumes tapping "Nhắn tin" jumps straight into the thread (skipping inbox), since the user already explicitly chose a person. An alternative would be: always land on inbox first, with the new/target conversation highlighted at the top. Default applied: **jump straight to thread** (matches Messenger/Zalo's "message a contact" behavior, fewer taps, matches the stated user journey request in the task). Flagging in case the architect/user prefers the inbox-first, more discoverable alternative.
3. **Does the "Tin nhắn" tab remember the last open thread across tab switches within the same session?** E.g. user opens `@alice99`'s thread, switches to "Chung", switches back to "Tin nhắn" — do they land on the inbox (per locked journey step 9) or back on `@alice99`'s thread (cheaper mental model, fewer taps for an active back-and-forth conversation during a session)? Default applied per the explicit journey text in the task: **always land on inbox** when re-entering the "Tin nhắn" tab fresh, EXCEPT immediately after a "Nhắn tin" trigger (per Q2 above) or while already inside a thread and just tab-switching away-and-back within the same `DmPanel` mount (in which case, since `DmPanel`'s internal `view`/`activeConversationId` state simply persists across a tab show/hide if the component stays mounted — this is more of an implementation detail than a UX decision, default behavior is "state persists if component isn't unmounted, resets to inbox if it is" — flagging because it depends on whether `/plan` chooses to keep `DmPanel` mounted-but-hidden vs. unmount-on-tab-switch).
4. **Banner tone/copy exact wording for the blocked-send state** (3.11). Applied default copy: "Bạn không còn là bạn bè với @alice99 nên không thể gửi tin nhắn mới." A human should sanity-check this phrasing for tone (could be perceived as cold) — alternatives like a softer "Cuộc trò chuyện này đã đóng vì không còn là bạn bè" are equally valid; this is a copy-only taste call, not a structural one.
5. **Should `ChatPanel` and `DmThread` share a literal extracted sub-component (`MessageList`/`MessageComposer`)**, or is it acceptable for `/build` to duplicate the bubble-rendering JSX between the two? Section 4 recommends extraction to avoid drift between Global and DM bubble styling over time. Default applied: **recommend extraction**, but this is an architect/build-time call, not a hard design requirement — flagging since it affects how much refactoring touches the existing, working `chat-panel.tsx`.

---

**Next action**: run `/plan` — architect should read this file alongside `docs/loops/dm-chat-STATE.md` to design the `conversations`/DM-messages schema (and decide how global chat folds into or stays separate from it, per THINK #1's flexibility), RLS policies (re-checking friend status at send-time per the locked technical decision), Realtime scoping per `conversation_id`, and the hooks implied above (`useDmConversations`, `useDmMessages`), using the component contracts in section 4 as the target interface.
