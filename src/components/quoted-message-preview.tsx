"use client";

/**
 * `QuotedMessagePreview` — trích dẫn tin gốc render trong 1 tin reply (design doc mục 3.9).
 * Presentation-only. `foundInView` quyết định tap behavior: nếu tin gốc còn trong lịch sử
 * đã load (parent đã check), tap → jump/scroll (onJumpToOriginal); nếu không, tap vẫn gọi
 * onJumpToOriginal nhưng parent hiển thị toast "không tìm thấy" (design doc mục 3.10) —
 * component này không tự quyết logic đó, chỉ phân biệt visual hint nhẹ (opacity).
 *
 * Post-review fix (blocker #2): `MessageBubble` render `quotedSlot` này BÊN TRONG div
 * `onClick={() => onLongPress(id)}` của bubble cha (xem message-bubble.tsx) — nếu không
 * chặn bubbling, tap vào quote SẼ double-fire: vừa jump-to-original (đúng ý), vừa mở luôn
 * action sheet của bubble cha (sai, không mong muốn). `e.stopPropagation()` trước khi gọi
 * onJumpToOriginal đảm bảo tap vào quote CHỈ jump, không bubble lên parent's onLongPress.
 */
export function QuotedMessagePreview({
  senderLabel,
  bodyPreview,
  onJumpToOriginal,
  foundInView,
}: {
  senderLabel: string;
  bodyPreview: string;
  onJumpToOriginal: () => void;
  foundInView: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onJumpToOriginal();
      }}
      className={`mb-1 block w-full rounded-md border-l-2 border-blue-400 bg-black/5 px-2 py-1 text-left dark:bg-white/5 ${
        foundInView ? "" : "opacity-70"
      }`}
    >
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{senderLabel}</p>
      <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">{bodyPreview}</p>
    </button>
  );
}
