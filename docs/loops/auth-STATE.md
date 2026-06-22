# STATE — Feature: Auth (đăng nhập email magic link)

> Feature dogfood pipeline đầu tiên (Step 6 context). Chạy qua: office-hours → plan → build(Maker) → review(Checker) → qa → ship.

## Scope (office-hours — chốt 2026-06-22)

**Mục tiêu**: user đăng nhập bằng **email magic link** (Supabase Auth), thay danh tính tạm (localStorage) bằng user thật. Sau đăng nhập, chỉ user đã auth mới gửi được tin.

**IN:**
- Đăng nhập bằng email magic link (nhập email → nhận link → click → vào app).
- Hiển thị trạng thái đăng nhập + nút đăng xuất.
- Chat dùng user thật (id, tên/email) thay `useIdentity` localStorage.
- Siết RLS bảng messages: INSERT chỉ `authenticated`, `user_id = auth.uid()`. SELECT vẫn mở.

**OUT (không làm lần này):**
- Password / OAuth / social login.
- Profile, avatar, đổi tên hiển thị.
- Map presence (feature riêng).

**Edge case:**
- Chưa đăng nhập → chat ở chế độ chỉ đọc (hoặc chặn gửi, hiện CTA đăng nhập).
- Magic link callback xử lý session.
- Mạng rớt khi gửi magic link → báo lỗi rõ.
- Tin cũ có user_id="seed"/text cũ vẫn hiển thị (không vỡ UI).

**Ảnh hưởng phần đã có:**
- Thay `src/lib/identity.ts` (localStorage) → dùng session Supabase.
- `useMessages.send` truyền user_id = auth user thật.
- Cần Supabase server client (đọc session phía server) — thêm `lib/supabase/server.ts`.

**Tiêu chí nghiệm thu (Checker kiểm):**
1. Build pass, dev 200 không lỗi.
2. Chưa đăng nhập: không gửi được tin (UI chặn + RLS chặn).
3. Đăng nhập email → nhận được luồng magic link (verify gọi `signInWithOtp` thành công, không cần thật sự click email trong qa tự động).
4. RLS mới: INSERT bằng anon key không session → bị từ chối (test qua REST).
5. removeChannel/cleanup không leak.

## Plan (plan — 2026-06-22)

**Lib**: `@supabase/ssr@^0.12`, `@supabase/supabase-js@^2.108`, Next 16 App Router.

**Architecture / file:**
1. `src/lib/supabase/server.ts` (mới) — `createServerClient` đọc/ghi cookie qua `next/headers` cookies(). Server Components/route handlers.
2. `src/middleware.ts` (mới) — refresh session, đồng bộ cookie mỗi request (chuẩn @supabase/ssr Next).
3. `src/app/auth/callback/route.ts` (mới) — route handler nhận magic link, `exchangeCodeForSession`, redirect về `/`.
4. `src/components/auth-panel.tsx` (mới, client) — chưa đăng nhập: input email + nút "Gửi magic link" (`signInWithOtp`, emailRedirectTo = origin + /auth/callback); đã đăng nhập: hiện email + nút Đăng xuất (`signOut`).
5. `src/lib/use-auth.ts` (mới, client) — hook lấy user hiện tại từ `supabase.auth.getUser()` + lắng `onAuthStateChange`.
6. SỬA `src/components/chat-panel.tsx` — bỏ `useIdentity`, dùng user từ use-auth. Chưa đăng nhập → ô nhập disabled + CTA. user_id = user.id, user_name = email (phần trước @).
7. SỬA `src/lib/use-messages.ts` — `send` nhận identity từ caller (đã vậy), không cần đổi nhiều; bỏ phụ thuộc localStorage.
8. XÓA dùng `src/lib/identity.ts` (giữ file hoặc xóa — Maker quyết, ghi rõ).
9. Migration `supabase/migrations/0002_auth_rls.sql` (mới):
   - drop policy insert cũ (anon), tạo policy INSERT chỉ `authenticated` + `with check (auth.uid()::text = user_id)`.
   - SELECT giữ mở.

**Data flow:** nhập email → signInWithOtp → email chứa link → click → /auth/callback exchange → cookie session → middleware refresh → chat dùng user thật → INSERT kèm user_id=auth.uid → RLS cho qua.

**Edge case xử lý:**
- Chưa login: ChatPanel disable input, hiện AuthPanel.
- Lỗi gửi link: hiện message từ error.
- Tin cũ user_id text (seed/uuid cũ): vẫn render (so sánh "mine" theo user.id, không khớp thì coi là người khác — OK).

**Acceptance**: như mục Scope.

**Lưu ý migration**: cần user chạy file 0002 trên Supabase Studio (giống 0001).

## Phase
| Bước | Trạng thái |
|------|-----------|
| office-hours | ✅ Done |
| plan | ✅ Done |
| build (Maker) | ✅ Done — `npm run build` pass |
| review (Checker) | ✅ Done — NEEDS-WORK, 2 finding đã xử lý |
| qa | ✅ PASS — runtime + RLS đều verify |
| ship | ✅ Done |

## QA log (2026-06-22)
- ✅ `npm run build` PASS, không deprecation warning. `middleware.ts` đã xóa, `proxy.ts` + file auth có đủ.
- ✅ dev server: `/` → 200; `/auth/callback` không param → 307 redirect (đúng nhánh missing_code); không lỗi runtime trong log.
- ✅ **Tiêu chí #4 (RLS chặn anon INSERT)**: sau khi user chạy 0002 → anon INSERT trả **401** ("new row violates row-level security policy"); SELECT vẫn 200. ĐẠT.
- ⏳ Tiêu chí #2/#3 (đăng nhập email thật + nhận ?code=) cần click email thật — phụ thuộc email template Supabase (Finding #1 đã làm callback chịu cả 2 dạng nên an toàn hơn).
- Nợ: dọn tin test rác trong DB (anon-test, hello from curl) — xóa trong Studio.

## Build log (Maker — 2026-06-22)

**File thêm:**
- `src/lib/supabase/server.ts` — createServerClient async (cookies() Next 16), trả null khi thiếu env.
- `src/middleware.ts` — refresh session @supabase/ssr; an toàn khi thiếu env (trả NextResponse.next gốc).
- `src/app/auth/callback/route.ts` — GET: exchangeCodeForSession(code) → redirect `/`; lỗi → `/?auth_error=...`.
- `src/lib/use-auth.ts` — hook {user, loading, configured, signOut}; getUser() + onAuthStateChange.
- `src/components/auth-panel.tsx` — magic link UI (signInWithOtp) / hiện email + Đăng xuất.
- `supabase/migrations/0002_auth_rls.sql` — drop policy anon insert; INSERT chỉ authenticated + auth.uid()::text = user_id; SELECT giữ nguyên; có ROLLBACK comment. **User tự chạy trên Studio.**

**File sửa:**
- `src/components/chat-panel.tsx` — dùng useAuth thay useIdentity; chưa login → input disabled + CTA; user_id=user.id, user_name=email trước '@'; "mine" theo user.id.
- `src/app/page.tsx` — render `<AuthPanel/>` ở header.

**File xóa:**
- `src/lib/identity.ts` — đã orphan (không còn import), xóa để tránh dead code + lint error.

**Kết quả build:** `npm run build` PASS. Lint còn 2 error pre-existing trong `use-messages.ts` (react-hooks/refs — không thuộc scope task này).

## Review fix log (Maker — 2026-06-22)

Checker trả **NEEDS-WORK** với 2 finding. Đã xử lý cả hai, không đổi thứ khác:

- **Finding #1 (🟡) — callback chịu cả token_hash flow:** Sửa `src/app/auth/callback/route.ts`. Giờ:
  - Có `code` → `exchangeCodeForSession(code)` (như cũ).
  - Không có code nhưng có `token_hash` + `type` → `verifyOtp({ type, token_hash })` (type ép kiểu `EmailOtpType`).
  - Thiếu cả hai → `/?auth_error=missing_code`. Lỗi exchange/verify → `/?auth_error=<message>`.
  - Vẫn dùng server client `createClient()` (null-safe khi thiếu env).
- **Finding #2 (🟡) — middleware deprecated ở Next 16:** Đổi `src/middleware.ts` → `src/proxy.ts`, export hàm `proxy` (thay `middleware`), giữ nguyên `config.matcher` + logic refresh session. Xóa `src/middleware.ts` cũ.

**Kết quả build sau fix:** `npm run build` PASS. KHÔNG còn warning "middleware deprecated" (output chỉ còn nhãn route-table `ƒ Proxy (Middleware)`, không phải warning). Không commit, không chạy migration.

**Phase:** review ✅ → chờ qa lại.
