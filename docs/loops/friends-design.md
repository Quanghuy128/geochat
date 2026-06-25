# Design — Friends / Contacts panel

> Phase: **DESIGN**. Input: `docs/loops/friends-STATE.md` (ANALYZE + THINK locked). Output consumed by `/plan` (architect).
> Locked scope reminder (do NOT re-litigate): no block/unblock, no cooldown, no friend limit, no autocomplete (exact-match username input only), incoming requests live via Supabase Realtime, friends list = username only (no online status), UI = panel inside existing chat layout (not a separate `/friends` route).

## 0. Existing conventions observed (must match)

- No actual `components/ui/*` shadcn primitives exist in this repo yet — `ChatPanel`, `MapPanel`, `HeaderAuth`, `AuthModal` are all hand-rolled Tailwind, using native `<dialog>` for modals (not a shadcn `Dialog`).
- Color/shape language: `rounded-full` pill buttons/inputs for chat-style actions, `rounded-2xl`/`rounded-xl` cards, `border-zinc-200 dark:border-zinc-800` dividers, `bg-blue-600 hover:bg-blue-700` primary action, `text-zinc-500` secondary/meta text, `text-red-500` / `bg-red-50 text-red-600` error blocks.
- Panel shape: every panel = `<div className="flex h-full flex-col">` with a `<header className="border-b ... px-4 py-3">` containing `<h2 className="font-semibold">` + `<p className="text-xs text-zinc-500">` subtitle, then a scrollable content area, optionally a footer input bar.
- Layout: `page.tsx` is a CSS grid, 1 column on mobile, `md:grid-cols-2` (Chat | Map) on desktop. Header has app title + `HeaderAuth` in the global top bar.
- Vietnamese UI copy throughout (`Đăng nhập`, `Gửi`, `Đang tải…`, etc.) — friends panel copy should match this language and tone.
- Username convention: `@username` displayed with `@` prefix (see `header-auth.tsx`).

This design treats the **FriendsPanel** as a new third panel in this same visual language — I will name shadcn-equivalents in the Component Breakdown for the architect's future migration, but the actual implementation should keep using the current hand-rolled pattern unless the architect decides to introduce real shadcn primitives in this same loop.

---

## 1. User Journey (happy path)

1. **Entry**: User is logged in, looking at the existing Chat | Map layout. A new **"Bạn bè" (Friends)** icon/tab button sits in the global header (next to `HeaderAuth`), showing a small badge if there are pending incoming requests (e.g. red dot with count).
2. User taps **"Bạn bè"** → a panel/drawer opens (mobile: full-screen overlay sliding in; desktop: a third column or slide-over panel) — see Screen Inventory for exact mechanics.
3. Panel opens on the **"Bạn bè" (Friends) tab** by default, showing the current friends list (or empty state if none).
4. User taps the **"Lời mời" (Requests)** tab → sees two sections: **Đang chờ (gửi đi)** outgoing pending, and **Lời mời nhận được** incoming pending. Initially both may be empty.
5. User wants to add a friend → taps **"+ Thêm bạn"** button (visible in Friends tab header) → reveals a username input + Send button (inline, not a separate modal — keeps it lightweight).
6. User types an exact username (e.g. `alice99`) and taps **[Gửi lời mời]**.
   - Optimistic UI: input clears, a temporary row appears in "Đang chờ" with a spinner, button disabled briefly.
   - On success: row settles into the outgoing pending list with status text "Đang chờ phản hồi…".
   - On error (username not found / already friends / already pending / self-request): inline error message appears under the input, request row removed, input keeps the typed text so user can correct it.
7. **Recipient's side (live, no refresh)**: Supabase Realtime pushes the new pending row into recipient's "Lời mời nhận được" list instantly. The header badge count increments live (even if recipient has the Friends panel closed — badge shown next to the header icon).
8. Recipient opens panel → Requests tab → sees the incoming request row: `@alice99 muốn kết bạn` with **[Chấp nhận]** and **[Từ chối]** buttons.
9. Recipient taps **[Chấp nhận]**:
   - Optimistic UI: row shows a brief "Đang xử lý…" spinner state, buttons disabled.
   - On success: row disappears from Requests tab; both users now see each other in their **Friends** tab list immediately (recipient via local state update; sender via Realtime push removing their outgoing pending row and the friends list refetch/insert).
10. Both users can now find each other in the **Bạn bè** tab, showing `@username` rows with an **[Hủy kết bạn]** (unfriend) affordance (kebab menu or inline button) for future use — unfriend is in scope per spec (#5 in ANALYZE FRs), even though not explicitly re-confirmed in THINK; I include it since FR #5 was never moved to Open Questions/OUT — see Open Design Questions for confirmation framing.
11. User closes the panel (X button, back gesture, or tap-outside via backdrop) → returns to Chat | Map view exactly as before.

---

## 2. Screen Inventory

| # | Screen / state | Entry trigger | Exit path |
|---|---|---|---|
| 1 | **Header Friends button** (icon + badge) | Always visible in top header when logged in | N/A (always present) |
| 2 | **FriendsPanel — Friends tab (empty state)** | Tap header Friends button (default tab) | X button / tap backdrop / Esc / switch to Requests tab |
| 3 | **FriendsPanel — Friends tab (with data)** | Same, when `friends.length > 0` | same |
| 4 | **FriendsPanel — Friends tab (loading)** | Panel just opened, fetch in flight | same |
| 5 | **FriendsPanel — Friends tab (error)** | Fetch failed (network/RLS) | Retry button / close |
| 6 | **Add Friend inline form** (within Friends tab) | Tap "+ Thêm bạn" | Submit success collapses form / X collapses form |
| 7 | **FriendsPanel — Requests tab (empty state)** | Tap "Lời mời" tab, no pending either direction | switch tab / close |
| 8 | **FriendsPanel — Requests tab (with data)** | Tap "Lời mời" tab, has incoming and/or outgoing | same |
| 9 | **FriendsPanel — Requests tab (loading)** | Tab opened, fetch in flight | same |
| 10 | **FriendsPanel — Requests tab (error)** | Fetch failed | Retry / close |
| 11 | **Inline error toast/banner** (send request failed: not found / self / duplicate / already friends) | Failed send action | Auto-dismiss after a few seconds or on next input change |
| 12 | **Unfriend confirm (inline or native confirm)** | Tap "Hủy kết bạn" on a friend row | Confirm → removes friend / Cancel → no-op |

Not a separate route — all of the above are states of a single `FriendsPanel` component mounted as a slide-over/drawer from the existing chat layout, per THINK decision #6.

---

## 3. ASCII Wireframes

### 3.1 Global header with Friends button (mobile + desktop, collapsed panel)

```
┌──────────────────────────────────────────────────────────┐
│  GeoChat                              [👥³] [@alice ▾]   │  ← header: title+subtitle (existing)
│  Chat realtime + bản đồ vị trí realtime                  │     [👥³] = Friends button, badge=3 pending incoming
└──────────────────────────────────────────────────────────┘
```

- `[👥³]` badge only renders when `incomingPendingCount > 0`. No badge = plain icon button.
- Placed to the left of `HeaderAuth`'s `@username` block, same header row.
- Disabled/hidden entirely when not logged in (mirrors `ChatPanel`'s "login to send" gating — friends require auth).

### 3.2 FriendsPanel shell (mobile — full-screen overlay slide-in from right)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │  ← header: back/close + title
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (2) ]                         │  ← tabs, badge = counts
├──────────────────────────────────────────────────────────┤
│                                                            │
│   ... tab content (see 3.3 / 3.5) ...                     │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 3.3 FriendsPanel shell (desktop ≥ md — slide-over panel anchored right, overlapping Map pane, with backdrop)

```
┌─────────────────────────────┬───────────────┬────────────┐
│  Chat pane (dimmed/backdrop)│  Map (dimmed) │ FriendsPanel│
│                              │               │ [✕] Bạn bè │
│                              │               ├────────────┤
│                              │               │[Bạn bè][Lời│
│                              │               │ mời (2)]   │
│                              │               ├────────────┤
│                              │               │ ...rows... │
└─────────────────────────────┴───────────────┴────────────┘
```

Rationale: keeps the "panel within existing layout" mandate (THINK #6) — it is an overlay, not a new route, and does not permanently consume Chat/Map grid space when closed.

### 3.4 Friends tab — empty state

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (0) ]   [ Lời mời (0) ]                         │
├──────────────────────────────────────────────────────────┤
│                                                            │
│              🧑‍🤝‍🧑  Chưa có bạn bè nào                      │
│        Thêm bạn bằng username để bắt đầu chat riêng        │
│                                                            │
│              [ + Thêm bạn ]                               │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 3.5 Friends tab — with data (Add Friend form collapsed)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (2) ]                         │
├──────────────────────────────────────────────────────────┤
│  [ + Thêm bạn ]                                           │
├──────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐  │
│  │ @alice99                              [ ⋯ ]         │  │ ← row, kebab → unfriend
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @bob_tran                             [ ⋯ ]         │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @charlie                              [ ⋯ ]         │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @diana_k                              [ ⋯ ]         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 3.6 Friends tab — Add Friend form expanded (after tapping "+ Thêm bạn")

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (2) ]                         │
├──────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────┐  │
│  │ Nhập đúng username                            [✕]  │  │
│  │ ( username )                       [ Gửi lời mời ] │  │
│  └────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│  ...existing friends rows below (unchanged)...            │
└──────────────────────────────────────────────────────────┘
```

Error variant (username not found):

```
│  ┌────────────────────────────────────────────────────┐  │
│  │ Nhập đúng username                            [✕]  │  │
│  │ ( alice_typo )                     [ Gửi lời mời ] │  │
│  │ ⚠ Không tìm thấy username "alice_typo"             │  │
│  └────────────────────────────────────────────────────┘  │
```

Sending (optimistic) variant:

```
│  │ ( alice99 )                        [ ⟳ Đang gửi… ] │  │   ← button disabled, spinner replaces label
```

Self-request error:

```
│  ⚠ Không thể tự gửi lời mời cho chính mình             │
```

Already-friends / already-pending error:

```
│  ⚠ @alice99 đã là bạn của bạn                          │
│  ⚠ Đã có lời mời đang chờ giữa bạn và @alice99          │
```

### 3.7 Requests tab — empty state (both lists empty)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (0) ]                         │
├──────────────────────────────────────────────────────────┤
│                                                            │
│           📭  Không có lời mời nào                        │
│      Lời mời gửi/nhận sẽ hiện ở đây theo thời gian thực    │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 3.8 Requests tab — with data (incoming + outgoing sections)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (3) ]                         │
├──────────────────────────────────────────────────────────┤
│  Lời mời nhận được (2)                                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @newuser1  muốn kết bạn                            │  │
│  │            [ Chấp nhận ]   [ Từ chối ]              │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @newuser2  muốn kết bạn                            │  │
│  │            [ Chấp nhận ]   [ Từ chối ]              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  Đang chờ phản hồi (1)                                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ @target_user   Đang chờ…           [ Hủy lời mời ] │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Live-update note: a new incoming row animates in (fade+slide) at the top of "Lời mời nhận được" the instant Realtime delivers the INSERT — no manual refresh, no toast required (the badge counter update is sufficient feedback) but see Interaction Notes for an optional toast.

Accept in-flight (row state):

```
│  │ @newuser1  muốn kết bạn                            │  │
│  │            [ ⟳ Đang xử lý… ]  (both buttons disabled)│ │
```

### 3.9 Requests tab — loading state (first open)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (…) ]   [ Lời mời (…) ]                         │
├──────────────────────────────────────────────────────────┤
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (skeleton row, pulse)    │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                            │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                            │
└──────────────────────────────────────────────────────────┘
```

(Matches existing `animate-pulse` skeleton pattern used in `header-auth.tsx` for the loading button.)

### 3.10 Friends/Requests tab — error state (fetch failed)

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│  [ Bạn bè (4) ]   [ Lời mời (2) ]                         │
├──────────────────────────────────────────────────────────┤
│                                                            │
│         ⚠ Không tải được danh sách bạn bè                  │
│         Lỗi: <error message>                              │
│              [ Thử lại ]                                   │
│                                                            │
└──────────────────────────────────────────────────────────┘
```

### 3.11 Unfriend confirm (inline expand under row, avoids native confirm() per existing custom-dialog convention)

```
│  ┌────────────────────────────────────────────────────┐  │
│  │ @alice99                              [ ⋯ ]         │  │
│  │ Hủy kết bạn với @alice99?                           │  │
│  │              [ Hủy ]      [ Xác nhận hủy kết bạn ]  │  │
│  └────────────────────────────────────────────────────┘  │
```

### 3.12 Not logged in state (panel button disabled / CTA)

```
┌──────────────────────────────────────────────────────────┐
│  GeoChat                                    [ Đăng nhập ] │   ← no Friends icon shown at all when logged out
└──────────────────────────────────────────────────────────┘
```

If user somehow reaches the panel while logged out (e.g. session expired mid-use), show:

```
┌──────────────────────────────────────────────────────────┐
│ [‹ Đóng]   Bạn bè                                         │
├──────────────────────────────────────────────────────────┤
│         Đăng nhập để xem và quản lý bạn bè                │
│              [ Đăng nhập ]                                 │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

> Repo currently has no real shadcn `components/ui/*` primitives. Listed below: (a) the shadcn component this most closely maps to for future alignment, (b) what to actually build now consistent with existing hand-rolled style. Architect decides whether to introduce real shadcn now or keep the existing pattern — flagged in Open Design Questions.

### `FriendsButton` (header, new)
- Maps to: shadcn `Button` (icon variant) + `Badge`.
- New component. Props: `pendingCount: number`, `onClick: () => void`, `disabled?: boolean` (when logged out — or simply not rendered).
- State: none local; count comes from a hook (e.g. `useFriendRequests` exposing `incomingCount`).

### `FriendsPanel` (new, top-level)
- Maps to: shadcn `Sheet` (slide-over) on desktop / full-screen `Dialog` on mobile — but given existing convention uses native `<dialog>` only for `AuthModal` (a centered modal, not a slide-over), this needs a **new pattern**: a CSS-transform slide-in `<div>` with a backdrop `<div>` (fixed position, `fixed inset-0`), not native `<dialog>`. Flagged in Open Design Questions #1 (slide-over vs `<dialog>`).
- Props: `open: boolean`, `onOpenChange: (open: boolean) => void`.
- Internal state: `activeTab: "friends" | "requests"`.
- Composes `FriendsTab` and `RequestsTab`.

### `FriendsTab` (new)
- Maps to: shadcn `ScrollArea` + `Card`/list rows; "+ Thêm bạn" maps to `Button` + `Collapsible` for the inline form.
- Props: none external — reads from `useFriends()` hook: `{ friends, loading, error, refetch }`.
- Sub-state: `showAddForm: boolean`.
- Renders `FriendRow[]` and `AddFriendForm` (conditionally).

### `AddFriendForm` (new, inline — not a modal)
- Maps to: shadcn `Input` + `Button` (with loading spinner state) + inline error `Alert`/`p`.
- Props: `onSent: () => void` (collapses form on success), `onCancel: () => void`.
- Internal state: `username: string`, `submitting: boolean`, `error: string | null`.
- Calls a `sendFriendRequest(username)` mutation (architect to define hook, e.g. `useSendFriendRequest`).

### `FriendRow` (new)
- Maps to: shadcn `Card`/list item + `DropdownMenu` (the `[⋯]` kebab) + `Avatar` (optional, see Open Design Questions #2 — spec says username-only, no avatar data exists yet, so default to a simple initial-letter circle or omit entirely).
- Props: `friend: { id: string; username: string }`, `onUnfriendConfirm: (id: string) => Promise<void>`.
- Internal state: `confirmingUnfriend: boolean`, `unfriending: boolean` (loading on confirm).

### `RequestsTab` (new)
- Maps to: shadcn `ScrollArea` + two grouped lists with section headers (`Separator` + heading text).
- Props: none — reads `useFriendRequests()` hook: `{ incoming, outgoing, loading, error, refetch }` (Realtime-subscribed internally).
- Renders `IncomingRequestRow[]` and `OutgoingRequestRow[]`.

### `IncomingRequestRow` (new)
- Maps to: shadcn `Card` + two `Button` (default "Chấp nhận", outline/destructive-ghost "Từ chối").
- Props: `request: { id: string; requesterUsername: string }`, `onAccept: (id) => Promise<void>`, `onReject: (id) => Promise<void>`.
- Internal state: `actionInFlight: "accept" | "reject" | null`.

### `OutgoingRequestRow` (new)
- Maps to: shadcn `Card` + one `Button` (ghost, "Hủy lời mời").
- Props: `request: { id: string; recipientUsername: string }`, `onCancel: (id) => Promise<void>`.
- Internal state: `cancelling: boolean`.

### `EmptyState` (new, shared)
- Maps to: no direct shadcn equiv — simple centered `div`.
- Props: `icon: ReactNode`, `title: string`, `subtitle?: string`, `action?: ReactNode`.
- Reused across Friends-empty and Requests-empty (3.4 and 3.7).

### `ErrorState` (new, shared)
- Maps to: shadcn `Alert` (destructive variant).
- Props: `message: string`, `onRetry: () => void`.

### `SkeletonRows` (new, shared)
- Maps to: shadcn `Skeleton`.
- Props: `count: number`.

### Reused/unchanged existing components
- `HeaderAuth` — unchanged, `FriendsButton` sits beside it in `page.tsx` header.
- No changes needed to `ChatPanel` / `MapPanel` for this loop (1-1 chat integration is explicitly out of scope).

---

## 5. Interaction Notes

- **Panel open/close transition**: slide-in from right, ~200ms ease-out transform + backdrop fade-in (mirrors typical drawer pattern; no existing precedent in repo, so this is a new but standard transition — flagged only if architect wants a different mechanism, see Open Questions #1).
- **Tab switch**: instant (no fetch re-trigger if data already loaded this session) — `friends` and `requests` data sources are independent hooks, both can be prefetched on panel open so switching tabs feels instant.
- **Badge count**: updates live via the same Realtime subscription used for the Requests tab list — no separate poll.
- **Send request — optimistic UI**: on submit, immediately disable input+button, replace button label with spinner ("⟳ Đang gửi…"). Do NOT optimistically insert into the outgoing list (since validation happens server-side per edge cases #1-#4 in STATE) — wait for server confirmation, then insert. This avoids showing a request that might be rejected by validation a moment later flashing in/out.
- **Accept/Reject — optimistic-ish UI**: disable both buttons immediately, show "⟳ Đang xử lý…" in place of buttons. On success, remove row from Requests list (slide-up/fade-out, ~150ms) and (for accept) prepend to Friends list. On failure (edge case #9 — request no longer pending, e.g. already actioned by a race), show inline error replacing the row briefly then remove it (since the underlying request is gone either way) and trigger a `refetch`.
- **Cancel outgoing request**: same disable+spinner pattern, label "⟳ Đang hủy…", on success row disappears.
- **Unfriend**: NOT optimistic — requires explicit inline confirm step (3.11) before mutating, since it's a destructive action with no undo. Confirm button shows spinner while in flight; on success row fades out.
- **Realtime incoming insert**: new row fades+slides in at top of "Lời mời nhận được"; if the Requests tab is not currently open/visible, only the header badge updates (no toast by default — keeps things calm per the rest of the app's quiet, no-toast convention seen in `ChatPanel`/`MapPanel`). Optional: a subtle one-line toast ("🔔 @alice99 đã gửi lời mời kết bạn") could be added — flagged in Open Design Questions #3, default = no toast.
- **Loading state** (first panel open, or tab switch before data cached): skeleton rows (`SkeletonRows`, 3 rows, `animate-pulse` matching existing `header-auth.tsx` pattern), each tab independently.
- **Empty states**: friendly one-line message + subtitle, no error styling. Friends-empty includes a CTA button to open Add Friend form directly. Requests-empty is purely informational (no CTA needed, since adding a friend happens in the Friends tab).
- **Error states**: red-bordered/red-text block (`bg-red-50 text-red-600` per existing `AuthModal` error pattern) + `[Thử lại]` retry button that calls `refetch()`.
- **Validation error display (Add Friend form)**: inline `⚠ <message>` text directly under the input, matching `AuthModal`'s `usernameError` pattern (red text, no toast/modal). Exact copy per edge case:
  - empty/bad format → "Username không hợp lệ" (or reuse `validateUsername()` message from `lib/username-utils.ts` if applicable)
  - not found → `Không tìm thấy username "<input>"`
  - self → `Không thể tự gửi lời mời cho chính mình`
  - already friends → `@<username> đã là bạn của bạn`
  - already pending (either direction) → `Đã có lời mời đang chờ giữa bạn và @<username>`
- **Keyboard**: Add Friend input submits on Enter (matches `ChatPanel`'s `onKeyDown={(e) => e.key === "Enter" && handleSend()}` pattern). Esc closes the FriendsPanel (matches `AuthModal`'s native dialog Esc behavior — needs manual `keydown` listener if not using native `<dialog>`, see Open Questions #1).
- **Mobile vs desktop layout**: panel is full-screen overlay below `md` breakpoint, right-anchored slide-over (~380px wide) at `md:` and above — matches Tailwind breakpoint already used in `page.tsx` (`md:grid-cols-2`).
- **Disabled state when logged out**: `FriendsButton` is not rendered at all in the header when `!user` (consistent with `MapPanel`'s "chưa đăng nhập → chỉ xem" gating elsewhere, and simpler than rendering-then-disabling).

---

## 6. Future ideas (explicitly out of scope — do not build now)

- Avatars / profile photos on friend rows (no data model for this yet).
- Online status indicator on friends list (blocked on map-presence feature per THINK #5).
- Block/unblock UI (THINK #1 — deferred).
- Search-as-you-type / autocomplete for username (THINK #7 — deferred).
- Toast notifications for incoming requests (see Open Question #3 below — default is no toast, but flagged as a possible later enhancement).
- Mutual friends / friend suggestions (explicitly OUT per ANALYZE).
- Dedicated 1-1 chat entry point from a friend row (next feature, not this one).

---

## 7. Open Design Questions

These are genuine new taste calls not already locked in THINK. Best-guess defaults are applied above so the pipeline is not blocked; a human should confirm or override before/while `/plan` proceeds.

1. **Slide-over vs. centered `<dialog>` for FriendsPanel.** `AuthModal` uses a centered native `<dialog>`. This design proposes a right-anchored slide-over drawer instead (better fit for a "tab list" UI on mobile and for keeping Chat/Map visible underneath on desktop). Default applied: **slide-over drawer**, full-screen on mobile. If the user/architect prefers consistency with `AuthModal`'s exact mechanism (native `<dialog>`, centered, smaller), that's a quick swap but changes the desktop wireframe in 3.3.
2. **Friend row avatar.** Spec says "username only" for the friends list content, but says nothing about a decorative avatar (e.g., initials-in-circle, generated from username) purely for visual scannability. Default applied: **no avatar**, plain text row (`@username` + kebab menu only), to stay strictly within "username only" and avoid implying any avatar data/upload feature exists.
3. **Realtime incoming-request toast.** THINK #4 locks "live update of the list," but doesn't specify whether a transient toast notification should also fire when the panel/tab isn't open. Default applied: **no toast**, badge-only (quieter, matches the app's current toast-free convention). Could revisit if user feedback says incoming requests are easy to miss.
4. **Unfriend exposure in this build.** ANALYZE FR #5 includes unfriend and acceptance criterion #10 explicitly tests it, but THINK's 7 open questions never asked about unfriend directly — it was implicitly assumed in-scope throughout. Default applied: **unfriend is in scope and designed here** (3.11). Flagging only because THINK's question list focused on requests/friends-list-display and never explicitly reconfirmed unfriend — if the architect intended to defer it, this design would need a trimmed Friends tab (remove the `[⋯]` kebab and 3.11 entirely).
5. **Panel vs. true dockable third column on large desktop screens.** THINK #6 locks "panel in existing layout, not a separate page," but doesn't specify whether on very wide desktop viewports the FriendsPanel could be a permanently-visible third column (like a 3-pane Chat | Map | Friends layout) rather than an overlay. Default applied: **overlay/slide-over at all breakpoints** (simpler, one mental model, doesn't permanently shrink the Chat/Map panes). A persistent third column is a reasonable enhancement but changes `page.tsx`'s grid structure, so flagged rather than assumed.

---

**Next action**: run `/plan` — architect should read this file alongside `docs/loops/friends-STATE.md` to design the `friend_requests`/`friendships` schema, RLS policies, API routes/hooks (`useFriends`, `useFriendRequests`, `useSendFriendRequest`, etc.), and Realtime wiring, using the component contracts in section 4 above as the target interface.
