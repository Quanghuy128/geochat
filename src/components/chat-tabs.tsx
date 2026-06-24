"use client";

import { ChatPanel } from "@/components/chat-panel";
import { DmPanel } from "@/components/dm-panel";
import type { Message } from "@/lib/types";

export type ChatTab = "global" | "dm";

interface ChatTabsProps {
  /** Truyền thẳng xuống ChatPanel (Global) — contract không đổi. */
  fallback: Message[];
  /** Tab đang active — page.tsx sở hữu state này để FriendsPanel có thể chuyển tab từ ngoài. */
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  /** Set externally khi "Nhắn tin" được tap trong FriendsPanel — mở thread đó ngay trong DmPanel. */
  pendingOpenFriendId: string | null;
  /** Username của peer kèm theo pendingOpenFriendId — tránh phải tra cứu lại trong DmPanel. */
  pendingOpenFriendUsername: string;
  onConsumedPendingOpen: () => void;
}

/**
 * `ChatTabs` — tab switcher "Chung" (Global, ChatPanel nguyên trạng) / "Tin nhắn" (DM, mới).
 * Thay thế mount `<ChatPanel>` trực tiếp trong page.tsx (dm-chat-design.md mục 3.1 + 4).
 *
 * DmPanel UNMOUNT khi rời tab "Tin nhắn" (quyết định kỹ thuật PLAN mục 5) — đơn giản hóa
 * cleanup Realtime channel, đổi lại mất state inbox/thread khi tab-switch trong session.
 * ChatPanel (Global) giữ mounted nguyên trạng — KHÔNG đổi behavior chat toàn cục hiện tại.
 */
export function ChatTabs({
  fallback,
  activeTab,
  onTabChange,
  pendingOpenFriendId,
  pendingOpenFriendUsername,
  onConsumedPendingOpen,
}: ChatTabsProps) {
  return (
    <div className="flex h-full flex-col border-r border-zinc-200 dark:border-zinc-800">
      <div className="flex border-b border-zinc-200 px-2 dark:border-zinc-800">
        <TabButton active={activeTab === "global"} onClick={() => onTabChange("global")} label="Chung" />
        <TabButton active={activeTab === "dm"} onClick={() => onTabChange("dm")} label="Tin nhắn" />
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "global" ? (
          // ChatPanel tự vẽ border-r + header riêng — giữ nguyên 100%, không sửa
          // chat-panel.tsx (contract/behavior bất biến theo PLAN). Tab bar ở trên thay
          // thế vị trí mà header cũ của ChatPanel chiếm khi nó là panel độc lập.
          <ChatPanel fallback={fallback} />
        ) : (
          <DmPanel
            pendingOpenFriendId={pendingOpenFriendId}
            pendingOpenFriendUsername={pendingOpenFriendUsername}
            onConsumedPendingOpen={onConsumedPendingOpen}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-blue-600 text-blue-600 dark:text-blue-400"
          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
