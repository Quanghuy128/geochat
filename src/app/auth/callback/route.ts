import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Route handler nhận magic link callback.
 * Chịu cả hai dạng template Supabase:
 * - PKCE code flow: `?code=` → exchangeCodeForSession(code).
 * - Token hash flow (dạng cũ): `?token_hash=&type=` → verifyOtp({ type, token_hash }).
 * Thành công → redirect về `/` (hoặc `next` nếu có).
 * Thiếu cả hai → `/?auth_error=missing_code`. Lỗi exchange/verify → `/?auth_error=...`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      return NextResponse.redirect(
        `${origin}/?auth_error=${encodeURIComponent(error.message)}`,
      );
    }
  } else if (tokenHash && type) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      return NextResponse.redirect(
        `${origin}/?auth_error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  // Thiếu code lẫn token_hash, hoặc Supabase chưa cấu hình → về trang chủ kèm cờ lỗi.
  return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
}
