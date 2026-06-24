"use client";

/**
 * Nút "Bạn bè" trong header — mở FriendsPanel.
 * Hiện badge đỏ khi có incoming pending request (pendingCount > 0).
 * Ẩn hoàn toàn khi chưa login (caller chịu trách nhiệm không render khi !user).
 */
export function FriendsButton({
  pendingCount,
  onClick,
}: {
  pendingCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      aria-label="Bạn bè"
    >
      Bạn bè
      {pendingCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {pendingCount > 9 ? "9+" : pendingCount}
        </span>
      )}
    </button>
  );
}
