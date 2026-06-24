import { NextResponse } from "next/server";

/**
 * Magic link callback — không còn dùng kể từ khi chuyển sang username + password auth.
 * Giữ lại để tránh 404 nếu có link magic link cũ còn được click.
 * Redirect về trang chủ.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(origin);
}
