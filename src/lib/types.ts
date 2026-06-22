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
};
