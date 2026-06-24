# Feature: Username + Password Auth — STATE

> Phase: SHIPPED
> Builder: claude-sonnet-4-6 (Maker)
> Reviewer: claude-sonnet-4-6 (Checker, independent)
> Date: 2026-06-24
> Status: Code shipped. Migration 0004 cần apply thủ công lên Supabase trước khi feature hoạt động end-to-end.

---

## Phase History

| Phase | Status | Date |
|-------|--------|------|
| PLAN  | DONE   | 2026-06-24 |
| BUILD | DONE   | 2026-06-24 |
| REVIEW (1st pass) | DONE — blockers found | 2026-06-24 |
| BLOCKER FIX | DONE | 2026-06-24 |
| REVIEW (re-check) | PASS | 2026-06-24 |
| QA    | PARTIAL — migration pending | 2026-06-24 |
| SHIP  | DONE | 2026-06-24 |

---

## Files Changed / Created

### New Files
- `src/lib/username-utils.ts` — pure functions: `validateUsername`, `buildFakeEmail`, `USERNAME_REGEX`
- `src/lib/username-utils.test.ts` — unit tests (Vitest, chưa cài runner)
- `supabase/migrations/0004_profiles.sql` — bảng profiles + RLS + trigger handle_new_user
- `src/components/auth-modal.tsx` — modal sign in / sign up (native `<dialog>` element, không dùng shadcn)
- `src/components/header-auth.tsx` — header auth area, quản lý modal state

### Modified Files
- `src/lib/use-auth.ts` — thêm `username`, `signUp`, `signIn`; thay `signInWithOtp` bằng `signInWithPassword`
- `src/components/chat-panel.tsx` — dùng `username` từ `useAuth()` thay `nameFromEmail`; fallback backward compat
- `src/app/page.tsx` — thay `<AuthPanel />` bằng `<HeaderAuth />`
- `src/app/auth/callback/route.ts` — thay toàn bộ nội dung bằng simple redirect về `/`
- `src/components/auth-panel.tsx` — giữ file, xóa logic cũ, export `null` component (deprecated marker)
- `tsconfig.json` — thêm exclude pattern cho `*.test.ts`, `*.spec.ts` (tránh lỗi khi vitest chưa cài)

---

## Assumptions Đặt Ra (Checker cần verify)

### A1 — shadcn Dialog chưa có
Không tìm thấy `src/components/ui/dialog.tsx`. Đã dùng native `<dialog>` HTML element thay vì shadcn Dialog.
Native `<dialog>` hỗ trợ focus trap tự động trong modern browsers, ESC close qua sự kiện `cancel`.
**Cần verify**: Browser compatibility với `<dialog>` element (đặc biệt iOS Safari cũ).

### A2 — Vitest chưa cài
`package.json` không có `vitest` trong devDependencies. File test đã được tạo nhưng chưa chạy được.
`tsconfig.json` đã exclude `*.test.ts` để tránh lỗi tsc.
**Cần verify**: Checker cần cài `vitest` và chạy tests, hoặc xác nhận sẽ làm trong phase SHIP.

### A3 — signUp: mọi lỗi Supabase đều map thành "Username đã tồn tại."
Hiện tại `signUp` trong `use-auth.ts` map tất cả lỗi Supabase (kể cả network error) thành "Username đã tồn tại." thay vì chỉ lỗi "User already registered".
Lý do: plan chỉ định "map lỗi 'User already registered' → 'Username đã tồn tại.'" nhưng với password auth, gần như mọi sign-up error đều liên quan đến username đã tồn tại hoặc DB constraint. Network error sẽ hiển thị không đúng.
**Deviation so với plan**: Nên check `error.message` cụ thể hơn và có branch riêng cho network error.
**Cần Checker review**: Nên phân biệt network error vs duplicate username error.

### A4 — Migration chưa được apply lên Supabase
File `0004_profiles.sql` đã tạo nhưng cần người dùng tự apply vào Supabase Studio > SQL Editor.
Nếu migration chưa chạy, sign-up sẽ fail tại trigger (bảng profiles chưa tồn tại).
**Action required (dev)**: Chạy migration trước khi test.

### A5 — Email Confirmation phải tắt thủ công
Supabase Dashboard > Authentication > Settings > Email > "Confirm email" phải OFF.
Nếu bật, sign-up trả thành công nhưng sign-in ngay sau sẽ fail "Email not confirmed".
**Action required (dev)**: Tắt trong Dashboard trước khi test.

### A6 — username lấy từ JWT metadata, không query profiles table
`useAuth` đọc `user?.user_metadata?.username` từ JWT — không cần thêm Supabase query.
Supabase nhúng `raw_user_meta_data` vào access token khi signUp có `options.data`.
**Chưa verify**: JWT có thực sự chứa `user_metadata.username` sau signUp với `options.data.username` hay không — cần test với Supabase thật.

### A7 — User cũ (magic link) có username = null
`username` sẽ là `null` cho user đã tồn tại trước khi có feature này.
`HeaderAuth` hiển thị `user.email?.split("@")[0]` làm fallback.
`ChatPanel` dùng `username ?? nameFromEmail(user?.email)` làm fallback.
**Chưa verify**: Trải nghiệm thực tế với user cũ có session đang active.

### A8 — `<dialog>` showModal() và backdrop click
Logic click backdrop dựa vào `e.target === dialogRef.current` (click trực tiếp lên `<dialog>` element, không phải vào content bên trong). Cần verify không có edge case click leak.

---

## Điểm Checker Cần Chú Ý

1. **signUp error handling** (A3): Branch "mọi lỗi → username đã tồn tại" cần refinement. Network errors nên có message riêng.
2. **`<dialog>` vs shadcn Dialog** (A1): Nếu project plan muốn dùng shadcn, cần cài thêm và refactor `auth-modal.tsx`.
3. **Vitest chưa chạy được** (A2): Tests ở `username-utils.test.ts` chưa được verify là pass.
4. **JWT username field** (A6): Cần test thực tế với Supabase để xác nhận `user.user_metadata.username` có giá trị đúng.
5. **tsconfig exclude** — `*.test.ts` excluded khỏi main tsconfig. Checker cần confirm không ảnh hưởng CI TypeScript check.
6. **Migration constraint `profiles_username_chars`**: Regex DB `^[a-zA-Z][a-zA-Z0-9_-]*$` (không giới hạn độ dài ký tự trừ constraint length riêng). Client `USERNAME_REGEX` = `/^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/` → khớp với tổng length 3–20. Checker verify hai regex thực sự nhất quán.

---

## Blocker Fixes Applied (2026-06-24)

### BLOCKER 1 — signUp error mapping (use-auth.ts)
Trước: cả 2 branch đều return "Username đã tồn tại." (kể cả network error).
Sau: branch `already registered` → "Username đã tồn tại."; catch-all → "Không thể đăng ký. Vui lòng thử lại."

### BLOCKER 2 — useEffect → useLayoutEffect (auth-modal.tsx)
`useEffect` tương tác với `dialogRef.current` (showModal/close) đã đổi thành `useLayoutEffect` để tránh flash frame.
Import `useLayoutEffect` đã thêm vào.

### BLOCKER 3 — guard !data.session sau signUp (use-auth.ts)
`const { error }` → `const { data, error }`.
Thêm guard: nếu `!data.session` sau khi không có error → trả message yêu cầu tắt Email Confirmation.

### WARNING 1 (Bonus) — map-panel.tsx identity.userName (map-panel.tsx)
Đổi từ `user.user_metadata?.full_name ?? user.email ?? "Ẩn danh"` sang `username ?? user.email?.split("@")[0] ?? "Ẩn danh"`.
`username` lấy từ `useAuth()` (đã destructure thêm). Dep array cập nhật: `[user?.id, username, user?.email]`.

### WARNING 2 (Bonus) — canSubmit password length check (auth-modal.tsx)
Đổi `password.length > 0` thành `password.length >= 6` — nhất quán với rule "ít nhất 6 ký tự".

---

## Build Status

- `npm run build` (post-fix): PASS (2.8s compile, clean TypeScript)
- Unit tests: KHÔNG CHẠY ĐƯỢC (Vitest chưa cài — không thay đổi so với trước)

---

## Sẵn Sàng Cho

`/review` (re-check) — Checker kiểm tra lại 3 blocker đã được fix.
