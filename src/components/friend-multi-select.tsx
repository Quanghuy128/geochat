"use client";

/**
 * Item tối thiểu cần để render 1 dòng chọn — chỉ cần `id`/`username`, KHÔNG bắt buộc
 * `Friend.requestId` đầy đủ (caller ở group-panel.tsx truyền `{id, username}` rút gọn từ
 * `Friend[]`/`GroupMember[]`, không phải lúc nào cũng có requestId).
 */
type SelectableFriend = { id: string; username: string };

interface FriendMultiSelectProps {
  /** Đã lọc bởi caller (vd loại trừ member hiện có của group cho add-picker). */
  friends: SelectableFriend[];
  selectedIds: Set<string>;
  onToggle: (friendId: string) => void;
  /** Số lượng tối đa CÒN được chọn thêm — disable checkbox chưa chọn khi đạt giới hạn. */
  maxSelectable?: number;
  /** Banner hiển thị khi đạt `maxSelectable` (vd "Đã đạt giới hạn 50 thành viên"). */
  disabledReason?: string;
}

/**
 * `FriendMultiSelect` — danh sách chọn nhiều bạn bè (checkbox), dùng chung cho
 * `CreateGroupForm` và add-member picker trong `GroupMemberList` (group-chat-design.md
 * mục 4). Pure controlled component — KHÔNG có state nội bộ, caller sở hữu `selectedIds`.
 */
export function FriendMultiSelect({
  friends,
  selectedIds,
  onToggle,
  maxSelectable,
  disabledReason,
}: FriendMultiSelectProps) {
  const atLimit = maxSelectable !== undefined && selectedIds.size >= maxSelectable;

  return (
    <div className="flex flex-col gap-2">
      {atLimit && disabledReason && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          ⚠ {disabledReason}
        </p>
      )}
      <div className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {friends.map((f) => {
          const checked = selectedIds.has(f.id);
          const disabled = !checked && atLimit;
          return (
            <label
              key={f.id}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(f.id)}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700"
              />
              <span className="text-zinc-900 dark:text-zinc-100">@{f.username}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
