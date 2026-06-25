"use client";

import type { ReactNode } from "react";

/**
 * `MessageBubble` — JSX bubble dùng chung giữa `DmThread`/`GroupThread` (PLAN > Resolving
 * Design Open Question #5: YES, dedup rendering — KHÔNG reopen schema unification, chỉ UI).
 *
 * Presentation-only — KHÔNG import `createClient()`/bất kỳ hook nào. Mọi data đã được
 * `DmThread`/`GroupThread` chuẩn bị sẵn qua props; mọi tương tác (react/reply/jump) bubble
 * lên qua callback, KHÔNG tự gọi Supabase ở đây (Checker nên flag nếu vi phạm — PLAN > Trade-offs mục 5).
 */
export function MessageBubble({
  id,
  body,
  senderLabel,
  timeLabel,
  mine,
  onLongPress,
  reactionsSlot,
  quotedSlot,
}: {
  id: string;
  body: string;
  senderLabel: string;
  timeLabel: string;
  mine: boolean;
  onLongPress: (messageId: string) => void;
  reactionsSlot?: ReactNode;
  quotedSlot?: ReactNode;
}) {
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="text-xs text-zinc-500">
        {senderLabel} · {timeLabel}
      </div>
      <div className="group relative max-w-[80%]">
        <div
          onClick={() => onLongPress(id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onLongPress(id);
          }}
          className={`cursor-pointer rounded-2xl px-3 py-2 text-sm ${
            mine
              ? "bg-blue-600 text-white"
              : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {quotedSlot}
          {body}
        </div>
        <button
          onClick={() => onLongPress(id)}
          className="absolute -top-2 right-0 hidden rounded-full bg-zinc-200 px-1.5 text-xs text-zinc-600 group-hover:block dark:bg-zinc-700 dark:text-zinc-300"
          aria-label="Tùy chọn tin nhắn"
        >
          ···
        </button>
      </div>
      {reactionsSlot}
    </div>
  );
}
