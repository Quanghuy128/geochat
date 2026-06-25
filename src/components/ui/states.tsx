"use client";

/**
 * 3 trạng thái UI dùng chung giữa các panel list (Friends, DM Inbox, DM Thread):
 * loading (SkeletonRows), error (ErrorState), rỗng (EmptyState).
 * Trích xuất từ `friends-panel.tsx` (đã định nghĩa inline) theo đề xuất
 * dm-chat-design.md mục 4, để DM tái dùng đúng pattern visual mà không copy-paste.
 */

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <span className="text-2xl">{icon}</span>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-red-50 p-4 text-center dark:bg-red-900/20">
      <p className="text-sm text-red-600 dark:text-red-400">⚠ Không tải được dữ liệu</p>
      <p className="text-xs text-red-500 dark:text-red-400">Lỗi: {message}</p>
      <button
        onClick={onRetry}
        className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/40"
      >
        Thử lại
      </button>
    </div>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
        />
      ))}
    </div>
  );
}
