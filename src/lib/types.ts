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
