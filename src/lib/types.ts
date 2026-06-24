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

/** 1 tin nhắn DM — row bảng `dm_messages`. */
export type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string; // ISO
};
