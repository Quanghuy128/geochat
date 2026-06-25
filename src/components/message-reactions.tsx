"use client";

import type { ReactionSummary } from "@/lib/types";

/**
 * `MessageReactions` — hàng pill reaction dưới 1 message bubble (design doc mục 3.2/3.3).
 * Presentation-only: nhận `reactions` đã tính sẵn từ hook (`useDmMessageReactions`/
 * `useGroupMessageReactions`), không tự gọi Supabase.
 *
 * - Tap pill CỦA CHÍNH MÌNH (reactedByMe=true) → `onToggleMine` (un-react, Open Design Q1
 *   default: single-tap toggle off).
 * - Tap pill KHÔNG phải của mình (hoặc của mình nhưng muốn xem ai khác cũng react) →
 *   `onOpenReactorList` — mở popover danh sách người react (design doc mục 3.6).
 * - `[+]` trailing chip (Open Design Q2 default: giữ lại) → `onOpenPicker`.
 * - Render rỗng hoàn toàn nếu `reactions.length === 0` (Interaction Notes: "không có pill nào
 *   nếu chưa ai react" — discoverability qua long-press/hover trên bubble, không phải pill).
 */
export function MessageReactions({
  reactions,
  disabled,
  onToggleMine,
  onOpenReactorList,
  onOpenPicker,
}: {
  reactions: ReactionSummary[];
  disabled: boolean;
  onToggleMine: (emoji: string) => void;
  onOpenReactorList: (emoji: string) => void;
  onOpenPicker: () => void;
}) {
  if (reactions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          disabled={disabled}
          onClick={() => (r.reactedByMe ? onToggleMine(r.emoji) : onOpenReactorList(r.emoji))}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:opacity-50 ${
            r.reactedByMe
              ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-900/30"
              : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
          }`}
        >
          <span>{r.emoji}</span>
          <span className="text-zinc-600 dark:text-zinc-400">{r.count}</span>
        </button>
      ))}
      {!disabled && (
        <button
          onClick={onOpenPicker}
          className="rounded-full border border-zinc-300 bg-transparent px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          +
        </button>
      )}
    </div>
  );
}
