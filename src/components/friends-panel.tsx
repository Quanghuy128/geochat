"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { useFriends } from "@/lib/use-friends";
import type { UseFriendRequests } from "@/lib/use-friend-requests";
import { useSendFriendRequest } from "@/lib/use-send-friend-request";
import type { Friend, FriendRequest } from "@/lib/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";

type Tab = "friends" | "requests";

interface FriendsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mount ở page.tsx (cấp cao hơn) — truyền xuống để tránh subscribe 2 channel trùng lặp. */
  friendRequests: UseFriendRequests;
  /**
   * Gọi khi user tap "Nhắn tin" trên 1 FriendRow — page.tsx chịu trách nhiệm đóng
   * panel này + chuyển ChatTabs sang "Tin nhắn" + mở/tạo conversation với friendId đó
   * (xem dm-chat-STATE.md > PLAN > mục 1 + design doc mục 3.12).
   */
  onMessageFriend: (friendId: string, friendUsername: string) => void;
}

/**
 * Panel "Bạn bè": slide-over từ phải (desktop) / full-screen overlay (mobile).
 * KHÔNG dùng native <dialog> (khác AuthModal) — đây là drawer overlay với backdrop riêng,
 * vì cần giữ Chat/Map nhìn thấy phía sau trên desktop (xem friends-design.md > Open Question #1).
 */
export function FriendsPanel({
  open,
  onOpenChange,
  friendRequests,
  onMessageFriend,
}: FriendsPanelProps) {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("friends");
  const panelRef = useRef<HTMLDivElement>(null);

  const identity = user ? { userId: user.id } : null;
  const friendsHook = useFriends(identity);
  const sendFriendRequest = useSendFriendRequest(identity);

  // Esc đóng panel (không có native <dialog> nên tự bắt keydown).
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative flex h-full w-full flex-col bg-white shadow-xl dark:bg-zinc-900 md:w-[380px]"
        role="dialog"
        aria-modal="true"
        aria-label="Bạn bè"
      >
        <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Đóng"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Bạn bè</h2>
        </header>

        {authLoading ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <SkeletonRows count={3} />
          </div>
        ) : !user ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-zinc-500">Đăng nhập để xem và quản lý bạn bè</p>
          </div>
        ) : (
          <>
            <div className="flex border-b border-zinc-200 px-4 dark:border-zinc-800">
              <TabButton
                active={tab === "friends"}
                onClick={() => setTab("friends")}
                label={`Bạn bè (${friendsHook.friends.length})`}
              />
              <TabButton
                active={tab === "requests"}
                onClick={() => setTab("requests")}
                label={`Lời mời (${friendRequests.incoming.length + friendRequests.outgoing.length})`}
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === "friends" ? (
                <FriendsTab
                  friendsHook={friendsHook}
                  sendFriendRequest={sendFriendRequest}
                  friendRequests={friendRequests}
                  onMessageFriend={onMessageFriend}
                />
              ) : (
                <RequestsTab friendRequests={friendRequests} />
              )}
            </div>
          </>
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

// ─── Friends Tab ────────────────────────────────────────────────────────────────

function FriendsTab({
  friendsHook,
  sendFriendRequest,
  friendRequests,
  onMessageFriend,
}: {
  friendsHook: ReturnType<typeof useFriends>;
  sendFriendRequest: ReturnType<typeof useSendFriendRequest>;
  friendRequests: UseFriendRequests;
  onMessageFriend: (friendId: string, friendUsername: string) => void;
}) {
  const { friends, loading, error, refetch, unfriend } = friendsHook;
  const [showAddForm, setShowAddForm] = useState(false);

  if (loading && friends.length === 0) {
    return (
      <div className="p-4">
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div>
        {showAddForm ? (
          <AddFriendForm
            sendFriendRequest={sendFriendRequest}
            onSent={(request) => {
              friendRequests.addOutgoing(request);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Thêm bạn
          </button>
        )}
      </div>

      {friends.length === 0 ? (
        <EmptyState
          icon="🧑‍🤝‍🧑"
          title="Chưa có bạn bè nào"
          subtitle="Thêm bạn bằng username để bắt đầu chat riêng"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {friends.map((f) => (
            <FriendRow
              key={f.requestId}
              friend={f}
              onUnfriendConfirm={unfriend}
              onMessage={onMessageFriend}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddFriendForm({
  sendFriendRequest,
  onSent,
  onCancel,
}: {
  sendFriendRequest: ReturnType<typeof useSendFriendRequest>;
  onSent: (request: FriendRequest) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { send, submitting } = sendFriendRequest;

  async function handleSubmit() {
    const trimmed = username.trim();
    if (!trimmed || submitting) return;
    setError(null);

    const { error: err, request } = await send(trimmed);
    if (err || !request) {
      setError(err ?? "Không thể gửi lời mời. Vui lòng thử lại.");
      return;
    }
    setUsername("");
    onSent(request);
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Nhập đúng username
        </p>
        <button
          onClick={onCancel}
          className="rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          aria-label="Đóng"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
          </svg>
        </button>
      </div>
      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="username"
          disabled={submitting}
          className="flex-1 rounded-full border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700"
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !username.trim()}
          className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Đang gửi…" : "Gửi lời mời"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">⚠ {error}</p>}
    </div>
  );
}

function FriendRow({
  friend,
  onUnfriendConfirm,
  onMessage,
}: {
  friend: Friend;
  onUnfriendConfirm: (requestId: string) => Promise<{ error: string | null }>;
  onMessage: (friendId: string, friendUsername: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [unfriending, setUnfriending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setUnfriending(true);
    setError(null);
    const { error: err } = await onUnfriendConfirm(friend.requestId);
    setUnfriending(false);
    if (err) {
      setError(err);
      return;
    }
    setConfirming(false);
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          @{friend.username}
        </span>
        {!confirming && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMessage(friend.id, friend.username)}
              className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Nhắn tin
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="rounded-full px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              aria-label="Tùy chọn"
            >
              ⋯
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">Hủy kết bạn với @{friend.username}?</p>
          {error && <p className="text-xs text-red-500">⚠ {error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={unfriending}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Hủy
            </button>
            <button
              onClick={handleConfirm}
              disabled={unfriending}
              className="rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              {unfriending ? "Đang xử lý…" : "Xác nhận hủy kết bạn"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Requests Tab ───────────────────────────────────────────────────────────────

function RequestsTab({ friendRequests }: { friendRequests: UseFriendRequests }) {
  const { incoming, outgoing, loading, error, refetch, accept, reject, cancel } =
    friendRequests;

  if (loading && incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="p-4">
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon="📭"
          title="Không có lời mời nào"
          subtitle="Lời mời gửi/nhận sẽ hiện ở đây theo thời gian thực"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {incoming.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-medium text-zinc-500">
            Lời mời nhận được ({incoming.length})
          </p>
          {incoming.map((r) => (
            <IncomingRequestRow key={r.id} request={r} onAccept={accept} onReject={reject} />
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-medium text-zinc-500">
            Đang chờ phản hồi ({outgoing.length})
          </p>
          {outgoing.map((r) => (
            <OutgoingRequestRow key={r.id} request={r} onCancel={cancel} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncomingRequestRow({
  request,
  onAccept,
  onReject,
}: {
  request: FriendRequest;
  onAccept: (id: string) => Promise<{ error: string | null }>;
  onReject: (id: string) => Promise<{ error: string | null }>;
}) {
  const [actionInFlight, setActionInFlight] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: "accept" | "reject") {
    setActionInFlight(action);
    setError(null);
    const { error: err } = await (action === "accept" ? onAccept(request.id) : onReject(request.id));
    setActionInFlight(null);
    if (err) setError(err);
  }

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          @{request.requesterUsername}
        </span>{" "}
        <span className="text-zinc-500">muốn kết bạn</span>
      </p>
      {error && <p className="mt-1 text-xs text-red-500">⚠ {error}</p>}
      <div className="mt-2 flex gap-2">
        {actionInFlight ? (
          <span className="text-xs text-zinc-500">⟳ Đang xử lý…</span>
        ) : (
          <>
            <button
              onClick={() => handle("accept")}
              className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Chấp nhận
            </button>
            <button
              onClick={() => handle("reject")}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Từ chối
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OutgoingRequestRow({
  request,
  onCancel,
}: {
  request: FriendRequest;
  onCancel: (id: string) => Promise<{ error: string | null }>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    const { error: err } = await onCancel(request.id);
    setCancelling(false);
    if (err) setError(err);
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div>
        <p className="text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            @{request.recipientUsername}
          </span>
        </p>
        <p className="text-xs text-zinc-500">Đang chờ…</p>
        {error && <p className="mt-1 text-xs text-red-500">⚠ {error}</p>}
      </div>
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {cancelling ? "Đang hủy…" : "Hủy lời mời"}
      </button>
    </div>
  );
}

// EmptyState/ErrorState/SkeletonRows: trích xuất sang src/components/ui/states.tsx
// (dùng chung với DmInbox/DmThread) — xem import ở đầu file.
