# STATE — Feature: Typing indicator ("đang gõ…")

> Dogfood cỗ máy đầy đủ: /autoplan → /build → /review (+/cso nếu cần) → /qa → /ship → reflect.

## Scope (autoplan — chốt 2026-06-22)

**Mục tiêu**: khi user A đang gõ tin nhắn, user B (và mọi người trong chat) thấy "A đang nhập…" realtime. Tắt khi A dừng gõ hoặc gửi tin.

**Auto-decided (không cần escalate — đều reversible, khớp convention):**
- Cơ chế: Supabase Realtime **broadcast** (không phải Postgres changes, không lưu DB) — typing là ephemeral, đúng pattern presence/broadcast.
- Channel: tái dùng hoặc tạo channel "typing" broadcast event `{userId, userName, typing:bool}`.
- Chỉ user đã login mới phát typing (khớp auth). Anon/chưa login: không phát, vẫn thấy người khác.
- Debounce: phát "typing:true" khi gõ; tự "typing:false" sau ~2s không gõ; "false" ngay khi gửi tin.
- Hiển thị: dòng nhỏ dưới danh sách tin trong ChatPanel ("A đang nhập…" / "A, B đang nhập…").

**IN:** broadcast typing, hiển thị indicator, debounce, multi-user (>1 người gõ).
**OUT:** lưu lịch sử typing, typing trên map, read-receipt.

**Edge case:**
- Nhiều người gõ cùng lúc → gộp tên.
- User đóng tab khi đang "typing:true" → indicator phải tự hết (timeout phía người nhận, không chỉ dựa false event).
- Không tự hiện "bạn đang nhập" cho chính mình.
- Thiếu Supabase / chưa login → không vỡ, không phát.
- Cleanup: removeChannel + clear timeout khi unmount.

## Plan (autoplan)

**File mới:**
1. `src/lib/use-typing.ts` — hook: nhận identity. Tạo/tái dùng channel broadcast "geochat-typing". Trả `{ typingUsers: {userId,userName}[], notifyTyping: () => void }`.
   - `notifyTyping()`: gọi khi user gõ → broadcast {userId,userName,typing:true}; set local timer 2s → broadcast typing:false.
   - Nhận event: cập nhật map userId→{userName, lastSeen}. Lọc bỏ chính mình. Mỗi user có timeout phía nhận (vd 4s) tự xóa nếu không nhận thêm event (phòng tab đóng đột ngột).
   - Cleanup: removeChannel + clear mọi timer.

**File sửa:**
2. `src/components/chat-panel.tsx` — gọi `useTyping(identity)`; input `onChange` → `notifyTyping()`; render dòng "X đang nhập…" trên ô input. Khi `handleSend` → broadcast false (qua hook).

**Data flow:** A gõ → onChange → notifyTyping → broadcast typing:true → B nhận → hiện "A đang nhập…" → A dừng 2s hoặc gửi → broadcast false → B ẩn (hoặc timeout 4s tự ẩn).

**Acceptance:** xem testplan.

**Security note:** typing chỉ broadcast {userId, userName} — không dữ liệu nhạy cảm, không đụng RLS/DB. → KHÔNG cần /cso lần này (ghi rõ lý do).

## Phase
| Bước | Trạng thái |
|------|-----------|
| autoplan (think+plan) | ✅ Done |
| build (Maker) | ✅ Done |
| review (Checker) | ✅ PASS (1 finding 🟡) |
| fix finding 🟡 (Maker) | ✅ Done — chờ qa |
| qa | ✅ PASS — build/lint sạch, cleanup 3-path verify, null-safe, lọc-mình OK |
| ship | ✅ Done |

## QA log (2026-06-23)
- ✅ build pass, eslint use-typing.ts + chat-panel.tsx sạch (testplan 1-2).
- ✅ lọc-bỏ-mình (line 125), null-safe (111/195/206) (testplan 4-5).
- ✅ heartbeat clear 3 path (183 stop-timer, 226 stopTyping, 240 unmount) + guard 215 → không leak (testplan 6 + F1 Maker).
- ✅ throttle: gõ liên tục ~7 msg/10s thay vì /keystroke.
- ⏳ testplan 7-8 (2 tab live + đóng tab đột ngột): cần test bằng mắt với Supabase + login. Logic verify khớp.

## Build log (Maker — 2026-06-22)

**File mới:** `src/lib/use-typing.ts`
**File sửa:** `src/components/chat-panel.tsx`

**Kết quả:**
- `npm run build` → PASS (TS strict, type check OK).
- `npm run lint` → use-typing.ts & chat-panel.tsx SẠCH. 3 lỗi còn lại đều ở `use-messages.ts` (pre-existing, testplan loại trừ, không đụng).

**Điểm Checker chú ý / chỗ chưa chắc:**
1. Broadcast handler param `msg.payload` ép kiểu `as TypingPayload | undefined` — SDK type của broadcast callback là `{ payload: any }`, nên ép kiểu là cần. Checker verify guard `if (!payload || !payload.userId) return;` đủ an toàn.
2. `.on("broadcast", ...)` overload: phải để callback param không annotate (suy luận từ SDK) — annotate thủ công làm hỏng overload (đã gặp & sửa).
3. `identityRef` cập nhật trong `useEffect([identity])`, KHÔNG gán khi render (tránh lint react-hooks/refs). `useRef(identity)` đã giữ giá trị mount đầu → handler/notify luôn có identity hợp lệ ngay từ đầu. Checker xác nhận không có race "phát trước khi identityRef cập nhật".
4. Mặc định Supabase broadcast: client KHÔNG tự nhận lại event mình gửi (no self-echo), nên việc lọc `payload.userId === identityRef.current?.userId` chủ yếu phòng vệ. Checker xác nhận lọc-bỏ-mình vẫn đúng kể cả nếu cấu hình `self: true` (hiện không bật).
5. `notifyTyping` chỉ phát khi `subscribedRef.current === true`. Nếu user gõ TRƯỚC khi channel SUBSCRIBED (rất sớm) → keystroke đó bị bỏ; nhưng keystroke kế sau khi subscribed sẽ phát. Chấp nhận được (typing là ephemeral). Checker đánh giá.
6. `RECEIVER_TIMEOUT_MS=4000` > `STOP_TYPING_DELAY_MS=2000`: người gõ liên tục phát lại true MỖI keystroke → reset timer nhận đều đặn, không nhấp nháy. Người dừng gõ → sau 2s phát false (ẩn ngay); nếu false thất lạc → timeout nhận 4s ẩn dự phòng.
7. Hiển thị: `typingLabel` gộp >2 người thành "A, B +N đang nhập…" (plan chỉ nêu "A, Y" cho 2 người; tôi tự thêm xử lý >2 cho gọn UI). Checker xác nhận có chấp nhận biến thể này.
8. chat-panel: `typingIdentity = ready && user ? {...} : null` → mock/chưa login KHÔNG phát (onChange chỉ gọi notifyTyping khi typingIdentity != null). Vẫn nhận & hiển thị typing người khác kể cả khi chưa login? KHÔNG — vì identity=null thì hook vẫn subscribe channel và hiển thị (lọc-bỏ-mình không loại ai khi userId rỗng). Checker xác nhận hành vi mong muốn: chưa login VẪN thấy người khác gõ (đúng scope dòng 12 STATE). [Hiện tại: có subscribe khi chưa login vì useTyping luôn tạo channel nếu có Supabase — đúng yêu cầu "vẫn thấy người khác".]

**Assumption đã đặt (Checker verify):**
- A1: Supabase broadcast không cần channel phải có ai "join" trước — `channel.send` sau SUBSCRIBED là đủ để các client khác cùng channel nhận. (Theo doc Supabase broadcast.)
- A2: Không cần lưu DB / không đụng RLS → đúng security note, không cần /cso.
- A3: Per-user setTimeout phía nhận đủ cho edge "đóng tab đột ngột" — không cần interval polling.
- A4: Gửi tin: hook expose thêm `stopTyping()` → handleSend gọi `stopTyping()` (nếu typingIdentity != null) → phát typing:false NGAY + hủy timer 2s. Khớp spec dòng 13 "false ngay khi gửi tin". Checker verify nút Gửi & phím Enter đều đi qua handleSend (đúng — cả onClick lẫn onKeyDown Enter gọi handleSend).

## Fix finding 🟡 (Maker — 2026-06-23): throttle phía gửi

**Vấn đề:** notifyTyping phát `channel.send` MỖI keystroke → spam quota Realtime (gõ 200 ký tự = 200 broadcast).

**Sửa (chỉ trong `src/lib/use-typing.ts`, không đụng file khác):**
- Thêm `isTypingRef` (boolean), `heartbeatRef` (`setInterval`), hằng `TYPING_HEARTBEAT_MS = 2000`.
- `notifyTyping()`:
  - Nếu `isTypingRef=false` → set true, `sendTyping(true)` NGAY, bật heartbeat interval re-send true mỗi 2s.
  - Nếu đã typing → KHÔNG phát lại; chỉ re-arm stop-timer.
  - Mỗi keystroke reset stop-timer 2s; hết hạn → clear heartbeat, `isTypingRef=false`, `sendTyping(false)`.
- `stopTyping()`: clear stop-timer + heartbeat, `isTypingRef=false`, `sendTyping(false)`.
- Cleanup unmount (effect `[]`): thêm `clearInterval(heartbeatRef)` + reset `isTypingRef`.
- RECEIVER_TIMEOUT_MS giữ 4s (> heartbeat 2s) → người gõ liên tục >4s vẫn không bị timeout ẩn nhầm vì heartbeat re-arm timer nhận mỗi 2s.

**Giữ nguyên (không đụng):** lọc-bỏ-mình, null-safe guard, receiver timeout 4s per-user, chat-panel.tsx.

**Kết quả:**
- `npm run build` → PASS (TS strict).
- `npx eslint src/lib/use-typing.ts` → SẠCH (no output).
- KHÔNG commit.

**Quota sau fix:** gõ liên tục 10s = 1 (start) + ~5 heartbeat + 1 (false) ≈ 7 broadcast, thay vì hàng trăm.

**Chỗ chưa chắc — Checker/qa verify:**
- F1 (heartbeat clear đúng trong cleanup?): heartbeat được clear ở 3 chỗ — (a) khi stop-timer hết hạn, (b) trong `stopTyping()`, (c) trong cleanup effect `[]` lúc unmount. `heartbeatRef` là module-instance ref nên không bị stale qua re-render. Tôi cho là không leak, nhưng nhờ Checker xác nhận KHÔNG có nhánh nào tạo interval mới mà bỏ sót clear (đặc biệt: nếu `notifyTyping` được gọi lại khi `isTypingRef` đã true thì nhánh tạo interval bị skip → không tạo interval thừa; chỉ tạo khi false→true, và trước khi tạo có `if (heartbeatRef.current) clearInterval` phòng vệ).
- F2: Heartbeat dùng `setInterval` (không phải re-arm setTimeout). Interval gọi `sendTyping(true)` chỉ khi `isTypingRef` vẫn true — nếu vì lý do nào đó isTypingRef bị tắt mà interval chưa clear (race), callback no-op an toàn. Checker đánh giá có chấp nhận.
- F3: `sendTyping` vẫn tự guard `subscribedRef` + identity → heartbeat không phát khi mất subscribe. Không thêm cơ chế tự-stop heartbeat khi unsubscribe giữa chừng (chỉ no-op). Chấp nhận được cho ephemeral typing? Nhờ Checker đánh giá.
