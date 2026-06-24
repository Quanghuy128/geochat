# Plan: Username + Password Auth

> Phase: PLAN — 2026-06-24
> Architect: claude-sonnet-4-6
> Bàn giao cho: feature-builder (dev)
> Chuẩn nghiệm thu: code-reviewer (Checker)

---

## Scope

**IN:**
- Thay magic link bằng username + password login.
- Email fake tự động: `{username}@geochat.app` — user KHÔNG nhìn thấy, KHÔNG nhập.
- Modal overlay Sign In / Sign Up tabs thay AuthPanel inline.
- Header hiển thị `@username` khi đã đăng nhập.
- Bảng `profiles` lưu username (UNIQUE) → lookup khi đăng nhập.
- `use-auth` expose thêm `username`, `signUp(username, password)`.

**OUT (không làm lần này):**
- Reset/đổi password.
- OAuth / social login.
- Avatar, đổi tên hiển thị.
- Xóa/cleanup tin nhắn cũ có user_name lấy từ email.

**Tiêu chí nghiệm thu (Checker kiểm):**
1. `npm run build` pass, không lỗi TypeScript strict.
2. Sign-up username hợp lệ → profile tạo thành công → đăng nhập ngay.
3. Sign-up username trùng → lỗi rõ ràng, không tạo account mới.
4. Sign-in sai password → error message chung chung (không tiết lộ username tồn tại hay không).
5. Header hiển thị `@username`, không hiển thị email.
6. Sau refresh → vẫn đăng nhập (session persist).
7. Sign-out → về trạng thái chưa đăng nhập.
8. RLS: INSERT message bằng anon key (không session) vẫn bị chặn.
9. Supabase email confirmation phải tắt (auto-confirm) — verify qua sign-up không cần click email.
10. Username validation client-side: 3–20 ký tự, `[a-zA-Z0-9_-]`, không bắt đầu số/`_`/`-`.

---

## Architecture Decisions

### A1. Email fake scheme
`{username}@geochat.app` — lowercase toàn bộ username trước khi ghép.
Không dùng hash vì username đã UNIQUE và không chứa ký tự đặc biệt (constraint validation).
Không có collision nếu username đã được sanitize đúng.

### A2. Username lookup flow
Sign-in không cần query DB trước: client tự build email fake → `signInWithPassword(email, password)`.
Supabase trả lỗi "Invalid login credentials" cho cả sai username lẫn sai password → không enumerate.

### A3. profiles table là source of truth cho username
`auth.users.raw_user_meta_data->>'username'` dùng làm cache nhanh trong JWT claims (optional — xem edge case E4).
Nguồn chính thức = `public.profiles`.

### A4. Modal thay AuthPanel inline
`AuthModal` là Client Component, mount tại root layout (hoặc `page.tsx`), kiểm soát bằng state `open`.
Header có nút "Đăng nhập" trigger modal; khi đã login hiện `@username` + nút "Đăng xuất".

### A5. Email confirmation
**Phải tắt** "Email Confirm" trong Supabase Dashboard (Authentication > Settings > Email > Confirm email: OFF).
Migration không thể làm điều này. Dev cần thực hiện thủ công một lần. Ghi chú rõ trong PLAN.
Nếu không tắt, sign-up sẽ trả `"Email not confirmed"` khi đăng nhập ngay sau đó.

### A6. Supabase trigger tự insert profiles
Dùng Postgres trigger `on auth.users after insert` để auto-insert vào `public.profiles`.
Lý do: tránh race condition giữa `signUp()` thành công và client gọi `insert profiles` — nếu client crash sau signUp, profile sẽ không bao giờ được tạo.
Trigger an toàn hơn, chạy trong cùng transaction.

### A7. username trong messages/locations
`user_name` ở hai bảng này là text tự do (không FK). Sau khi có `profiles`, `user_name` sẽ được lấy từ `profiles.username` qua hook, không sửa schema cũ.
Tin nhắn cũ vẫn hiển thị được (không vỡ), chỉ là `user_name` dạng email cũ.

---

## DB Changes (migration SQL draft)

### Migration 0004: profiles table + trigger

File: `supabase/migrations/0004_profiles.sql`

```sql
-- Migration 0004: bảng profiles (username unique) + trigger auto-insert từ auth.users
-- Chạy: copy vào Supabase Studio > SQL Editor > Run.
-- Reversible: phần rollback ở cuối.
-- TRƯỚC KHI CHẠY: tắt "Confirm email" trong Supabase Dashboard > Auth > Settings.

-- 1. Bảng profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now(),

  -- Constraints
  constraint profiles_username_length   check (char_length(username) between 3 and 20),
  constraint profiles_username_chars    check (username ~ '^[a-zA-Z][a-zA-Z0-9_-]*$'),
  constraint profiles_username_unique   unique (username)
);

-- Index cho lookup username (sign-in không cần, nhưng cần cho admin/display)
create index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- 2. RLS
alter table public.profiles enable row level security;

-- SELECT: mọi người xem được (cần để hiển thị @username trong chat)
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- INSERT: chặn tất cả từ client — chỉ trigger được insert
-- (trigger chạy với security definer, bypass RLS)
drop policy if exists "profiles_insert_trigger_only" on public.profiles;
create policy "profiles_insert_trigger_only"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- UPDATE: chỉ owner, nhưng KHÔNG cho đổi username (immutable)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and username = (select username from public.profiles where id = auth.uid())
  );

-- 3. Trigger: auto-insert profile khi user mới đăng ký
-- username lấy từ raw_user_meta_data->>'username' (client truyền lên lúc signUp)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username'
  )
  on conflict (id) do nothing;  -- idempotent: nếu trigger bị gọi lại
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROLLBACK:
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop policy if exists "profiles_update_own" on public.profiles;
-- drop policy if exists "profiles_insert_trigger_only" on public.profiles;
-- drop policy if exists "profiles_select_all" on public.profiles;
-- drop table if exists public.profiles cascade;
-- ============================================================
```

**Lưu ý quan trọng về constraint `profiles_username_chars`:**
Regex `^[a-zA-Z][a-zA-Z0-9_-]*$` áp dụng validation phía DB (ký tự đầu phải là chữ cái, không được bắt đầu bằng số/`_`/`-`). Client-side validation phải khớp regex này để tránh sign-up thành công nhưng trigger fail → auth.users có user nhưng không có profile.

**Về `username` trong `raw_user_meta_data`:**
Client gọi `supabase.auth.signUp({ email, password, options: { data: { username } } })`.
Supabase lưu `data` vào `raw_user_meta_data`. Trigger đọc từ đây.
Nếu `raw_user_meta_data->>'username'` là null → trigger insert null → vi phạm NOT NULL → trigger fail → signUp rollback. Dev phải đảm bảo luôn truyền `data.username`.

### Không cần migration mới cho messages/locations
`user_name` ở hai bảng này tiếp tục là text tự do. Sau khi có `profiles`, hook sẽ lấy `username` từ `profiles` thay vì parse email. Không đổi schema.

---

## Component Changes

### Files sẽ XÓA
- `src/app/auth/callback/route.ts` — magic link callback không còn dùng. **Xóa hoặc giữ với nội dung redirect về `/`** để tránh 404 nếu có link cũ.

### Files sẽ SỬA

#### `src/lib/use-auth.ts`
Thêm vào `UseAuth` type:
```ts
username: string | null;
signUp: (username: string, password: string) => Promise<{ error: string | null }>;
signIn: (username: string, password: string) => Promise<{ error: string | null }>;
```

Thay `signIn` (cũ là `signInWithOtp`) bằng logic:
1. Build email fake: `${username.toLowerCase()}@geochat.app`
2. Gọi `supabase.auth.signInWithPassword({ email, password })`
3. Return `{ error: error?.message ?? null }`

Thêm `signUp`:
1. Validate username (regex, length) — return error sớm nếu invalid.
2. Build email fake.
3. Gọi `supabase.auth.signUp({ email, password, options: { data: { username } } })`
4. Nếu lỗi từ Supabase (email đã tồn tại → "User already registered") → map sang "Username đã tồn tại."
5. Return `{ error: null }` khi thành công.

Thêm `username` vào state — lấy từ `user?.user_metadata?.username` (từ JWT) hoặc query `profiles` bằng `user.id`.
Cách đơn giản hơn: đọc từ `user.user_metadata.username` (Supabase nhúng `raw_user_meta_data` vào JWT access token) — không cần thêm query.

Giữ nguyên `signOut`, `user`, `loading`, `configured`.

#### `src/components/auth-panel.tsx`
**Xóa toàn bộ nội dung hiện tại.** Thay bằng component mới: chỉ render nút trigger modal + trạng thái logged-in:
```tsx
// Logged out: nút "Đăng nhập" → trigger modal
// Logged in: "@username" + nút "Đăng xuất"
```
Component này không còn chứa form input.

#### `src/app/page.tsx`
Thêm render `<AuthModal>` (hoặc dùng state `modalOpen` truyền xuống).
Vì modal cần `"use client"`, và `page.tsx` hiện là Server Component, có 2 cách:
- Tách `<HeaderAuth>` thành Client Component riêng quản lý state modal.
- Hoặc đẩy toàn bộ header thành Client Component.

**Chọn cách 1** (ít thay đổi nhất): tạo `src/components/header-auth.tsx` là Client Component, render `AuthPanel` + `AuthModal`, quản lý `open` state. `page.tsx` import `<HeaderAuth />` thay `<AuthPanel />`.

#### `src/components/chat-panel.tsx`
Thay `nameFromEmail(user?.email)` → dùng `username` từ `useAuth()`.
Đổi dòng identity:
```ts
// Cũ:
userName: nameFromEmail(user?.email),
// Mới:
userName: username ?? "Bạn",
```
Cũng đổi display trong header của ChatPanel:
```
"Realtime (Supabase) · bạn là {username}" thay vì email
```

### Files sẽ TẠO MỚI

#### `src/components/auth-modal.tsx` (Client Component)
Modal overlay với 2 tabs: Sign In / Sign Up.

**Sign In tab:**
- Input: username (text), password (password)
- Nút "Đăng nhập"
- Error state

**Sign Up tab:**
- Input: username (text), password (password), confirm password
- Validation real-time: username regex, length
- Nút "Đăng ký"
- Error state

**Behavior:**
- Submit → gọi `signIn()` hoặc `signUp()` từ `useAuth()`
- Thành công → đóng modal (set `open=false`)
- Error → hiển thị message
- ESC / click backdrop → đóng modal
- Focus trap bên trong modal (a11y)

Dùng shadcn `Dialog` component (đã có trong stack) thay tự dựng.

#### `src/lib/username-utils.ts` (pure functions, không import Supabase)
```ts
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;

export function validateUsername(username: string): string | null {
  // Return error message hoặc null nếu valid
}

export function buildFakeEmail(username: string): string {
  return `${username.toLowerCase()}@geochat.app`;
}
```
File pure này để dễ unit test.

---

## Auth Flow Diagrams

### Sign-Up Flow

```
User nhập username + password
        |
        v
[Client] validateUsername(username)
        |-- invalid --> hiển thị error, dừng
        |
        v
[Client] buildFakeEmail(username)    -- "huynq12@geochat.app"
        |
        v
[Supabase Auth] signUp({ email: fake, password, data: { username } })
        |
        |-- lỗi "User already registered" --> map sang "Username đã tồn tại."
        |-- lỗi khác --> hiển thị lỗi chung
        |
        v (thành công)
[Postgres Trigger] handle_new_user()
        --> INSERT INTO profiles (id, username)
        |-- lỗi unique violation (race condition) --> Supabase rollback signUp
        |
        v (trigger OK)
[Supabase] trả session
        |
        v
[Client] onAuthStateChange fires → useAuth cập nhật user + username
        |
        v
Modal đóng, header hiển thị @username
```

### Sign-In Flow

```
User nhập username + password
        |
        v
[Client] buildFakeEmail(username)    -- không validate username ở đây (không tiết lộ)
        |
        v
[Supabase Auth] signInWithPassword({ email: fake, password })
        |
        |-- lỗi bất kỳ --> hiển thị "Thông tin đăng nhập không đúng." (chung chung)
        |
        v (thành công)
[Client] onAuthStateChange fires → useAuth cập nhật user + username
        |
        v
Modal đóng, header hiển thị @username
```

### Sign-Out Flow (không đổi)

```
User click "Đăng xuất"
        |
        v
[Supabase Auth] signOut()
        |
        v
[Client] onAuthStateChange fires → user = null, username = null
        |
        v
Header hiển thị nút "Đăng nhập"
```

### Subscribe / Cleanup Pattern (use-auth.ts)

```
useEffect mount:
  supabase.auth.getUser()   -- lấy session hiện tại
  supabase.auth.onAuthStateChange(handler)  -- lắng nghe thay đổi

handler nhận session:
  setUser(session?.user ?? null)
  setUsername(session?.user?.user_metadata?.username ?? null)
  setLoading(false)

useEffect cleanup:
  cancelled = true
  subscription.unsubscribe()   -- không leak
```

---

## Edge Cases & Mitigations

### E1. Username collision race condition (2 user sign-up cùng lúc)
**Tình huống**: user A và user B đều nhập username "alice", cả hai vượt qua validate client, cả hai gọi `signUp` gần như đồng thời.

**Mitigation**: DB constraint `UNIQUE (username)` trên `profiles` là lưới chặn cuối cùng. Trigger chạy trong transaction của `INSERT auth.users`. Nếu user A thắng, user B nhận lỗi từ trigger → Supabase rollback toàn bộ signUp của B → client B nhận error → map sang "Username đã tồn tại."

**Quan trọng**: Supabase không rollback `auth.users` tự động khi trigger fail — cần kiểm tra. Theo Supabase docs, trigger `AFTER INSERT on auth.users` nằm trong cùng transaction; nếu trigger raise exception, transaction rollback → `auth.users` row cũng bị rollback. Trigger cần dùng `RAISE EXCEPTION` khi insert thất bại thay vì `ON CONFLICT DO NOTHING` (để đảm bảo rollback lan ngược).

**Sửa trigger**: thay `on conflict do nothing` bằng:
```sql
insert into public.profiles (id, username)
values (new.id, new.raw_user_meta_data ->> 'username');
-- Để Postgres raise lỗi tự nhiên khi vi phạm unique → trigger fail → rollback auth.users row
```
Đây là lựa chọn an toàn hơn cho race condition.

### E2. Email fake collision
Username chỉ chứa `[a-zA-Z0-9_-]` và domain cố định `@geochat.app`. Không có ký tự đặc biệt → không có khả năng collision giữa email fake của 2 username khác nhau. Email fake luôn là hàm 1-1 của username (lowercase).

### E3. Supabase email confirmation bật
Nếu admin quên tắt "Email Confirm", `signUp` trả thành công nhưng đăng nhập ngay sẽ fail với "Email not confirmed". User không biết cần confirm email gì cả (vì email fake không tồn tại).

**Mitigation**: Dev **phải** tắt trong Dashboard trước khi test. Ghi rõ trong README / migration comment. Nếu môi trường production cần email confirm, cần custom SMTP + domain geochat.app — nằm ngoài scope.

Nếu muốn tự bảo vệ trong code: sau `signUp`, thử `signInWithPassword` ngay → nếu lỗi "Email not confirmed" → hiển thị lỗi cụ thể yêu cầu admin kiểm tra cài đặt. Chỉ xét nếu môi trường không ổn định.

### E4. username trong JWT vs profiles
`user.user_metadata.username` lấy từ JWT access token — không cần query thêm, nhanh. Tuy nhiên nếu sau này cần update username (mặc dù hiện tại immutable), JWT cũ vẫn giữ giá trị cũ cho đến khi refresh.

Hiện tại username immutable → dùng JWT metadata là an toàn. Nếu sau này cho phép đổi username, cần query `profiles` thay vì JWT.

### E5. Session hiện tại của user dùng magic link cũ
User đang login bằng magic link → deploy version mới → session vẫn còn hiệu lực (Supabase giữ session theo JWT, không phụ thuộc auth method). `user.user_metadata.username` của user cũ sẽ là `undefined` (vì signUp cũ không truyền `data.username`). `profiles` table cũng không có row cho họ (vì họ signup trước khi có trigger).

**Mitigation**: `useAuth` phải xử lý `username = null` gracefully:
- `username ?? user?.email?.split("@")[0] ?? "Bạn"` — fallback về phần trước @ của email.
- Hoặc đơn giản hơn: `username ?? null`, và các nơi dùng `username` phải có fallback.

Header: nếu `username` null nhưng `user` không null → hiển thị email hoặc "User" thay vì crash.

ChatPanel: `userName: username ?? nameFromEmail(user?.email)` — giữ backward compat.

User cũ muốn dùng username system: phải sign out → sign up lại với username.

### E6. SSR / CSR mismatch
`useAuth` là Client hook (`"use client"`). Server render: `user = null`, `username = null`. Client hydrate: fetch session → update state. Có thể có flash "Đăng nhập" trước khi header cập nhật thành `@username`.

**Mitigation**: Đây là behavior bình thường cho client-side auth. Tránh hiển thị nội dung khác nhau hoàn toàn giữa server/client. Loading state (`loading = true`) nên render skeleton/null thay vì "Đăng nhập" để giảm flash.

### E7. RLS: profiles INSERT từ client
Policy `profiles_insert_trigger_only` cho phép `authenticated` INSERT với `id = auth.uid()`. Về lý thuyết, client authenticated có thể gọi `INSERT INTO profiles` thủ công (bỏ qua trigger). Điều này ổn vì: (a) trigger đã chạy trước đó, `ON CONFLICT DO nothing` hoặc lỗi unique sẽ xử lý; (b) client không thể insert username khác với chính mình (vì không có quyền update người khác). Nếu muốn cứng hơn: dùng `WITH CHECK FALSE` để chặn hoàn toàn client INSERT, chỉ dựa vào trigger (security definer bypass RLS). Trade-off: nếu trigger fail, không có recovery path. Giữ nguyên thiết kế hiện tại là đủ an toàn.

### E8. mạng rớt khi sign-up / sign-in
Supabase client tự timeout. Dev cần:
- Timeout UI (disable button trong khi đang submit).
- Sau timeout/lỗi mạng: hiển thị "Không thể kết nối, thử lại." — phân biệt với auth error.
- Kiểm tra `error.message` từ Supabase: nếu chứa "fetch" hoặc network error → message khác.

---

## Test Plan

### Unit Tests (Vitest)

File: `src/lib/username-utils.test.ts`

| Test case | Input | Expected |
|-----------|-------|----------|
| validateUsername — valid | "huynq12" | null (no error) |
| validateUsername — valid với underscore | "huy_nguyen" | null |
| validateUsername — valid với gạch ngang | "huy-nguyen" | null |
| validateUsername — quá ngắn (2 ký tự) | "ab" | error message |
| validateUsername — quá dài (21 ký tự) | "abcdefghijklmnopqrstu" | error message |
| validateUsername — bắt đầu bằng số | "1huy" | error message |
| validateUsername — bắt đầu bằng underscore | "_huy" | error message |
| validateUsername — bắt đầu bằng gạch ngang | "-huy" | error message |
| validateUsername — ký tự đặc biệt | "huy@" | error message |
| validateUsername — khoảng trắng | "huy nq" | error message |
| validateUsername — đúng 3 ký tự | "abc" | null |
| validateUsername — đúng 20 ký tự | "abcdefghijklmnopqrst" | null |
| buildFakeEmail — lowercase | "HuyNQ12" | "huynq12@geochat.app" |
| buildFakeEmail — đã lowercase | "huynq12" | "huynq12@geochat.app" |

File: `src/lib/use-auth.test.ts` (mock Supabase client)

| Test case | Setup | Expected |
|-----------|-------|----------|
| signIn — thành công | mock signInWithPassword returns session | user set, username set, no error |
| signIn — sai password | mock returns error "Invalid login credentials" | returns `{ error: "Thông tin đăng nhập không đúng." }` |
| signIn — bất kỳ lỗi Supabase | mock returns any error | returns generic error string |
| signUp — thành công | mock signUp returns session with user_metadata.username | user set, username set, no error |
| signUp — username trùng | mock returns error "User already registered" | returns `{ error: "Username đã tồn tại." }` |
| signUp — invalid username (validation) | username = "1bad" | returns validation error BEFORE calling Supabase |
| username from metadata | user.user_metadata.username = "huynq12" | useAuth().username === "huynq12" |
| username fallback (old magic link user) | user.user_metadata.username = undefined, email = "huynq12@geochat.app" | useAuth().username === null (component tự fallback) |

### Integration Tests (Vitest + Supabase local hoặc test project)

Chỉ chạy khi có Supabase URL + key (skip trong CI nếu không có env).

| Test case | Steps | Expected |
|-----------|-------|----------|
| Sign-up happy path | signUp("testuser123", "password123") | profiles row tồn tại, session active |
| Sign-up duplicate | signUp("testuser123", "password123") 2 lần | lần 2 trả error "Username đã tồn tại." |
| Sign-in happy path | signUp rồi signOut rồi signIn cùng credentials | session active, username đúng |
| Sign-in sai password | signIn("testuser123", "wrongpassword") | error, không có session |
| Sign-in username không tồn tại | signIn("notexist", "anything") | error giống sai password (không tiết lộ) |
| Trigger tạo profile | signUp() → query profiles where id = user.id | row tồn tại với đúng username |

### E2E Tests (Playwright)

File: `e2e/username-auth.spec.ts`

**Happy path — sign-up + chat + persist:**
```
1. Mở trang /
2. Click nút "Đăng nhập" → modal mở
3. Chọn tab "Đăng ký"
4. Nhập username hợp lệ (random để tránh conflict trong CI) + password
5. Click "Đăng ký"
6. Modal đóng, header hiện "@{username}"
7. Gõ tin nhắn + Enter → tin xuất hiện trong chat với đúng username
8. Refresh page
9. Header vẫn hiện "@{username}" (session persist)
10. Click "Đăng xuất" → header hiện nút "Đăng nhập"
```

**Duplicate username:**
```
1. Sign-up username "testdup" (lần 1 thành công)
2. Sign-out
3. Modal → Sign Up tab → nhập "testdup" + password khác
4. Click "Đăng ký" → error "Username đã tồn tại." hiển thị
5. Modal vẫn mở, không navigate
```

**Sign-in sai password:**
```
1. Sign-up username "testlogin" + password "correct"
2. Sign-out
3. Modal → Sign In tab → nhập "testlogin" + password "wrong"
4. Error "Thông tin đăng nhập không đúng." hiển thị
5. Modal vẫn mở
```

**Username validation client-side:**
```
1. Modal → Sign Up tab
2. Nhập username "1bad" → error hiện ngay (không cần submit)
   (hoặc hiện khi blur — tùy UX design của dev)
3. Nhập username "_bad" → error
4. Nhập username "ab" (quá ngắn) → error
5. Nhập username "gooduser" → không có error
```

**Accessibility:**
```
1. Mở modal
2. ESC → modal đóng
3. Tab navigation hoạt động bên trong modal
4. Click backdrop → modal đóng
```

---

## Implementation Order

Thứ tự build để minimize breakage (không break tính năng chat đang chạy):

### Bước 1 — Chuẩn bị hạ tầng (không break gì)
1. Tắt "Email Confirm" trong Supabase Dashboard.
2. Tạo `src/lib/username-utils.ts` (pure functions, không phụ thuộc gì).
3. Viết unit tests cho `username-utils.ts`.

### Bước 2 — Migration DB
4. Tạo `supabase/migrations/0004_profiles.sql`.
5. Chạy migration trên Supabase Studio (user tự chạy, giống 0001–0003).
6. Verify: bảng `profiles` tồn tại, trigger active.

### Bước 3 — Nâng cấp use-auth (backward compat)
7. Sửa `src/lib/use-auth.ts`: thêm `username`, `signUp`, `signIn`. Giữ nguyên `signOut`, `user`, `loading`, `configured`.
8. `signIn` mới dùng `signInWithPassword` thay `signInWithOtp`. **Lưu ý**: export type `UseAuth` phải cập nhật đồng bộ.

### Bước 4 — Tạo AuthModal
9. Cài shadcn Dialog nếu chưa có: `npx shadcn@latest add dialog`.
10. Tạo `src/components/auth-modal.tsx`.
11. Tạo `src/components/header-auth.tsx`.

### Bước 5 — Tích hợp vào page
12. Sửa `src/app/page.tsx`: thay `<AuthPanel />` bằng `<HeaderAuth />`.
13. Sửa `src/components/chat-panel.tsx`: dùng `username` từ `useAuth()`.

### Bước 6 — Dọn dẹp
14. Xóa/thay nội dung `src/components/auth-panel.tsx` (nếu không dùng nữa).
15. Xử lý `src/app/auth/callback/route.ts` — giữ lại redirect về `/` để tránh 404.

### Bước 7 — Test
16. Chạy unit tests: `npm test`.
17. Chạy `npm run build` — phải pass.
18. Chạy e2e: `npx playwright test`.

---

## Decisions & Assumptions

| Quyết định | Lý do | Trade-off / Assumption |
|-----------|-------|----------------------|
| Trigger Postgres thay vì client insert profiles | Tránh race condition & orphan auth user | Trigger fail → signUp rollback hoàn toàn — OK |
| Email fake = `{username.lower()}@geochat.app` | Đơn giản, không cần lookup DB khi sign-in | Không thể đổi domain sau này mà không migrate tất cả emails |
| username từ JWT metadata | Không cần query thêm, nhanh | Stale nếu username được phép đổi — OK vì immutable |
| Error message chung cho sign-in | Tránh enumerate username | UX hơi kém (user không biết username sai hay password sai) — chấp nhận được |
| Dùng shadcn Dialog cho modal | Có sẵn trong stack, a11y tốt | Dev cần cài nếu chưa có |
| username immutable | Tránh phức tạp cascade update | User muốn đổi tên phải tạo account mới |
| Không cần migration cho messages/locations | user_name là text tự do, backward compat | Tin cũ vẫn hiện email thay username — chấp nhận được |
| Tắt Email Confirm thủ công | Migration không thể đổi Auth Settings | Dev phải nhớ làm trước khi test — cần document rõ |
| `signIn` không validate username trước | Không tiết lộ username tồn tại | User có thể nhập username sai format → Supabase trả "Invalid credentials" → UX OK |

---

> Sau khi thiết kế này được duyệt, chạy `/build` để giao cho feature-builder triển khai.
> Checker dùng mục "Tiêu chí nghiệm thu" và "Test Plan" để nghiệm thu.
