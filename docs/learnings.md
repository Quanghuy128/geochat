# Learnings — Pattern tích lũy GeoChat

> Sau mỗi feature, ghi pattern học được + độ tin cậy. Maker/Checker đọc trước khi làm việc tương tự.
> Format: `- [confidence: cao/vừa/thấp] <pattern>. **Bối cảnh**: ...`

## Hạ tầng / môi trường
- [confidence: cao] Máy này có Node 25 + npm 11, **chưa có Bun và gh CLI**. Dùng npm cho scaffold. **Bối cảnh**: check 2026-06-22.

## Realtime (Supabase)
- [confidence: cao] Supabase dùng **hệ key mới**: `publishable` (an toàn cho browser/`NEXT_PUBLIC_*`) thay anon; `secret` thay service_role (KHÔNG để client). Code đọc qua tên biến `NEXT_PUBLIC_SUPABASE_ANON_KEY` vẫn nhận publishable key. **Bối cảnh**: project geochat 2026-06-22.
- [confidence: cao] Bật Realtime cho 1 bảng = `alter publication supabase_realtime add table public.<t>`. Subscribe qua `.channel().on("postgres_changes",{event:"INSERT",schema:"public",table})`. Tin của mình về qua realtime → đừng tự append local (tránh trùng), dedup theo id cho chắc. **Bối cảnh**: useMessages hook.
- [confidence: cao] Phải `supabase.removeChannel(channel)` trong cleanup useEffect, nếu không leak subscription. **Bối cảnh**: review checklist.
- [confidence: vừa] DELETE qua REST trả 204 nhưng 0 rows nếu thiếu RLS DELETE policy (im lặng, không báo lỗi). Test xóa phải verify số rows thật. **Bối cảnh**: tin test không xóa được.

## Auth (Supabase)
- [confidence: cao] `@supabase/ssr` (>=0.x) **hardcode `flowType: "pkce"`** sau spread options → không override được. Browser client lưu code-verifier vào cookie; callback route phải `exchangeCodeForSession(code)`. Magic link email dùng template `{{ .ConfirmationURL }}` mới ra `?code=`. Để chắc, callback nên chịu CẢ `token_hash`+`type` (verifyOtp) lẫn `code`. **Bối cảnh**: feature auth, Checker đọc source xác nhận.
- [confidence: cao] Next 16: file `middleware.ts` deprecated → đổi sang `proxy.ts` export hàm `proxy`. Build vẫn chạy với middleware nhưng có warning. **Bối cảnh**: review finding #2.
- [confidence: cao] RLS INSERT siết: `to authenticated with check (auth.uid()::text = user_id ...)`. Cột user_id là text nên ép `auth.uid()::text`. Verify: anon INSERT → 401 "violates row-level security policy". **Bối cảnh**: migration 0002.
- [confidence: cao] **Username login trên Supabase Auth** (vốn chỉ dùng email): pattern chuẩn = tạo email fake `{username}@{domain}` → `signInWithPassword(email, password)`. Không cần query DB khi sign-in (tránh enumerate username). Trigger Postgres `after insert on auth.users` auto-insert `profiles` với username từ `raw_user_meta_data->>'username'` — nếu trigger fail (unique violation) thì cả transaction auth.users cũng rollback. **Bối cảnh**: username-auth 2026-06-24.
- [confidence: cao] **Supabase Email Confirmation phải tắt thủ công** (Dashboard → Auth → Settings → Confirm email: OFF) trước khi test username+password auth. Migration SQL không thể đổi setting này. Nếu quên, `signUp` trả success nhưng `signInWithPassword` ngay sau đó fail "Email not confirmed" (user không biết kiểm email gì vì email là fake). Guard: sau `signUp`, kiểm `data.session === null` → trả error rõ ràng. **Bối cảnh**: BLOCKER 3 trong review username-auth.
- [confidence: cao] `username` sau `signUp` với `options.data.username` được Supabase nhúng vào JWT `user.user_metadata.username` — đọc được client-side mà không cần query DB thêm. Immutable username an toàn dùng JWT; nếu sau này cho phép đổi username, phải query `profiles` thay. **Bối cảnh**: username-auth 2026-06-24.
- [confidence: cao] `useEffect` tương tác DOM (gọi `dialog.showModal()`, `dialog.close()`) phải là `useLayoutEffect` — tránh flash frame giữa render và DOM mutation. `useEffect` cho event listener thuần (addEventListener) giữ nguyên. **Bối cảnh**: BLOCKER 2 trong review username-auth (native `<dialog>` element).
- [confidence: cao] Catch-all error trong auth phải phân biệt loại lỗi, không map hết thành cùng 1 message. Pattern: check `error.message.includes("already registered")` trước → message cụ thể; catch-all → message chung "Không thể đăng ký. Vui lòng thử lại." Nếu map nhầm, network error hiển thị "Username đã tồn tại." — gây confuse. **Bối cảnh**: BLOCKER 1 review username-auth; confirmed thực tế qua bug "email_provider_disabled" → cùng catch-all nhưng lý do hoàn toàn khác.

## Broadcast / Typing (Supabase)
- [confidence: cao] Supabase **broadcast** (khác Postgres changes & Presence) cho event ephemeral không cần lưu DB — vd typing indicator. `channel.on("broadcast",{event},cb)` + `channel.send`. Mặc định no self-echo. **Bối cảnh**: typing-indicator 2026-06-23.
- [confidence: cao] `.on("broadcast", cb)` — KHÔNG annotate kiểu param callback (làm hỏng overload → rơi sang "system"). Đọc `msg.payload as T | undefined` + guard. **Bối cảnh**: build typing.
- [confidence: cao] Typing indicator: **throttle phía gửi** — phát true 1 lần khi bắt đầu + heartbeat re-send mỗi ~2s khi vẫn gõ, KHÔNG phát mỗi keystroke (tiết kiệm quota Realtime: ~7 msg/10s thay vì hàng trăm). Receiver timeout 4s > heartbeat 2s để không ẩn nhầm. Phía nhận: per-user setTimeout tự xóa khi tab đóng đột ngột. **Bối cảnh**: Checker bắt finding 🟡, fix throttle+heartbeat.

## Quy trình loop (cập nhật)
- [confidence: cao] Custom agents (.claude/agents/), commands (.claude/commands/), hook (.claude/settings.json), MCP (.mcp.json) **không nạp giữa session** nếu tạo sau khi Claude Code khởi động → cần restart. Sau restart: agent gọi qua Agent tool, command thành skill, MCP tool xuất hiện. **Bối cảnh**: dogfood pipeline auth phải mô phỏng bằng general-purpose subagent trước restart, sau restart thì feature-builder/code-reviewer dùng được thật.
- [confidence: cao] Dogfood Maker≠Checker hiệu quả: Checker (subagent độc lập) bắt được điều Maker bỏ sót bằng cách tự đọc source lib, không tin báo cáo Maker. **Bối cảnh**: review auth tìm ra PKCE flow + middleware deprecation.
- [confidence: cao] **QA không có Chrome**: khi Chrome MCP không khả dụng, bù bằng curl trực tiếp Supabase Auth REST (`/auth/v1/signup`, `/auth/v1/token`) để test sign-up/sign-in thật — lấy được `error_code` chính xác, xác minh được session trả về. Không thể test UI flow nhưng cover được auth logic và RLS. Ghi rõ "UI flow chưa verify" trong STATE. **Bối cảnh**: QA username-auth, Chrome N/A, bug Dashboard config lọt qua.
- [confidence: cao] **Bug sau ship liên quan Dashboard config ≠ bug code**: khi sign-up fail với lỗi chung chung ("Không thể đăng ký"), bước đầu tiên là curl trực tiếp Supabase Auth REST (`/auth/v1/signup`) để lấy `error_code` thật — nhanh hơn đọc code. `email_provider_disabled` = Email provider tắt trong Dashboard, không phải lỗi trigger/migration. **Bối cảnh**: /investigate sau ship username-auth.
- [confidence: cao] **Supabase Dashboard settings hay bị quên**: "Email provider" (Providers → Email → Enable) và "Confirm email" (Settings → Email) là 2 setting khác nhau. Tắt "Confirm email" không tắt provider. Khi làm auth feature mới, checklist cả 2. **Bối cảnh**: retro username-auth — tắt Confirm email nhưng quên bật Email provider.

## Map / Presence (Google Maps + Supabase Presence)
- [confidence: cao] Supabase **Presence** cho vị trí live (channel.track payload), **bảng riêng** cho "vị trí cuối offline" — presence không persist khi mọi client rời. Merge thứ tự: dbLocations(load mount) → lastSeen(cache từ presence sync trong phiên) → presenceLocations(online). **Bối cảnh**: map-presence, finding Y2.
- [confidence: cao] **BUG hay gặp**: object truyền vào dep array effect (vd `identity`, `coords`) tạo mới mỗi render → effect track/upsert chạy lại MỖI render = spam DB write + re-track presence. Fix: useMemo object + dep array dùng PRIMITIVE (`identity?.userId`, `coords?.lat`...). **Bối cảnh**: map-presence blocker B1 (Checker bắt, Maker đã tự trấn an là "an toàn" → đúng giá trị Maker≠Checker).
- [confidence: cao] `channel.track()` phải gọi trong callback `subscribe((status)=>{ if(status==="SUBSCRIBED") track(latestPayloadRef.current) })` — track trước SUBSCRIBED bị Supabase bỏ qua. Dùng ref giữ payload mới nhất. **Bối cảnh**: finding Y3.
- [confidence: cao] RLS cho UPSERT cần CẢ `insert` policy (with check) LẪN `update` policy (using + with check). Thiếu update → upsert lần 2 (row đã có) fail. Verify: anon upsert → 401. **Bối cảnh**: migration 0003.
- [confidence: cao] `navigator.geolocation` chỉ ở client → guard `typeof navigator !== "undefined"` + `"use client"`, clearWatch trong cleanup. SSR build không vỡ. **Bối cảnh**: use-geolocation.
- [confidence: cao] **MapLibre + OSM = map free thật, KHÔNG cần key/thẻ** (khác Google Maps cần thẻ). Dùng `react-map-gl/maplibre` + `maplibre-gl`, style `https://demotiles.maplibre.org/style.json`. Phải import `maplibre-gl/dist/maplibre-gl.css` (thiếu → vỡ layout). MapLibre là WebGL client-only → tách component + `next/dynamic({ssr:false})`. **Bối cảnh**: đổi provider 2026-06-22 (commit sau ffd0b09). Lưu ý: demotiles là vector world style không-SLA, zoom cao ở VN chỉ ra biên giới — đổi tile có đường phố + SLA khi production.
- [confidence: vừa] `react-map-gl` `initialViewState` là uncontrolled → chỉ set center lúc mount, không re-center khi coords đổi sau. Muốn đuổi theo GPS cần controlled Map + flyTo. **Bối cảnh**: nit review MapLibre.

## Quy trình loop
- [confidence: vừa] Hook `careful` đặt ở `.claude/settings.json` không tự nạp nếu file chưa tồn tại lúc session khởi động → cần `/hooks` hoặc restart. **Bối cảnh**: tạo hook 2026-06-22.
