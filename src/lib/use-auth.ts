"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

export type UseAuth = {
  /** User đã đăng nhập, null nếu chưa / Supabase chưa cấu hình. */
  user: User | null;
  /** true khi đang xác định trạng thái auth ban đầu. */
  loading: boolean;
  /** true khi Supabase đã cấu hình env. */
  configured: boolean;
  signOut: () => Promise<void>;
};

/**
 * Hook lấy user hiện tại từ Supabase Auth.
 * - getUser() lúc mount.
 * - onAuthStateChange để cập nhật khi đăng nhập/đăng xuất.
 * An toàn khi chưa cấu hình env: configured=false, user=null, loading=false.
 */
export function useAuth(): UseAuth {
  // Khởi tạo client một lần (lazy) — tránh tạo lại mỗi render.
  const [supabase] = useState(() => createClient());
  const configured = supabase !== null;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  return { user, loading, configured, signOut };
}
