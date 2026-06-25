"use client";

/**
 * `ReplyPreviewBar` — hiển thị phía trên composer khi đang soạn reply tới 1 tin nhắn
 * (design doc mục 3.7). Presentation-only.
 */
export function ReplyPreviewBar({
  replyTarget,
  onCancel,
}: {
  replyTarget: { messageId: string; senderLabel: string; bodyPreview: string } | null;
  onCancel: () => void;
}) {
  if (!replyTarget) return null;

  return (
    <div className="flex items-start gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50">
      <div className="flex-1 border-l-2 border-blue-500 pl-2">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Trả lời {replyTarget.senderLabel}
        </p>
        <p className="truncate text-xs text-zinc-500">{replyTarget.bodyPreview}</p>
      </div>
      <button
        onClick={onCancel}
        className="shrink-0 rounded-full px-1.5 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Hủy trả lời"
      >
        ×
      </button>
    </div>
  );
}
