"use client";

/**
 * `ReactorListPopover` — danh sách username đã react bằng 1 emoji cụ thể trên 1 tin nhắn
 * (design doc mục 3.6). Presentation-only — `usernames`/`loading` được resolve lazily ở nơi
 * gọi (DmThread/GroupThread, query riêng `profiles` chỉ khi popover mở — PLAN > Trade-offs
 * mục 3: KHÔNG pre-join username vào bulk reaction load).
 */
export function ReactorListPopover({
  open,
  emoji,
  usernames,
  loading,
  onClose,
}: {
  open: boolean;
  emoji: string;
  usernames: string[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute z-20 min-w-[160px] rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-zinc-200 pb-1 text-sm dark:border-zinc-800">
        <span>
          {emoji} ({usernames.length})
        </span>
        <button
          onClick={onClose}
          className="rounded-full px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Đóng"
        >
          ×
        </button>
      </div>
      {loading ? (
        <div className="flex flex-col gap-1 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      ) : usernames.length === 0 ? (
        <p className="py-1 text-xs text-zinc-400">Không có ai</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {usernames.map((u) => (
            <li key={u} className="text-xs text-zinc-600 dark:text-zinc-400">
              @{u}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
