"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/use-auth";

/**
 * Panel đăng nhập email magic link.
 * - Chưa đăng nhập: input email + nút "Gửi magic link" (signInWithOtp).
 * - Đã đăng nhập: hiện email + nút Đăng xuất (signOut).
 * - Chưa cấu hình Supabase: hiện ghi chú nhẹ, không crash.
 */
export function AuthPanel() {
  const { user, loading, configured, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!configured) {
    return (
      <p className="text-xs text-zinc-500">Auth chưa nối Supabase (mock)</p>
    );
  }

  if (loading) {
    return <p className="text-xs text-zinc-500">Đang tải…</p>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-600 dark:text-zinc-300">
          {user.email}
        </span>
        <button
          onClick={() => signOut()}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Đăng xuất
        </button>
      </div>
    );
  }

  async function handleSend() {
    const trimmed = email.trim();
    if (!trimmed) return;

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase chưa cấu hình.");
      return;
    }

    setSending(true);
    setError(null);
    setSent(false);

    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="email@example.com"
          disabled={sending}
          className="rounded-full border border-zinc-300 bg-transparent px-3 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50 dark:border-zinc-700"
        />
        <button
          onClick={handleSend}
          disabled={sending || !email.trim()}
          className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? "Đang gửi…" : "Gửi magic link"}
        </button>
      </div>
      {sent && (
        <p className="text-xs text-green-600">
          Đã gửi link đăng nhập tới email. Kiểm tra hộp thư.
        </p>
      )}
      {error && <p className="text-xs text-red-500">Lỗi: {error}</p>}
    </div>
  );
}
