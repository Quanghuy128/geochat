import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase server client cho Server Components / Route Handlers.
 * Đọc/ghi cookie session qua next/headers cookies() (Next 16: cookies() là async).
 * Trả về null nếu chưa cấu hình env → caller xử lý fallback, app không crash.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll được gọi từ Server Component (cookie read-only).
          // An toàn bỏ qua khi đã có middleware refresh session.
        }
      },
    },
  });
}
