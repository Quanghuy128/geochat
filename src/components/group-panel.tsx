"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { useFriends } from "@/lib/use-friends";
import { useGroupConversations } from "@/lib/use-group-conversations";
import { useGroupMessages } from "@/lib/use-group-messages";
import { useGroupMembers } from "@/lib/use-group-members";
import type { GroupConversation } from "@/lib/types";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { FriendMultiSelect } from "@/components/friend-multi-select";

const MAX_GROUP_MEMBERS = 50;

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

type View = "inbox" | "create" | "thread" | "members";

/**
 * `GroupPanel` — nội dung tab "Nhóm" trong ChatTabs. Chứa GroupInbox + CreateGroupForm +
 * GroupThread + GroupMemberList, chuyển đổi qua state `view` nội bộ (KHÔNG phải route
 * riêng — group-chat-design.md mục 1/4).
 *
 * Không có external props (không pending-open trigger, khác DmPanel) — group creation
 * chỉ có entry point nội bộ trong tab này (group-chat-design.md mục 4 > ChatTabs note).
 *
 * Unmount khi rời tab "Nhóm" theo cùng quyết định kỹ thuật PLAN đã áp dụng cho DmPanel —
 * đơn giản hóa cleanup 3 Realtime channel (group-conversations/group-thread/group-members).
 */
export function GroupPanel() {
  const { user } = useAuth();
  const identity = user ? { userId: user.id } : null;
  const groupsHook = useGroupConversations(identity);
  const friendsHook = useFriends(identity);

  const [view, setView] = useState<View>("inbox");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroupName, setActiveGroupName] = useState<string>("");

  function openGroup(group: GroupConversation) {
    setActiveGroupId(group.id);
    setActiveGroupName(group.name);
    setView("thread");
  }

  function backToInbox() {
    setView("inbox");
    setActiveGroupId(null);
  }

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-zinc-500">Đăng nhập để xem nhóm của bạn</p>
      </div>
    );
  }

  if (view === "create") {
    return (
      <CreateGroupForm
        friends={friendsHook.friends}
        createGroup={groupsHook.createGroup}
        onCreated={(groupId, name) => {
          setActiveGroupId(groupId);
          setActiveGroupName(name);
          setView("thread");
        }}
        onCancel={backToInbox}
      />
    );
  }

  if (view === "thread" && activeGroupId) {
    return (
      <GroupThread
        groupId={activeGroupId}
        groupName={activeGroupName}
        identity={identity}
        onBack={backToInbox}
        onOpenMembers={() => setView("members")}
      />
    );
  }

  if (view === "members" && activeGroupId) {
    return (
      <GroupMemberList
        groupId={activeGroupId}
        groupName={activeGroupName}
        friends={friendsHook.friends}
        identity={identity}
        onBack={() => setView("thread")}
        onLeft={backToInbox}
      />
    );
  }

  return (
    <GroupInbox
      groupsHook={groupsHook}
      onOpenGroup={openGroup}
      onCreateGroup={() => setView("create")}
    />
  );
}

// ─── Group Inbox ────────────────────────────────────────────────────────────────

function GroupInbox({
  groupsHook,
  onOpenGroup,
  onCreateGroup,
}: {
  groupsHook: ReturnType<typeof useGroupConversations>;
  onOpenGroup: (group: GroupConversation) => void;
  onCreateGroup: () => void;
}) {
  const { groups, loading, error, refetch } = groupsHook;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">Nhóm của bạn</h2>
        <button
          onClick={onCreateGroup}
          className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          + Tạo nhóm
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && groups.length === 0 ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Chưa có nhóm nào"
            subtitle="Tạo nhóm để chat cùng nhiều người bạn cùng lúc"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <GroupConversationRow key={g.id} group={g} onClick={() => onOpenGroup(g)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupConversationRow({
  group,
  onClick,
}: {
  group: GroupConversation;
  onClick: () => void;
}) {
  const preview = group.lastMessageBody
    ? `${
        group.lastMessageMine
          ? "Bạn: "
          : group.lastMessageSenderUsername
            ? `@${group.lastMessageSenderUsername}: `
            : ""
      }${group.lastMessageBody}`
    : "Chưa có tin nhắn nào";

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-zinc-200 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {group.name}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {formatRelative(group.lastMessageAt)}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-zinc-500">{preview}</p>
    </button>
  );
}

// ─── Create Group Form ──────────────────────────────────────────────────────────

function CreateGroupForm({
  friends,
  createGroup,
  onCreated,
  onCancel,
}: {
  friends: { id: string; username: string }[];
  createGroup: ReturnType<typeof useGroupConversations>["createGroup"];
  onCreated: (groupId: string, name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nameError, setNameError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(friendId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    let hasError = false;
    if (!trimmed) {
      setNameError("Vui lòng nhập tên nhóm");
      hasError = true;
    } else {
      setNameError(null);
    }
    if (selectedIds.size === 0) {
      setMemberError("Vui lòng chọn ít nhất 1 thành viên");
      hasError = true;
    } else {
      setMemberError(null);
    }
    if (hasError || submitting) return;

    setSubmitting(true);
    setServerError(null);
    const { groupId, error } = await createGroup(trimmed, Array.from(selectedIds));
    setSubmitting(false);

    if (error || !groupId) {
      setServerError(error ?? "Không thể tạo nhóm.");
      return;
    }
    onCreated(groupId, trimmed);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          ‹ Hủy
        </button>
        <h2 className="font-semibold">Tạo nhóm mới</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Tên nhóm
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nhập tên nhóm…"
            disabled={submitting}
            maxLength={100}
            className="w-full rounded-full border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700"
          />
          {nameError && <p className="mt-1 text-xs text-red-500">⚠ {nameError}</p>}
        </div>

        <div className="mb-2">
          <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Chọn thành viên (từ bạn bè)
          </p>
          {friends.length === 0 ? (
            <EmptyState
              icon="👥"
              title="Bạn cần có ít nhất 1 bạn bè để tạo nhóm"
            />
          ) : (
            <FriendMultiSelect
              friends={friends}
              selectedIds={selectedIds}
              onToggle={toggle}
              maxSelectable={MAX_GROUP_MEMBERS}
              disabledReason={`Đã đạt giới hạn ${MAX_GROUP_MEMBERS} thành viên`}
            />
          )}
          {memberError && <p className="mt-1 text-xs text-red-500">⚠ {memberError}</p>}
          <p className="mt-1 text-xs text-zinc-400">
            Đã chọn: {selectedIds.size} / {MAX_GROUP_MEMBERS}
          </p>
        </div>

        {serverError && <p className="mt-2 text-xs text-red-500">⚠ {serverError}</p>}
      </div>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Đang tạo nhóm…" : "Tạo nhóm"}
        </button>
      </div>
    </div>
  );
}

// ─── Group Thread ───────────────────────────────────────────────────────────────

function GroupThread({
  groupId,
  groupName,
  identity,
  onBack,
  onOpenMembers,
}: {
  groupId: string;
  groupName: string;
  identity: { userId: string } | null;
  onBack: () => void;
  onOpenMembers: () => void;
}) {
  const { messages, loading, error, canSend, sendBlockedReason, send } = useGroupMessages(
    groupId,
    identity,
  );
  // Shared hook (PLAN: 1 hook duy nhất cho cả pill count và full member management) —
  // GroupThread chỉ cần `members.length` cho pill, KHÔNG cần `isCreator` ở đây (GroupMemberList
  // mới cần). Vẫn subscribe đủ Realtime để pill count update live khi add/remove xảy ra
  // trong khi user đang ở Thread (Interaction Notes mục 5).
  const { members } = useGroupMembers(groupId, identity);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !canSend) return;
    setSendError(null);
    const previousDraft = draft;
    setDraft("");

    const { error: err } = await send(body);
    if (err) {
      setDraft(previousDraft);
      setSendError(err);
    }
  }

  const showMemberPill = sendBlockedReason === null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onBack}
          className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ‹ Nhóm
        </button>
        <h2 className="flex-1 truncate font-semibold">{groupName}</h2>
        {showMemberPill && (
          <button
            onClick={onOpenMembers}
            className="shrink-0 rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {members.length} thành viên
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {loading && messages.length === 0 ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => undefined} />
        ) : messages.length === 0 ? (
          <EmptyState icon="💬" title="Hãy bắt đầu trò chuyện trong nhóm" />
        ) : (
          messages.map((m) => {
            const mine = m.senderId === identity?.userId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div className="text-xs text-zinc-500">
                  {mine ? "Bạn" : `@${m.senderUsername}`} · {formatTime(m.createdAt)}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {sendBlockedReason === "removed" && (
        <p className="border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
          ⓘ Bạn không còn là thành viên nhóm này nên không thể gửi tin nhắn mới.
        </p>
      )}

      {sendError && <p className="px-3 pt-2 text-xs text-red-500">⚠ {sendError}</p>}

      <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={canSend ? "Nhập tin nhắn…" : "Không còn là thành viên…"}
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

// ─── Group Member List ──────────────────────────────────────────────────────────

function GroupMemberList({
  groupId,
  groupName,
  friends,
  identity,
  onBack,
  onLeft,
}: {
  groupId: string;
  groupName: string;
  friends: { id: string; username: string }[];
  identity: { userId: string } | null;
  onBack: () => void;
  onLeft: () => void;
}) {
  const { members, loading, error, isCreator, refetch, addMembers, removeMember, leaveGroup } =
    useGroupMembers(groupId, identity);

  const [view, setView] = useState<"list" | "addMember">("list");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);

  if (view === "addMember") {
    return (
      <AddMemberPicker
        groupName={groupName}
        friends={friends}
        existingMemberIds={members.map((m) => m.id)}
        addMembers={addMembers}
        remainingSlots={MAX_GROUP_MEMBERS - members.length}
        onAdded={() => setView("list")}
        onCancel={() => setView("list")}
      />
    );
  }

  async function handleRemove(userId: string) {
    setActionInFlight(true);
    setActionError(null);
    const { error: err } = await removeMember(userId);
    setActionInFlight(false);
    if (err) {
      setActionError(err);
      return;
    }
    setConfirmingRemoveId(null);
  }

  async function handleLeave() {
    setActionInFlight(true);
    setActionError(null);
    const { error: err } = await leaveGroup();
    setActionInFlight(false);
    if (err) {
      setActionError(err);
      return;
    }
    onLeft();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onBack}
          className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ‹ {groupName}
        </button>
        <h2 className="font-semibold">Thành viên ({members.length})</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && members.length === 0 ? (
          <SkeletonRows count={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isViewerCreator={isCreator}
                isSelf={m.id === identity?.userId}
                confirming={confirmingRemoveId === m.id}
                actionInFlight={actionInFlight}
                actionError={confirmingRemoveId === m.id ? actionError : null}
                onRequestRemove={() => {
                  setConfirmingRemoveId(m.id);
                  setActionError(null);
                }}
                onCancelRemove={() => setConfirmingRemoveId(null)}
                onConfirmRemove={() => handleRemove(m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {isCreator && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <button
            onClick={() => setView("addMember")}
            className="w-full rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Thêm thành viên
          </button>
        </div>
      )}

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {!confirmingLeave ? (
          <button
            onClick={() => {
              setConfirmingLeave(true);
              setActionError(null);
            }}
            className="w-full rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Rời nhóm
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">Rời khỏi nhóm &quot;{groupName}&quot;?</p>
            {actionError && <p className="text-xs text-red-500">⚠ {actionError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingLeave(false)}
                disabled={actionInFlight}
                className="flex-1 rounded-full border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Hủy
              </button>
              <button
                onClick={handleLeave}
                disabled={actionInFlight}
                className="flex-1 rounded-full bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {actionInFlight ? "Đang xử lý…" : "Xác nhận rời"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isViewerCreator,
  isSelf,
  confirming,
  actionInFlight,
  actionError,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  member: { id: string; username: string; isCreator: boolean };
  isViewerCreator: boolean;
  isSelf: boolean;
  confirming: boolean;
  actionInFlight: boolean;
  actionError: string | null;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  // Creator-only control, ẨN HOÀN TOÀN (không chỉ disable) cho non-creator, và không hiện
  // trên row của chính creator (creator không tự xóa mình qua nút này — dùng "Rời nhóm").
  const canShowRemove = isViewerCreator && !member.isCreator && !isSelf;

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          @{member.username} {member.isCreator && <span className="text-zinc-400">(Người tạo)</span>}
        </span>
        {canShowRemove && !confirming && (
          <button
            onClick={onRequestRemove}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Xóa
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">Xóa @{member.username} khỏi nhóm?</p>
          {actionError && <p className="text-xs text-red-500">⚠ {actionError}</p>}
          <div className="flex gap-2">
            <button
              onClick={onCancelRemove}
              disabled={actionInFlight}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Hủy
            </button>
            <button
              onClick={onConfirmRemove}
              disabled={actionInFlight}
              className="rounded-full bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              {actionInFlight ? "Đang xử lý…" : "Xác nhận xóa"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddMemberPicker({
  groupName,
  friends,
  existingMemberIds,
  addMembers,
  remainingSlots,
  onAdded,
  onCancel,
}: {
  groupName: string;
  friends: { id: string; username: string }[];
  existingMemberIds: string[];
  addMembers: (userIds: string[]) => Promise<{ error: string | null }>;
  remainingSlots: number;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const existing = new Set(existingMemberIds);
  const candidates = friends.filter((f) => !existing.has(f.id));

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(friendId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await addMembers(Array.from(selectedIds));
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onAdded();
  }

  const atLimit = remainingSlots <= 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          ‹ Thành viên
        </button>
        <h2 className="font-semibold">Thêm thành viên</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {atLimit && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            ⚠ Nhóm &quot;{groupName}&quot; đã đạt giới hạn {MAX_GROUP_MEMBERS} thành viên, không thể thêm nữa.
          </p>
        )}
        {candidates.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Không còn bạn bè nào để thêm"
            subtitle="Tất cả bạn bè của bạn đã ở trong nhóm này."
          />
        ) : (
          <>
            <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Chọn từ bạn bè chưa có trong nhóm
            </p>
            <FriendMultiSelect
              friends={candidates}
              selectedIds={selectedIds}
              onToggle={toggle}
              maxSelectable={atLimit ? 0 : Math.min(remainingSlots, candidates.length)}
              disabledReason={`Đã đạt giới hạn ${MAX_GROUP_MEMBERS} thành viên`}
            />
            <p className="mt-1 text-xs text-zinc-400">
              Đã chọn: {selectedIds.size} · Còn lại: {Math.max(remainingSlots - selectedIds.size, 0)} chỗ
            </p>
          </>
        )}
        {error && <p className="mt-2 text-xs text-red-500">⚠ {error}</p>}
      </div>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <button
          onClick={handleSubmit}
          disabled={submitting || selectedIds.size === 0 || atLimit}
          className="w-full rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Đang thêm…" : "Thêm"}
        </button>
      </div>
    </div>
  );
}
