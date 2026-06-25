# Design — Group Chat (multi-user, friend-gated, max 50 members)

> Phase: **DESIGN**. Input: `docs/loops/group-chat-STATE.md` (ANALYZE + THINK locked — do NOT re-litigate).
> Output consumed by `/plan` (architect designs `group_conversations` / `group_members` / `group_messages` — tách bảng riêng per THINK #8).

Locked scope reminder (do not re-decide):
- Friend-gating: creator-to-each-member only (member↔member need NOT be friends).
- Only creator adds/removes members; members may self-leave; no multi-admin.
- Max 50 members (hard limit, client + DB enforced).
- No rename, no avatar/icon, no typing indicator, no read receipts.
- No pagination — load last N messages, same as DM/global.
- UI placement: third tab in `ChatTabs` — "Chung" / "Tin nhắn" / "Nhóm".
- Group creation requires ≥1 initial member besides creator.
- History stays visible after leaving/removal; only new sends are blocked.

## 0. Existing conventions observed (must match — read directly from code)

- `src/components/chat-tabs.tsx`: tab bar uses a local `TabButton` (`border-b-2`, active = `border-blue-600 text-blue-600`). Adding a third tab is a **literal third `<TabButton>` + third branch** in the `activeTab === ...` conditional — no new tab-bar component needed, just extend `ChatTab` to `"global" | "dm" | "group"`.
- `src/components/dm-panel.tsx`: the `DmPanel` shape (`view: "inbox" | "thread"` internal state, `pendingOpen*` props for external "jump straight to X" triggers, unmount-on-tab-leave for Realtime cleanup per PLAN decision) is the **direct template** for `GroupPanel`. Group reuses this shape almost 1:1, with `view: "inbox" | "create" | "thread" | "members"` (one more state than DM, for the create-form and member-management screens).
- `src/components/friends-panel.tsx`: `FriendRow` already has a `[Nhắn tin]` button pattern (ghost rounded-full button before the `[⋯]` kebab) — group's "creator-only remove" button and "Add member" picker should reuse this exact row/button visual language, not invent new ones.
- `src/components/ui/states.tsx`: `EmptyState`, `ErrorState`, `SkeletonRows` — reused as-is, zero new visual states needed for loading/error/empty in group screens.
- Message bubble styling (`DmThread` inside `dm-panel.tsx`, lines ~272-290): sender label + time row (`text-xs text-zinc-500`), bubble `rounded-2xl px-3 py-2 text-sm`, mine = `bg-blue-600 text-white` right-aligned, theirs = `bg-zinc-100 dark:bg-zinc-800` left-aligned. **Group thread reuses this verbatim**, with one addition: since a group has >1 "theirs" sender, the sender label must show the actual sender's `@username` per message (DM only ever shows the one fixed peer's name) — this is the one real visual delta from DM thread.
- Blocked-send banner (`DmThread`, `sendBlockedReason === "unfriended"`): neutral `bg-zinc-50 text-zinc-600 dark:bg-zinc-800/50` info banner above the input, input itself `disabled` with explanatory placeholder. Group's "you were removed/left" state reuses this exact banner treatment with different copy.
- `src/lib/types.ts`: `Friend { id, username, requestId }`, `DmConversation { id, peerId, peerUsername, lastMessageBody, lastMessageAt, lastMessageMine }` — group needs parallel types (`GroupConversation`, `GroupMember`, `GroupMessage`) following the same "hook returns UI-ready joined data" convention (component never joins/queries raw IDs itself).
- Vietnamese UI copy throughout, `@username` prefix convention, no native `confirm()` — inline confirm-expansion pattern (`FriendRow`'s `confirming` state) for destructive actions (unfriend, remove member, leave group).

This design treats **`GroupPanel`** as the third tab's content, structurally parallel to `DmPanel`, composing four sub-views: `GroupInbox`, `CreateGroupForm`, `GroupThread`, `GroupMemberList`.

---

## 1. User Journey (happy path)

1. **Entry**: User is on the existing Chat pane, now showing three tabs: **"Chung"** / **"Tin nhắn"** / **"Nhóm"**. User taps **"Nhóm"**.
2. Lands on the **Group Inbox** — list of groups they're currently a member of (name + last message preview + relative time), or an empty state with a **"+ Tạo nhóm"** button if they have none yet (unlike DM inbox, which has no inbox-level CTA — group inbox DOES have one, since group creation has no equivalent of DM's "Nhắn tin from Friends panel" external trigger; the only entry point for creating a group is inside the group tab itself).
3. User taps **"+ Tạo nhóm"** → **Create Group form** opens (replaces inbox content, not a separate route): a name input + a multi-select list of friends (sourced from the existing friends list, reusing `useFriends`).
   - If the user has zero friends, the form shows an inline notice: "Bạn cần có ít nhất 1 bạn bè để tạo nhóm" with a link/button to open Friends panel — group creation is impossible without friends, this must be surfaced clearly, not just a disabled button with no explanation.
4. User types a group name, taps 2-3 friends to select them (chips/checkmarks appear), and taps **"Tạo nhóm"**.
   - Client validates: name non-empty (trimmed), ≥1 member selected. If invalid, inline error appears next to the relevant field — no DB call.
5. On success: group is created server-side (group + creator membership + selected members' memberships, atomically). UI transitions directly into the **Group Thread** view for the new group (same "jump straight to thread" pattern as DM's "Nhắn tin" trigger — user just configured this group, no reason to detour through the inbox).
6. User sees **Group Thread**: header shows group name + a member-count pill (e.g. "3 thành viên") that's tappable → opens **Member List** screen. Message area is empty ("Hãy bắt đầu trò chuyện trong nhóm"), input bar active.
7. User sends a message → appears in thread (non-optimistic, same as DM/global). Other members with the thread open see it appear live within ~2s via Realtime.
8. User taps the **member-count pill** → **Member List** screen opens: shows all current members (creator labeled distinctly, e.g. "(Người tạo)"), each member row has a **[Xóa]** button **visible only because this user is the creator** (non-creators see no remove button on others' rows, only a **[Rời nhóm]** button for themselves at the bottom).
9. User (creator) taps **"+ Thêm thành viên"** inside Member List → a friend-picker (reusing the same multi-select component from group creation, pre-filtered to exclude existing members) appears → selects 1+ friends not yet in the group → confirms → they're added, member list updates, the new members will see the group appear in their own Group Inbox immediately (Realtime).
   - If adding would exceed 50 members, the picker disables further selection past the remaining slots and shows "Đã đạt giới hạn 50 thành viên".
10. User (creator) taps **[Xóa]** next to a non-creator member → inline confirm ("Xóa @bob_tran khỏi nhóm?") → confirms → member removed. That member, if they have the group thread open, sees the thread flip into the **blocked-send state** (history stays visible, input disabled, banner explains they were removed) the next time they try to send or on next Realtime membership update.
11. Separately, a regular member (not creator) opens Member List and taps **[Rời nhóm]** at the bottom (always visible to every member for themselves, including the creator's own row showing no `[Rời nhóm]` since creator leaving is allowed too but flagged as "orphaning" the group per THINK #9 — no special UI warning beyond the same confirm, since STATE explicitly accepts this as known tech debt) → inline confirm → leaves → returns to Group Inbox, and the group disappears from their own inbox list (but remains for everyone else, with history intact).
12. User taps **"Nhóm"** tab again later (fresh session or after navigating away) → lands back on **Group Inbox** (not the last-open thread, consistent with DM's locked "always land on inbox" behavior) → sees updated list, taps a row → reopens that **Group Thread**.

---

## 2. Screen Inventory

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **Group Inbox — empty** (0 groups) | Tap "Nhóm" tab, `groups.length === 0` | Tap "+ Tạo nhóm" → Create Group form |
| 2 | **Group Inbox — with groups** | Tap "Nhóm" tab, has existing groups | Tap a row → Group Thread; tap "+ Tạo nhóm" → Create Group form |
| 3 | **Group Inbox — loading** | Tab just opened, fetch in flight | resolves to #1 or #2 |
| 4 | **Group Inbox — error** | Fetch failed | Retry button |
| 5 | **Group Inbox — no-friends notice** (variant surfaced inside Create Group form, not inbox itself — see #6) | — | — |
| 6 | **Create Group form — empty/initial** | Tap "+ Tạo nhóm" from inbox | Cancel → back to Inbox; Submit (valid) → Group Thread (new group) |
| 7 | **Create Group form — validation error** (empty name / 0 members selected) | Submit attempt with invalid input | Fix input → resubmit |
| 8 | **Create Group form — no friends available** | Form opened, `friends.length === 0` | Link to open Friends panel; Cancel → back to Inbox |
| 9 | **Create Group form — submitting** | Valid submit, request in flight | resolves to Group Thread or inline server error |
| 10 | **Group Thread — empty (new group, no messages)** | Just created, or opened existing group with 0 messages | Back button → Inbox; member pill → Member List |
| 11 | **Group Thread — with messages** | Opened from inbox row tap | Back → Inbox; member pill → Member List |
| 12 | **Group Thread — loading** | Thread just opened, fetch in flight | resolves to #10 or #11 |
| 13 | **Group Thread — error** (fetch failed) | Fetch failed | Back / Retry |
| 14 | **Group Thread — blocked-send state** (current user removed/left, history still visible) | Reopening a group thread after removal/leaving, or a live removal while thread is open | Back → Inbox (group no longer listed there after this) |
| 15 | **Member List — viewed by creator** (remove buttons visible) | Tap member-count pill in Group Thread header, current user is creator | Back → Group Thread |
| 16 | **Member List — viewed by regular member** (no remove buttons, only own "Rời nhóm") | Tap member-count pill, current user is not creator | Back → Group Thread |
| 17 | **Member List — add-member picker** (sub-state, creator only) | Tap "+ Thêm thành viên" inside Member List | Cancel → back to Member List; Confirm → Member List (updated) |
| 18 | **Member List — remove confirm** (inline expansion on a member row, creator only) | Tap "[Xóa]" on a member row | Cancel collapses; Confirm removes + collapses |
| 19 | **Member List — leave confirm** (inline expansion on own row/footer button) | Tap "[Rời nhóm]" | Cancel collapses; Confirm → exits to Group Inbox |
| 20 | **Member List — 50-member limit reached** (variant of #17) | Add-picker opened when group already at or near 50 | Selection capped, explanatory text shown |
| 21 | **Not logged in state** (Group tab content if session expires) | Tab opened while `!user` | Login CTA |

Not a separate route — all states live inside the existing Chat pane, switched via the `ChatTabs` control, consistent with DM's locked architecture (no `/groups/[id]`).

---

## 3. ASCII Wireframes

### 3.1 ChatTabs shell — three tabs (extends existing `chat-tabs.tsx`)

```
┌──────────────────────────────────┐
│ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │  ← third TabButton added, same underline style
├──────────────────────────────────┤
│                                    │
│   ...active tab content...        │
│                                    │
└──────────────────────────────────┘
```

No badge/count on "Nhóm" tab label (consistent with no-unread-badge decision carried over from DM THINK #7).

### 3.2 Group Inbox — empty

```
┌──────────────────────────────────┐
│ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │
├──────────────────────────────────┤
│  Nhóm của bạn      [+ Tạo nhóm] │  ← header + CTA button (unlike DM inbox,
├──────────────────────────────────┤     group inbox DOES have its own CTA)
│                                    │
│        👥  Chưa có nhóm nào      │
│   Tạo nhóm để chat cùng nhiều    │
│         người bạn cùng lúc        │
│                                    │
└──────────────────────────────────┘
```

### 3.3 Group Inbox — with groups

```
┌──────────────────────────────────┐
│ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │
├──────────────────────────────────┤
│  Nhóm của bạn      [+ Tạo nhóm] │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ Đi Đà Lạt                    │ │
│ │ @alice99: Mai khởi hành 6h  14:32│
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Team Backend                 │ │
│ │ Bạn: đã merge PR      Hôm qua│ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Gia đình                     │ │
│ │ Chưa có tin nhắn nào    3 ngày│ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

- Last-message preview prefixed with sender's `@username:` (group needs the sender name since >2 people; DM only used a bare "Bạn:" prefix since the other side is unambiguous). If current user sent it, prefix is "Bạn:" same as DM convention.
- Sorted by most recent activity descending, same as DM inbox.
- Tapping a row → Group Thread.

### 3.4 Group Inbox — loading / error (identical pattern to DM, reusing shared components)

```
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │        │ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │
├──────────────────────────────────┤        ├──────────────────────────────────┤
│  Nhóm của bạn      [+ Tạo nhóm] │        │  Nhóm của bạn      [+ Tạo nhóm] │
├──────────────────────────────────┤        ├──────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │        │   ⚠ Không tải được danh sách    │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │        │        nhóm                      │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │        │   Lỗi: <error message>          │
└──────────────────────────────────┘        │          [ Thử lại ]            │
                                              └──────────────────────────────────┘
```

### 3.5 Create Group form — initial / empty

```
┌──────────────────────────────────┐
│ [‹ Hủy]      Tạo nhóm mới        │
├──────────────────────────────────┤
│  Tên nhóm                        │
│  ( Nhập tên nhóm… )              │
│                                    │
│  Chọn thành viên (từ bạn bè)     │
│  ┌──────────────────────────────┐ │
│  │ ☐ @alice99                   │ │
│  ├──────────────────────────────┤ │
│  │ ☐ @bob_tran                  │ │
│  ├──────────────────────────────┤ │
│  │ ☐ @diana_k                   │ │
│  └──────────────────────────────┘ │
│  Đã chọn: 0 / 50                 │
├──────────────────────────────────┤
│            [ Tạo nhóm ]          │  ← disabled until name + ≥1 selected
└──────────────────────────────────┘
```

### 3.6 Create Group form — with selections + validation error

```
┌──────────────────────────────────┐
│ [‹ Hủy]      Tạo nhóm mới        │
├──────────────────────────────────┤
│  Tên nhóm                        │
│  ( Đi Đà Lạt )                   │
│  ⚠ Vui lòng nhập tên nhóm        │  ← shown only if submit attempted w/ empty name
│                                    │
│  Chọn thành viên (từ bạn bè)     │
│  ┌──────────────────────────────┐ │
│  │ ☑ @alice99                   │ │  ← checked rows highlighted
│  ├──────────────────────────────┤ │
│  │ ☑ @bob_tran                  │ │
│  ├──────────────────────────────┤ │
│  │ ☐ @diana_k                   │ │
│  └──────────────────────────────┘ │
│  Đã chọn: 2 / 50                 │
├──────────────────────────────────┤
│            [ Tạo nhóm ]          │  ← now enabled
└──────────────────────────────────┘
```

### 3.7 Create Group form — no friends available

```
┌──────────────────────────────────┐
│ [‹ Hủy]      Tạo nhóm mới        │
├──────────────────────────────────┤
│  Tên nhóm                        │
│  ( Nhập tên nhóm… )              │
│                                    │
│   👥  Bạn cần có ít nhất 1 bạn   │
│       bè để tạo nhóm              │
│      [ Mở Bạn bè ]               │  ← opens FriendsPanel
├──────────────────────────────────┤
│         [ Tạo nhóm ] (off)       │
└──────────────────────────────────┘
```

### 3.8 Create Group form — submitting

```
┌──────────────────────────────────┐
│ [‹ Hủy]      Tạo nhóm mới        │
├──────────────────────────────────┤
│  Tên nhóm                        │
│  ( Đi Đà Lạt )           (disabled)│
│  Chọn thành viên                 │
│  ┌──────────────────────────────┐ │
│  │ ☑ @alice99      (disabled)   │ │
│  │ ☑ @bob_tran     (disabled)   │ │
│  └──────────────────────────────┘ │
├──────────────────────────────────┤
│       [ Đang tạo nhóm… ]         │  ← spinner/label swap, all inputs disabled
└──────────────────────────────────┘
```

### 3.9 Group Thread — empty (new group, no messages)

```
┌──────────────────────────────────┐
│ [‹ Nhóm]  Đi Đà Lạt  [3 thành viên]│ ← back + group name + tappable member pill
├──────────────────────────────────┤
│                                    │
│       💬  Hãy bắt đầu trò        │
│          chuyện trong nhóm        │
│                                    │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │
└──────────────────────────────────┘
```

### 3.10 Group Thread — with messages (note: sender label shown per message, unlike DM)

```
┌──────────────────────────────────┐
│ [‹ Nhóm]  Đi Đà Lạt  [3 thành viên]│
├──────────────────────────────────┤
│  @alice99 · 14:01                │
│  ┌───────────────┐               │
│  │ Mọi người sẵn  │               │
│  │ sàng chưa?     │               │
│  └───────────────┘               │
│                       14:02 · Bạn│
│               ┌────────────────┐ │
│               │ Sẵn sàng rồi!  │ │
│               └────────────────┘ │
│  @bob_tran · 14:05                │
│  ┌──────────────────────┐        │
│  │ Mai khởi hành 6h nhé │        │
│  └──────────────────────┘        │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )        [Gửi] │
└──────────────────────────────────┘
```

- Bubble styling identical to DM/global: mine = `bg-blue-600 text-white` right-aligned, theirs = `bg-zinc-100 dark:bg-zinc-800` left-aligned.
- **Delta from DM**: every "theirs" bubble shows the actual sender's `@username` above it (DM always showed the one fixed peer name; group has N possible senders).
- No typing indicator, no read receipts (locked OUT of scope).
- Auto-scroll to bottom on new message, same `bottomRef.scrollIntoView` pattern.

### 3.11 Group Thread — loading

```
┌──────────────────────────────────┐
│ [‹ Nhóm]  Đi Đà Lạt  [… thành viên]│ ← member count shows "…" until member list also resolves
├──────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )    [Gửi](off)│
└──────────────────────────────────┘
```

### 3.12 Group Thread — error

```
┌──────────────────────────────────┐
│ [‹ Nhóm]  Đi Đà Lạt               │
├──────────────────────────────────┤
│                                    │
│   ⚠ Không thể mở nhóm này        │
│    Lỗi: <error message>           │
│           [ Thử lại ]             │
│                                    │
├──────────────────────────────────┤
│ ( Nhập tin nhắn… )    [Gửi](off)│
└──────────────────────────────────┘
```

### 3.13 Group Thread — blocked-send state (removed/left, history still visible)

```
┌──────────────────────────────────┐
│ [‹ Nhóm]  Đi Đà Lạt               │  ← member pill HIDDEN here — ex-member can't
├──────────────────────────────────┤     view current member list anymore
│  @alice99 · Hôm qua                │
│  ┌───────────────┐               │
│  │ Mọi người sẵn  │               │
│  │ sàng chưa?     │               │
│  └───────────────┘               │
│                     Hôm qua · Bạn │
│               ┌────────────────┐ │
│               │ Sẵn sàng rồi!  │ │
│               └────────────────┘ │
├──────────────────────────────────┤
│  ⓘ Bạn không còn là thành viên   │
│    nhóm này nên không thể gửi    │
│    tin nhắn mới.                  │
├──────────────────────────────────┤
│ ( Không còn là thành viên… )     │  ← input disabled, explanatory placeholder
│                      [Gửi] (off) │
└──────────────────────────────────┘
```

- Same neutral info-tone banner treatment as DM's unfriended state (`bg-zinc-50 text-zinc-600`, NOT red).
- History remains fully visible/scrollable (THINK #2 — locked).
- Member-count pill is removed/hidden in this state (an ex-member should not retain access to live member-list queries — RLS would reject it anyway; hiding it client-side avoids a dead/erroring affordance).

### 3.14 Member List — viewed by creator (remove buttons visible)

```
┌──────────────────────────────────┐
│ [‹ Đi Đà Lạt]   Thành viên (3)   │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ @huy_nguyen (Người tạo)      │ │  ← creator's own row, no remove/leave button
│ └──────────────────────────────┘ │     shown here (creator manages via footer—see below)
│ ┌──────────────────────────────┐ │
│ │ @alice99            [ Xóa ]  │ │  ← visible only because viewer IS creator
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @bob_tran            [ Xóa ] │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│      [ + Thêm thành viên ]       │  ← creator-only action
├──────────────────────────────────┤
│         [ Rời nhóm ]             │  ← every member incl. creator can leave
└──────────────────────────────────┘
```

### 3.15 Member List — viewed by regular member (no remove buttons)

```
┌──────────────────────────────────┐
│ [‹ Đi Đà Lạt]   Thành viên (3)   │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ @huy_nguyen (Người tạo)      │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @alice99                      │ │  ← viewer themself, no action on own row here
│ └──────────────────────────────┘ │     (leave is the footer button, not inline)
│ ┌──────────────────────────────┐ │
│ │ @bob_tran                      │ │  ← no [Xóa] — viewer is not creator
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│  (không có nút "Thêm thành viên")│  ← entirely absent, not just disabled
├──────────────────────────────────┤
│         [ Rời nhóm ]             │
└──────────────────────────────────┘
```

### 3.16 Member List — remove confirm (inline expansion, creator only)

```
┌──────────────────────────────────┐
│ [‹ Đi Đà Lạt]   Thành viên (3)   │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ @huy_nguyen (Người tạo)      │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @alice99            [ Xóa ]  │ │
│ │ ─────────────────────────── │ │
│ │ Xóa @alice99 khỏi nhóm?      │ │
│ │      [ Hủy ]  [ Xác nhận ]   │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ @bob_tran            [ Xóa ] │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│      [ + Thêm thành viên ]       │
├──────────────────────────────────┤
│         [ Rời nhóm ]             │
└──────────────────────────────────┘
```

Same inline-confirm-expansion pattern as `FriendRow`'s unfriend confirm — no native `confirm()`.

### 3.17 Member List — leave confirm (inline expansion at footer)

```
┌──────────────────────────────────┐
│ [‹ Đi Đà Lạt]   Thành viên (3)   │
├──────────────────────────────────┤
│  ...member rows unchanged...     │
├──────────────────────────────────┤
│      [ + Thêm thành viên ]       │  ← creator only, hidden for regular members
├──────────────────────────────────┤
│  Rời khỏi nhóm "Đi Đà Lạt"?      │
│       [ Hủy ]  [ Xác nhận rời ]  │
└──────────────────────────────────┘
```

### 3.18 Member List — add-member picker (creator only)

```
┌──────────────────────────────────┐
│ [‹ Thành viên]  Thêm thành viên  │
├──────────────────────────────────┤
│  Chọn từ bạn bè chưa có trong    │
│  nhóm                             │
│  ┌──────────────────────────────┐ │
│  │ ☐ @diana_k                   │ │
│  ├──────────────────────────────┤ │
│  │ ☐ @evan_le                   │ │
│  └──────────────────────────────┘ │
│  Đã chọn: 0 · Còn lại: 47 chỗ   │  ← shows remaining capacity, not just total
├──────────────────────────────────┤
│           [ Thêm ]               │  ← disabled until ≥1 selected
└──────────────────────────────────┘
```

If the creator has no friends outside the current group (all friends are already members), this screen shows an `EmptyState`: "Không còn bạn bè nào để thêm — tất cả bạn bè của bạn đã ở trong nhóm này."

### 3.19 Member List — add-member picker, 50-limit reached

```
┌──────────────────────────────────┐
│ [‹ Thành viên]  Thêm thành viên  │
├──────────────────────────────────┤
│  ⚠ Nhóm đã đạt giới hạn 50       │
│    thành viên, không thể thêm    │
│    nữa.                           │
│  ┌──────────────────────────────┐ │
│  │ ☐ @diana_k        (disabled) │ │
│  ├──────────────────────────────┤ │
│  │ ☐ @evan_le        (disabled) │ │
│  └──────────────────────────────┘ │
│  Đã chọn: 0 · Còn lại: 0 chỗ    │
├──────────────────────────────────┤
│         [ Thêm ] (off)           │
└──────────────────────────────────┘
```

If the group has, say, 48 members (2 slots left) and the creator tries to select 3 friends, the 3rd checkbox becomes disabled the moment 2 are checked, with the same warning banner showing "Còn lại: 0 chỗ" dynamically as selection changes.

### 3.20 Not logged in state (Group tab content)

```
┌──────────────────────────────────┐
│ [ Chung ] [ Tin nhắn ] [ Nhóm ]  │
├──────────────────────────────────┤
│   Đăng nhập để xem nhóm của bạn  │
│        [ Đăng nhập ]              │
└──────────────────────────────────┘
```

---

## 4. Component Breakdown

> No real shadcn `components/ui/*` primitives in the repo — hand-rolled Tailwind, matching DM/Friends precedent exactly.

### `ChatTabs` (existing, modified — `src/components/chat-tabs.tsx`)
- Extend `ChatTab` type: `"global" | "dm" | "group"`.
- Add third `<TabButton>` ("Nhóm") and a third branch rendering `<GroupPanel />`.
- No new props needed beyond what DM already required (no external "pending open" trigger for groups — unlike DM, there's no "Nhắn tin"-style external entry point into a specific group from another panel; all group navigation originates inside the Group tab itself). If this changes later (e.g. a "View group" link from a map marker), revisit.

### `GroupPanel` (new — parallel to `DmPanel`)
- No external props needed (no pending-open trigger, per above) — purely self-contained, like `DmPanel` minus its `pendingOpen*` props.
- Internal state: `view: "inbox" | "create" | "thread" | "members" | "addMember"`, `activeGroupId: string | null`.
- Composes `GroupInbox`, `CreateGroupForm`, `GroupThread`, `GroupMemberList`.
- Unmounts on tab-leave (same Realtime-cleanup rationale as `DmPanel`, per PLAN decision carried over).

### `GroupInbox` (new — parallel to `DmInbox`)
- Reads from a `useGroupConversations()` hook (architect to define): `{ groups, loading, error, refetch }`, each group `{ id, name, lastMessageBody, lastMessageAt, lastMessageSenderUsername, lastMessageMine, memberCount }`.
- Renders `GroupConversationRow[]`, `EmptyState`, `ErrorState`, or `SkeletonRows` — identical branching to `DmInbox`.
- Has its own `[+ Tạo nhóm]` button in the header (unlike DM inbox, which has no inbox-level CTA) — emits `onCreateGroup: () => void` → `GroupPanel` switches `view` to `"create"`.
- Emits `onOpenGroup: (groupId: string) => void` → `GroupPanel` switches `view` to `"thread"`.

### `GroupConversationRow` (new — parallel to `DmConversationRow`)
- Props: `group: { id, name, lastMessageBody, lastMessageAt, lastMessageSenderUsername, lastMessageMine }`, `onClick: () => void`.
- Preview line: `"Bạn: " + body` if mine, else `"@${senderUsername}: " + body`, else "Chưa có tin nhắn nào" if null — small delta from DM (which never needed a sender-name prefix for others' messages, since DM only has one possible "other" sender).

### `CreateGroupForm` (new)
- Reads from `useFriends()` (existing hook, reused as-is) for the friend list to select from.
- Reads/writes from a `useCreateGroup()` hook (architect to define): `{ create: (name: string, memberIds: string[]) => Promise<{ groupId: string | null; error: string | null }>, submitting: boolean }`.
- Internal state: `name: string`, `selectedIds: Set<string>`, `nameError: string | null`.
- Composes `FriendMultiSelect` for the picker portion.
- Emits `onCreated: (groupId: string) => void` (→ `GroupPanel` switches to `"thread"` with that id) and `onCancel: () => void` (→ back to inbox).
- Client-side validation before calling `create`: name non-empty trimmed, `selectedIds.size >= 1`. Mirrors `AddFriendForm`'s validate-before-submit pattern.

### `FriendMultiSelect` (new, reusable — used by both `CreateGroupForm` and the add-member picker inside `GroupMemberList`)
- Props: `friends: Friend[]` (already filtered by caller — e.g. excluding existing group members for the add-picker case), `selectedIds: Set<string>`, `onToggle: (friendId: string) => void`, `maxSelectable?: number` (caps further selection once reached — used for the 50-member-limit enforcement in the add-picker), `disabledReason?: string` (shown as a banner when `maxSelectable` is reached, e.g. "Đã đạt giới hạn 50 thành viên").
- No internal state — fully controlled by parent (parent owns `selectedIds`), keeping it a pure, reusable list-selection primitive.
- Renders checkbox-style rows (`☐`/`☑` + `@username`), matching `FriendRow`'s row visual but without the kebab/message actions (this is a *selection* list, not an *actions* list).

### `GroupThread` (new — parallel to `DmThread`)
- Props: `groupId: string`, `groupName: string`, `onBack: () => void`, `onOpenMembers: () => void`.
- Reads from a `useGroupMessages(groupId)` hook (architect to define, parallel to `useDmMessages`): `{ messages, loading, error, canSend, sendBlockedReason, send }` where each message includes `{ id, senderId, senderUsername, body, createdAt }` (note: DM messages didn't need `senderUsername` per-message since the bubble already knew which side was "theirs" — group messages DO need it inline, since multiple distinct "theirs" senders exist).
  - `sendBlockedReason: "removed" | null` (renamed from DM's `"unfriended"` — same shape, different cause).
- Reads member count separately via a lightweight `useGroupMembers(groupId)` (shared with `GroupMemberList`, see below) just for the header pill's `count` and to know `isCreator` (controls whether the member pill is visible at all in the blocked-send state, and whether `GroupMemberList` shows remove buttons).
- Header: back button + group name + tappable member-count pill (`onOpenMembers`) — pill is hidden if `sendBlockedReason` is set (ex-member, per 3.13).
- Reuses bubble-rendering and input-bar JSX pattern from `DmThread`/`ChatPanel`, with the one addition of rendering `senderUsername` per "theirs" message instead of a single fixed peer name. **Recommend (same as DM design doc's note) extracting a shared `MessageList`/`MessageComposer` presentational component** at `/plan`/`/build` time so `ChatPanel`, `DmThread`, and `GroupThread` don't triple-duplicate this bubble JSX — now even more worth doing with a third consumer.

### `GroupMemberList` (new)
- Props: `groupId: string`, `groupName: string`, `onBack: () => void`, `onLeft: () => void` (called after the viewer successfully leaves/removes themselves — `GroupPanel` then routes back to inbox since the thread is no longer accessible).
- Reads from a `useGroupMembers(groupId)` hook (architect to define): `{ members, loading, error, isCreator, creatorId, removeMember: (userId) => Promise<{error}>, leaveGroup: () => Promise<{error}>, addMembers: (userIds: string[]) => Promise<{error}> }`.
- Internal state: `view: "list" | "addMember"`, `confirmingRemoveId: string | null`, `confirmingLeave: boolean`.
- Renders member rows: creator row labeled `(Người tạo)`, `[Xóa]` button per non-creator row **only if `isCreator === true`** (viewer-side conditional, but the actual authorization is enforced server-side via RLS — client hiding the button is UX-only, not the security boundary).
- Footer: `[+ Thêm thành viên]` button (creator-only, switches internal `view` to `"addMember"`, rendering `FriendMultiSelect` filtered to friends not already in `members`) + `[Rời nhóm]` button (always visible to every member, including creator).
- Inline confirm pattern for both remove and leave, matching `FriendRow`'s `confirming` state shape exactly.

### `EmptyState`, `ErrorState`, `SkeletonRows` (existing, reused as-is from `src/components/ui/states.tsx`)
- No changes needed — group screens consume these exactly as DM/Friends do.

### `src/lib/types.ts` (existing, extended)
- New types needed (additive, architect to finalize exact shape): `GroupConversation { id, name, lastMessageBody, lastMessageAt, lastMessageSenderUsername, lastMessageMine, memberCount }`, `GroupMember { id, username, isCreator }`, `GroupMessage { id, groupId, senderId, senderUsername, body, createdAt }`.

---

## 5. Interaction Notes

- **Tab switch ("Nhóm" tab)**: same prefetch-once-then-free pattern as DM/Friends tabs — `GroupPanel` mounts/unmounts on tab-leave (per the same Realtime-cleanup decision carried from DM PLAN), so re-entering the tab always re-fetches the inbox (acceptable — consistent with DM's locked behavior, not a regression).
- **Create-group → thread transition**: same "skip the inbox, land directly on the thing you just configured" pattern as DM's "Nhắn tin" trigger. No extra confirmation screen after tapping "Tạo nhóm" — success means immediate navigation into the new thread.
- **Group creation latency**: creating a group is a multi-row server operation (group row + N membership rows, must be atomic). Show the **Create Group form — submitting** state (3.8, all inputs disabled, button text swaps to "Đang tạo nhóm…") rather than a separate full-screen spinner — keeps the user's input visible while waiting, consistent with `AddFriendForm`'s `submitting` pattern.
- **Member-count pill staleness**: the pill's count should update live as members are added/removed (via the same Realtime subscription `useGroupMembers` already needs for the Member List screen) — even while the user is sitting in the Group Thread view without having opened Member List, the pill number should reflect reality, since other members' add/remove actions are visible to everyone via Realtime per the locked acceptance criteria.
- **Sending a message**: non-optimistic, identical to DM/global — input clears on submit, message appears only after server confirms. Failure restores the draft + shows inline `⚠ Không gửi được, thử lại` under the input, matching DM's edge-case-11 handling exactly.
- **Realtime receive (message)**: new message fades in + auto-scrolls, identical to DM. No sound/toast.
- **Realtime receive (membership change)**: if the *current viewer* is removed/leaves while their own thread is open, the thread should transition into the blocked-send state (3.13) **reactively**, without requiring the user to navigate away and back — detected either via a Realtime event on `group_members` scoped to their own membership row disappearing, or via the next failed-send attempt being treated as the trigger (same "RLS denial on send = same as pre-detected blocked state" fallback pattern used in DM design). If *another* member is removed/leaves while the viewer has Member List open, that row should disappear live from the list.
- **Group Inbox row disappearing on self-leave/removal**: once the viewer leaves or is removed, their own Group Inbox list should drop that row on next fetch/Realtime update — they should never see a stale "ghost" row that, when tapped, leads to a confusing blocked thread. (Acceptable fallback if real-time inbox pruning isn't trivial: tapping a stale row still correctly lands on the blocked-send thread state 3.13, which is self-explanatory — not a hard failure, just a slightly less polished path.)
- **50-member limit feedback**: enforced at three layers for UX clarity — (a) `FriendMultiSelect`'s `maxSelectable` prop disables further checkbox selection once the cap is reached, showing the "Đã đạt giới hạn" banner inline; (b) the add-member confirm button is disabled if the would-be resulting count exceeds 50 (defensive, in case of a stale count); (c) a server-side rejection (race: two adds happening near-simultaneously crossing 50) surfaces as an inline error on the add-member screen ("Nhóm đã đầy, không thể thêm."), not a silent failure.
- **Creator-only controls visibility**: `[Xóa]` per-member buttons and `[+ Thêm thành viên]` are **entirely absent from the DOM** for non-creators (not merely disabled) — avoids any "why is this greyed out" confusion, and reduces accidental taps on a control that would just get RLS-rejected anyway. The real authorization boundary is server-side RLS regardless of what the client renders.
- **Blocked-send state detection on open**: same dual-check pattern as DM — (a) check membership status once when thread/member-list opens (so the banner shows immediately if already removed), (b) treat any RLS-denial on a live send attempt as equivalent, flipping to the same blocked UI reactively even if the client's cached membership state was stale.
- **Leave vs. remove confirm copy**: leave uses first-person framing ("Rời khỏi nhóm 'X'?"), remove uses the target's name ("Xóa @bob_tran khỏi nhóm?") — both follow `FriendRow`'s unfriend-confirm tone (calm, neutral, no scary red language beyond the destructive-action button color).
- **Creator leaving (orphaning the group)**: no special extra warning dialog beyond the standard leave-confirm, per THINK #9's explicit acceptance of this as known tech debt — adding a scarier warning here would imply a product guarantee ("we'll handle this gracefully") that doesn't actually exist yet. Keep it boring and consistent with regular-member leave.
- **Loading states**: `SkeletonRows` reused identically for Group Inbox, Group Thread, and Member List — no new skeleton design.
- **Empty states**: Group Inbox empty (3.2) DOES have a CTA (unlike DM inbox) since group creation's only entry point is inside this tab. Group Thread empty (3.9) and "no friends to add" states are purely informational with action buttons routing elsewhere (Friends panel, or back).
- **Keyboard**: thread input submits on Enter, matching `DmThread`/`ChatPanel` exactly (recommend literal shared `MessageComposer` extraction, noted in Component Breakdown).
- **Mobile layout**: same single-column stacking as DM — Group tab's inbox/create/thread/members states swap within the same Chat-pane slot, no new mobile-specific navigation chrome.
- **Desktop layout**: no layout change to the `md:grid-cols-2` Chat | Map split — Group views render in the same left-column slot `ChatPanel`/`DmPanel` already occupy.

---

## 6. Future ideas (explicitly out of scope — do not build now)

- Group rename (THINK #6 — deferred).
- Group avatar/icon (THINK #7 — deferred).
- Multi-admin / transferable ownership (THINK #4 — deferred, locked as creator-only).
- Typing indicator in group threads.
- Read receipts / per-member "đã xem" tracking (harder in groups than DM — N-way state).
- Unread badge count on "Nhóm" tab or per-group.
- Pagination / infinite scroll for long group history.
- Group-based map presence / location sharing (flagged as a likely future reuse of `group_members` per STATE's product risk notes — NOT built now, but membership table shape should anticipate it per architect's note).
- Mute/notification settings per group.
- Group search (within a group's history, or searching across groups).
- "Group full" smarter UX (e.g. waitlist, request-to-join) — out of scope, MVP just hard-caps at 50 with no queueing.

---

## 7. Open Design Questions

Genuine new taste calls not already locked in THINK. Full unattended autopilot run — best-guess default applied to each so `/plan` is not blocked; flagged here for human override.

1. **Does Group Inbox need its own "+ Tạo nhóm" CTA, or should group creation only be reachable from elsewhere (e.g. a "+" in the ChatTabs bar itself)?** Default applied: **CTA lives inside Group Inbox's header** (3.2/3.3), since unlike DM (which borrows Friends panel as its creation entry point), groups have no natural external trigger — the Group tab must be self-sufficient for creation. Low-risk default, easy to relocate later.

2. **Should the member-count pill in the Group Thread header be tappable as shown, or would a separate explicit "Thành viên" button/icon be clearer?** Default applied: **pill itself is the tap target** (matches the wireframe's compact header), since it's a common pattern (Messenger group headers show member avatars/count as the entry to group info). Low-risk, cosmetic-level call.

3. **Exact wording for "no friends to create a group" vs. "no friends left to add to an existing group"** — two distinct empty-state copies used (3.7 vs. the note under 3.18). Default applied as shown in wireframes; a human should sanity-check tone, same caveat as DM design doc's banner-copy question.

4. **Should the creator's own row in Member List show a `[Rời nhóm]` action inline (next to their name, like other members' `[Xóa]`), or only as the single shared footer button (3.14/3.15's chosen layout)?** Default applied: **single shared footer button for everyone** (simpler, one consistent action regardless of role, avoids the visual asymmetry of "creator row has a different button than member rows"). Flagging since some apps put per-row self-actions instead.

5. **Group name display truncation** — group names have no documented max length in STATE (unlike message body's 1-2000 char convention). Default applied: assume architect will set a reasonable cap (e.g. 60-100 chars) at `/plan` time consistent with typical username/title conventions elsewhere in the app; wireframes assume short names and don't show a truncation/ellipsis treatment for long names in the inbox row or thread header — flagging as a build-time detail, not re-specifying here.

6. **Relative-timestamp formatting in Group Inbox** — same open question already flagged and defaulted in `dm-chat-design.md` Q1 (today=HH:MM / "Hôm qua" / "N ngày"). Applying the identical default here for consistency, not re-litigating.

7. **Should `useGroupMembers` be a single hook shared by both `GroupThread` (for the pill count) and `GroupMemberList` (for the full list + mutations), or two separate hooks (a cheap count-only one, and a heavier full-list-with-mutations one)?** This is more of an architecture/perf call than a UI one — flagging for `/plan` since it affects whether opening a thread always also subscribes to full membership Realtime (more channels) or just a lightweight count. Default applied in Component Breakdown: **one shared hook**, simplicity over micro-optimization, consistent with the codebase's current preference for fewer, simpler hooks over premature splitting.

---

**Next action**: run `/plan` — architect should read this file alongside `docs/loops/group-chat-STATE.md` to design the `group_conversations` / `group_members` / `group_messages` schema (tách bảng riêng, per THINK #8), RLS policies (creator-to-each-member friend-gating on `group_members` INSERT, membership re-check at message send-time, creator-only remove, 50-member hard cap enforced via DB-level check/trigger), Realtime scoping per `group_id` (both for `group_messages` inserts and `group_members` changes — the pill/list live-update requirement in section 5 needs the latter, not just the former), and the hooks implied above (`useGroupConversations`, `useCreateGroup`, `useGroupMessages`, `useGroupMembers`), using the component contracts in section 4 as the target interface.
