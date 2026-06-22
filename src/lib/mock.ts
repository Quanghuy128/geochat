import type { Message, UserLocation } from "./types";

/** Dữ liệu giả cho giai đoạn chưa có key Supabase/Maps. */

export const MOCK_MESSAGES: Message[] = [
  {
    id: "1",
    userId: "u1",
    userName: "An",
    body: "Chào mọi người 👋",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: "2",
    userId: "u2",
    userName: "Bình",
    body: "Mình đang ở quận 1 nè",
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
  },
  {
    id: "3",
    userId: "u1",
    userName: "An",
    body: "Thấy vị trí của bạn trên map rồi 🗺️",
    createdAt: new Date(Date.now() - 1000 * 60).toISOString(),
  },
];

export const MOCK_LOCATIONS: UserLocation[] = [
  {
    userId: "u1",
    userName: "An",
    lat: 10.7769,
    lng: 106.7009,
    updatedAt: new Date().toISOString(),
  },
  {
    userId: "u2",
    userName: "Bình",
    lat: 10.7805,
    lng: 106.699,
    updatedAt: new Date().toISOString(),
  },
];
