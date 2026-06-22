import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase browser client cho Client Components.
 * Đọc key từ env public. Trả về null nếu chưa cấu hình key
 * → UI có thể chạy ở chế độ mock mà không crash (chưa có key giai đoạn đầu).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createBrowserClient(url, anonKey);
}

/** True khi đã cấu hình đủ key Supabase. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
