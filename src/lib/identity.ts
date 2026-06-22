"use client";

import { useEffect, useState } from "react";

const NAMES = ["An", "Bình", "Cường", "Dung", "Hà", "Khoa", "Linh", "Minh"];

/**
 * Danh tính tạm cho giai đoạn chưa có auth.
 * Lưu trong localStorage để cùng một tab/trình duyệt giữ nguyên user qua các lần load.
 */
export function useIdentity(): { userId: string; userName: string } {
  const [identity, setIdentity] = useState({
    userId: "",
    userName: "",
  });

  useEffect(() => {
    const KEY = "geochat-identity";
    const stored = localStorage.getItem(KEY);
    if (stored) {
      setIdentity(JSON.parse(stored));
      return;
    }
    const fresh = {
      userId: crypto.randomUUID(),
      userName: NAMES[Math.floor(Math.random() * NAMES.length)],
    };
    localStorage.setItem(KEY, JSON.stringify(fresh));
    setIdentity(fresh);
  }, []);

  return identity;
}
