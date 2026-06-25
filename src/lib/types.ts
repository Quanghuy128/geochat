/** Tin nhắn chat. Khớp với bảng `messages` sẽ tạo trên Supabase. */
export type Message = {
  id: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string; // ISO
};

/** Vị trí realtime của một user, broadcast qua Supabase Presence. */
export type UserLocation = {
  userId: string;
  userName: string;
  lat: number;
  lng: number;
  updatedAt: string; // ISO
  /** true = đang trong presence state (live); false/undefined = vị trí cuối từ bảng (offline). */
  online?: boolean;
};

/** State machine của 1 row `friend_requests`. */
export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

/**
 * Row `friend_requests` đã join username 2 phía (qua `profiles`) — hook trả thẳng
 * dữ liệu UI cần, component không phải tự join.
 */
export type FriendRequest = {
  id: string;
  requesterId: string;
  requesterUsername: string;
  recipientId: string;
  recipientUsername: string;
  status: FriendRequestStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

/**
 * Một người bạn trong friends list.
 * `id`/`username` là của ĐỐI PHƯƠNG (không phải mình).
 * `requestId` là id row `friend_requests` gốc (status='accepted') — cần để gọi unfriend.
 */
export type Friend = {
  id: string;
  username: string;
  requestId: string;
};

/**
 * 1 cuộc trò chuyện 1-1 (DM) — hook `useDmConversations` đã join username đối phương
 * + tin nhắn cuối, component không phải tự join.
 */
export type DmConversation = {
  id: string;
  peerId: string;
  peerUsername: string;
  lastMessageBody: string | null;
  /** ISO — fallback = conversation.created_at nếu chưa có tin nào. */
  lastMessageAt: string;
  lastMessageMine: boolean;
};

/**
 * Trích dẫn gọn của tin nhắn gốc khi 1 tin nhắn khác reply tới nó — đã denormalize đủ để
 * render `QuotedMessagePreview` không cần round trip riêng (PLAN > Hooks modified mục
 * use-dm-messages.ts/use-group-messages.ts). `null` nếu tin gốc reply tới không tìm thấy
 * trong batch load hiện tại (ví dụ nằm ngoài `.limit(100)` — vẫn hiển thị link tới
 * `replyToMessageId`, nhưng `replyPreview` rỗng, UI tự xử lý "không tìm thấy").
 */
export type ReplyPreview = {
  messageId: string;
  senderLabel: string;
  bodyPreview: string;
};

/** 1 tin nhắn DM — row bảng `dm_messages`. */
export type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string; // ISO
  replyToMessageId: string | null;
  /** Denormalized — null nếu replyToMessageId null HOẶC tin gốc không có trong batch hiện tại. */
  replyPreview: ReplyPreview | null;
};

/**
 * 1 group chat — hook `useGroupConversations` đã join tin nhắn cuối + username người gửi
 * + đếm thành viên hiện tại (left_at is null), component không phải tự join.
 */
export type GroupConversation = {
  id: string;
  name: string;
  creatorId: string;
  lastMessageBody: string | null;
  /** ISO — fallback = group_conversations.created_at nếu chưa có tin nào. */
  lastMessageAt: string;
  lastMessageSenderUsername: string | null;
  lastMessageMine: boolean;
  memberCount: number;
};

/** 1 thành viên (hiện tại, left_at is null) của 1 group — đã join username. */
export type GroupMember = {
  id: string; // user id
  username: string;
  isCreator: boolean;
  joinedAt: string; // ISO
};

/** 1 tin nhắn group — đã join username người gửi (khác DM — group có >1 "theirs" sender). */
export type GroupMessage = {
  id: string;
  groupId: string;
  senderId: string;
  senderUsername: string;
  body: string;
  createdAt: string; // ISO
  replyToMessageId: string | null;
  /** Denormalized — null nếu replyToMessageId null HOẶC tin gốc không có trong batch hiện tại. */
  replyPreview: ReplyPreview | null;
};

/**
 * Tóm tắt reaction trên 1 tin nhắn, theo từng emoji — đủ data cho cả 2 mức hiển thị
 * (THINK #6): count mặc định + danh sách userId đã react (username resolve lazily ở
 * `ReactorListPopover`, KHÔNG pre-join ở đây — PLAN > Hooks mục "reactorUserIds").
 */
export type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactorUserIds: string[];
};
