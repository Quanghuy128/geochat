"use client";

import { useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { AuthModal } from "@/components/auth-modal";

/**
 * Header auth area: nút "Đăng nhập" khi chưa login, @username + "Đăng xuất" khi đã login.
 * Quản lý trạng thái modal nội bộ.
 */
export function HeaderAuth() {
  const { user, username, loading, configured, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  // Loading: render null để tránh SSR flash
  if (loading) {
    return <div className="h-8 w-24 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />;
  }

  if (!configured) {
    return (
      <p className="text-xs text-zinc-500">Auth chưa nối Supabase (mock)</p>
    );
  }

  if (user) {
    // Logged in: hiển thị @username (hoặc email nếu user cũ không có username)
    const displayName = username
      ? `@${username}`
      : user.email?.split("@")[0]
        ? `@${user.email!.split("@")[0]}`
        : "User";

    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {displayName}
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Đăng nhập
      </button>
      <AuthModal open={open} onOpenChange={setOpen} />
    </>
  );
}
