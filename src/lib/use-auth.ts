"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import { validateUsername, buildFakeEmail } from "./username-utils";

export type UseAuth = {
  /** User đã đăng nhập, null nếu chưa / Supabase chưa cấu hình. */
  user: User | null;
  /** Username hiển thị, null nếu chưa đăng nhập hoặc user cũ (magic link). */
  username: string | null;
  /** true khi đang xác định trạng thái auth ban đầu. */
  loading: boolean;
  /** true khi Supabase đã cấu hình env. */
  configured: boolean;
  signOut: () => Promise<void>;
  /**
   * Đăng ký tài khoản mới bằng username + password.
   * @returns `{ error: null }` khi thành công, `{ error: string }` khi lỗi.
   */
  signUp: (username: string, password: string) => Promise<{ error: string | null }>;
  /**
   * Đăng nhập bằng username + password.
   * @returns `{ error: null }` khi thành công, `{ error: string }` khi lỗi.
   */
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
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

  async function signUp(username: string, password: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: "Supabase chưa cấu hình." };

    // Validate username phía client trước khi gọi API
    const validationError = validateUsername(username);
    if (validationError) return { error: validationError };

    const email = buildFakeEmail(username);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });

    if (error) {
      // Map "User already registered" → thông báo thân thiện
      if (
        error.message.includes("User already registered") ||
        error.message.includes("already registered")
      ) {
        return { error: "Username đã tồn tại." };
      }
      // Network/DB error: thông báo khác, không nhầm với duplicate
      return { error: "Không thể đăng ký. Vui lòng thử lại." };
    }

    // Nếu Email Confirmation đang BẬT, session = null dù không có error.
    if (!data.session) {
      return { error: "Đăng ký thất bại: vui lòng liên hệ admin tắt Email Confirmation trong Supabase Dashboard." };
    }

    return { error: null };
  }

  async function signIn(username: string, password: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: "Supabase chưa cấu hình." };

    // Không validate username ở đây để tránh tiết lộ thông tin
    const email = buildFakeEmail(username);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Luôn dùng message chung chung — không tiết lộ username tồn tại hay không
      return { error: "Thông tin đăng nhập không đúng." };
    }

    return { error: null };
  }

  // username lấy từ JWT metadata (nhanh, không cần query thêm)
  // user cũ (magic link) sẽ có username = null — component tự xử lý fallback
  const username = (user?.user_metadata?.username as string | undefined) ?? null;

  return { user, username, loading, configured, signOut, signUp, signIn };
}
