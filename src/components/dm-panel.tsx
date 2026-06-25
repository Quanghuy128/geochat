"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { useDmConversations } from "@/lib/use-dm-conversations";
import { useDmMessages } from "@/lib/use-dm-messages";
import { useDmMessageReactions } from "@/lib/use-dm-message-reactions";
import { createClient } from "@/lib/supabase/client";
import type { DmConversation } from "@/lib/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { MessageBubble } from "@/components/message-bubble";
import { MessageReactions } from "@/components/message-reactions";
import { MessageActionSheet } from "@/components/message-action-sheet";
import { ReactorListPopover } from "@/components/reactor-list-popover";
import { ReplyPreviewBar } from "@/components/reply-preview-bar";
import { QuotedMessagePreview } from "@/components/quoted-message-preview";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative timestamp inbox: hôm nay = HH:MM, hôm qua = "Hôm qua", cũ hơn = "N ngày". */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays <= 0) return formatTime(iso);
  if (diffDays === 1) return "Hôm qua";
  return `${diffDays} ngày`;
}

type View = "inbox" | "thread";

interface DmPanelProps {
  /** Set externally (Friends panel "Nhắn tin" trigger) — mở thread này ngay, bỏ qua inbox. */
  pendingOpenFriendId: string | null;
  /**
   * Username của peer kèm theo pendingOpenFriendId — truyền thẳng từ FriendsPanel (friend
   * row đã có sẵn `friend.username`) để set `activePeerUsername` ĐÚNG ngay từ đầu, không
   * cần tra trong `conversations` (snapshot có thể chưa có row mới trên 1 DM hoàn toàn mới
   * — review fix: trước đây tra trong conversations stale dẫn tới activePeerUsername="" và
   * không có cơ chế tự heal lại).
   */
  pendingOpenFriendUsername: string;
  /** Gọi sau khi đã xử lý xong pendingOpenFriendId — tránh re-trigger loop. */
  onConsumedPendingOpen: () => void;
}

/**
 * `DmPanel` — nội dung tab "Tin nhắn" trong ChatTabs. Chứa DmInbox + DmThread, chuyển
 * đổi qua state `view` nội bộ (KHÔNG phải route riêng — dm-chat-design.md mục 1).
 *
 * Unmount khi rời tab "Tin nhắn" theo quyết định kỹ thuật PLAN mục 5 (Open Design Q3):
 * đơn giản hóa cleanup channel, đánh đổi mất view/scroll state qua tab-switch.
 */
export function DmPanel({
  pendingOpenFriendId,
  pendingOpenFriendUsername,
  onConsumedPendingOpen,
}: DmPanelProps) {
  const { user } = useAuth();
  const identity = user ? { userId: user.id } : null;
  const conversationsHook = useDmConversations(identity);

  const [view, setView] = useState<View>("inbox");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activePeerUsername, setActivePeerUsername] = useState<string>("");
  const [openError, setOpenError] = useState<string | null>(null);

  const { findOrCreate } = conversationsHook;

  // Xử lý "Nhắn tin" trigger từ FriendsPanel: findOrCreate(peerId) → mở thread ngay.
  useEffect(() => {
    if (!pendingOpenFriendId) return;
    let cancelled = false;

    (async () => {
      setOpenError(null);
      const { conversationId, error } = await findOrCreate(pendingOpenFriendId);
      if (cancelled) return;
      if (error || !conversationId) {
        setOpenError(error ?? "Không thể mở cuộc trò chuyện.");
        onConsumedPendingOpen();
        return;
      }
      // Username peer: truyền trực tiếp từ FriendsPanel (friend row đã có sẵn) — KHÔNG tra
      // trong conversations (review fix: trên 1 DM hoàn toàn mới, row chưa có trong snapshot
      // → "" vĩnh viễn, không có effect nào re-sync sau đó).
      setActivePeerUsername(pendingOpenFriendUsername);
      setActiveConversationId(conversationId);
      setView("thread");
      onConsumedPendingOpen();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onConsumedPendingOpen/findOrCreate ổn định theo identity; pendingOpenFriendUsername đi kèm 1-1 với pendingOpenFriendId nên không cần liệt kê riêng.
  }, [pendingOpenFriendId]);

  function openConversation(conversation: DmConversation) {
    setOpenError(null);
    setActiveConversationId(conversation.id);
    setActivePeerUsername(conversation.peerUsername);
    setView("thread");
  }

  function backToInbox() {
    setView("inbox");
    setActiveConversationId(null);
    setOpenError(null);
  }

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-zinc-500">Đăng nhập để xem tin nhắn riêng của bạn</p>
      </div>
    );
  }

  if (view === "thread" && activeConversationId) {
    return (
      <DmThread
        conversationId={activeConversationId}
        peerUsername={activePeerUsername}
        identity={identity}
        onBack={backToInbox}
      />
    );
  }

  return (
    <DmInbox
      conversationsHook={conversationsHook}
      onOpenConversation={openConversation}
      openError={openError}
    />
  );
}

// ─── DM Inbox ───────────────────────────────────────────────────────────────────

function DmInbox({
  conversationsHook,
  onOpenConversation,
  openError,
}: {
  conversationsHook: ReturnType<typeof useDmConversations>;
  onOpenConversation: (conversation: DmConversation) => void;
  openError: string | null;
}) {
  const { conversations, loading, error, refetch } = conversationsHook;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">Tin nhắn riêng</h2>
        {openError && <p className="text-xs text-red-500">⚠ {openError}</p>}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && conversations.length === 0 ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon="💬"
            title="Chưa có cuộc trò chuyện nào"
            subtitle='Mở "Bạn bè" và chọn "Nhắn tin" với một người bạn để bắt đầu'
          />
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.map((c) => (
              <DmConversationRow key={c.id} conversation={c} onClick={() => onOpenConversation(c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DmConversationRow({
  conversation,
  onClick,
}: {
  conversation: DmConversation;
  onClick: () => void;
}) {
  const preview = conversation.lastMessageBody
    ? `${conversation.lastMessageMine ? "Bạn: " : ""}${conversation.lastMessageBody}`
    : "Chưa có tin nhắn nào";

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-zinc-200 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          @{conversation.peerUsername}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {formatRelative(conversation.lastMessageAt)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-zinc-500">{preview}</p>
    </button>
  );
}

// ─── DM Thread ──────────────────────────────────────────────────────────────────

function DmThread({
  conversationId,
  peerUsername,
  identity,
  onBack,
}: {
  conversationId: string;
  peerUsername: string;
  identity: { userId: string } | null;
  onBack: () => void;
}) {
  const { messages, loading, error, canSend, sendBlockedReason, send } = useDmMessages(
    conversationId,
    identity,
    peerUsername,
  );
  const messageIds = messages.map((m) => m.id);
  const {
    reactionsByMessageId,
    reactBlockedReason,
    react,
    unreact,
  } = useDmMessageReactions(conversationId, identity, messageIds);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<{
    messageId: string;
    senderLabel: string;
    bodyPreview: string;
  } | null>(null);
  const [actionSheetMessageId, setActionSheetMessageId] = useState<string | null>(null);
  const [reactorPopover, setReactorPopover] = useState<{ messageId: string; emoji: string } | null>(
    null,
  );
  const [reactorUsernames, setReactorUsernames] = useState<string[]>([]);
  const [reactorLoading, setReactorLoading] = useState(false);
  const [jumpToast, setJumpToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const reactDisabled = sendBlockedReason !== null || reactBlockedReason !== null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !canSend) return;
    setSendError(null);
    const previousDraft = draft;
    const previousReplyTarget = replyTarget;
    setDraft("");
    setReplyTarget(null);

    const { error: err } = await send(body, previousReplyTarget?.messageId ?? null);
    if (err) {
      // Edge case #11: không tạo state rác — restore draft, hiện lỗi inline, KHÔNG append
      // message giả (no optimistic insert, giống ChatPanel/useMessages). Reply target cũng
      // restore — người dùng không phải re-tap "Trả lời".
      setDraft(previousDraft);
      setReplyTarget(previousReplyTarget);
      setSendError(err);
    }
  }

  function handleReply(messageId: string) {
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const mine = target.senderId === identity?.userId;
    setReplyTarget({
      messageId: target.id,
      senderLabel: mine ? "Bạn" : `@${peerUsername}`,
      bodyPreview: target.body.length > 80 ? `${target.body.slice(0, 80)}…` : target.body,
    });
    setActionSheetMessageId(null);
  }

  async function handlePickEmoji(messageId: string, emoji: string) {
    setActionSheetMessageId(null);
    await react(messageId, emoji);
  }

  async function openReactorList(messageId: string, emoji: string) {
    setReactorPopover({ messageId, emoji });
    setReactorLoading(true);
    setReactorUsernames([]);
    const summaries = reactionsByMessageId.get(messageId) ?? [];
    const summary = summaries.find((s) => s.emoji === emoji);
    const userIds = summary?.reactorUserIds ?? [];
    if (userIds.length === 0) {
      setReactorLoading(false);
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setReactorLoading(false);
      return;
    }
    const { data } = await supabase.from("profiles").select("username").in("id", userIds);
    setReactorUsernames(((data as { username: string }[] | null) ?? []).map((p) => p.username));
    setReactorLoading(false);
  }

  function jumpToOriginal(messageId: string) {
    const el = messageRefs.current.get(messageId);
    if (!el) {
      setJumpToast("Không tìm thấy tin gốc trong lịch sử đã tải");
      setTimeout(() => setJumpToast(null), 2000);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
    setTimeout(() => setHighlightedId(null), 1000);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onBack}
          className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ‹ Tin nhắn
        </button>
        <h2 className="font-semibold">@{peerUsername}</h2>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {loading && messages.length === 0 ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => undefined} />
        ) : messages.length === 0 ? (
          <EmptyState icon="💬" title={`Hãy bắt đầu trò chuyện với @${peerUsername}`} />
        ) : (
          messages.map((m) => {
            const mine = m.senderId === identity?.userId;
            const reactions = reactionsByMessageId.get(m.id) ?? [];
            return (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(m.id, el);
                  else messageRefs.current.delete(m.id);
                }}
                className={`relative rounded-lg transition-colors ${
                  highlightedId === m.id ? "bg-yellow-100 dark:bg-yellow-900/30" : ""
                }`}
              >
                <MessageBubble
                  id={m.id}
                  body={m.body}
                  senderLabel={mine ? "Bạn" : `@${peerUsername}`}
                  timeLabel={formatTime(m.createdAt)}
                  mine={mine}
                  onLongPress={(id) => !reactDisabled && setActionSheetMessageId(id)}
                  quotedSlot={
                    m.replyPreview ? (
                      <QuotedMessagePreview
                        senderLabel={m.replyPreview.senderLabel}
                        bodyPreview={m.replyPreview.bodyPreview}
                        onJumpToOriginal={() => jumpToOriginal(m.replyPreview!.messageId)}
                        foundInView={messageIds.includes(m.replyPreview.messageId)}
                      />
                    ) : undefined
                  }
                  reactionsSlot={
                    <MessageReactions
                      reactions={reactions}
                      disabled={reactDisabled}
                      onToggleMine={() => unreact(m.id)}
                      onOpenReactorList={(emoji) => openReactorList(m.id, emoji)}
                      onOpenPicker={() => setActionSheetMessageId(m.id)}
                    />
                  }
                />
                <MessageActionSheet
                  open={actionSheetMessageId === m.id}
                  disabled={reactDisabled}
                  onPickEmoji={(emoji) => handlePickEmoji(m.id, emoji)}
                  onOpenFreeInput={() => undefined}
                  onReply={() => handleReply(m.id)}
                  onClose={() => setActionSheetMessageId(null)}
                />
                {reactorPopover?.messageId === m.id && (
                  <ReactorListPopover
                    open
                    emoji={reactorPopover.emoji}
                    usernames={reactorUsernames}
                    loading={reactorLoading}
                    onClose={() => setReactorPopover(null)}
                  />
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {jumpToast && (
        <p className="px-3 pb-1 text-xs text-zinc-500" role="status">
          {jumpToast}
        </p>
      )}

      {sendBlockedReason === "unfriended" && (
        <p className="border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
          ⓘ Bạn không còn là bạn bè với @{peerUsername} nên không thể gửi tin nhắn mới.
        </p>
      )}

      <ReplyPreviewBar replyTarget={replyTarget} onCancel={() => setReplyTarget(null)} />

      {sendError && <p className="px-3 pt-2 text-xs text-red-500">⚠ {sendError}</p>}

      <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={canSend ? "Nhập tin nhắn…" : "Đã hủy kết bạn — không thể gửi…"}
          disabled={!canSend}
          className="flex-1 rounded-full border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
