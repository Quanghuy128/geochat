"use client";

import { useCallback, useState } from "react";
import { createClient } from "./supabase/client";
import { validateUsername } from "./username-utils";
import type { FriendRequest } from "./types";

export type UseSendFriendRequest = {
  /**
   * Gửi friend request tới username. Trả lỗi (tiếng Việt, sẵn sàng hiển thị) hoặc null nếu OK.
   * Khi OK, `request` là row vừa insert (đã join username 2 phía) — dùng để cập nhật ngay
   * UI của người gửi (KHÔNG chờ Realtime, xem friends-STATE.md > PLAN > mục 3 "Send request" bước 5).
   */
  send: (username: string) => Promise<{ error: string | null; request: FriendRequest | null }>;
  submitting: boolean;
};

/**
 * Gửi friend request bằng username (không phải user id — user không nhớ UUID).
 *
 * Flow (xem friends-STATE.md > PLAN > mục 3 "Send request"):
 * 1. validateUsername() — chặn format sai trước khi gọi DB (edge case #12).
 * 2. Lookup `profiles` theo username → 0 row: lỗi "không tìm thấy" (edge case #2).
 * 3. So id lookup được với auth.uid() → chặn tự gửi cho mình (edge case #1).
 * 4. Query riêng kiểm tra đã có row status='accepted' giữa 2 user chưa → lỗi "đã là bạn"
 *    (edge case #3 — DB INSERT luôn tạo status='pending' nên KHÔNG tự chặn được case này,
 *    phải tự kiểm tra ở application layer).
 * 5. Insert friend_requests {requester_id: auth.uid(), recipient_id, status:'pending'}.
 *    Vi phạm partial unique index pending (đã có pending bất kỳ chiều) → Postgres 23505
 *    → map sang "đã có lời mời đang chờ" (edge case #4/#5).
 */
export function useSendFriendRequest(
  identity: { userId: string } | null,
): UseSendFriendRequest {
  const [supabase] = useState(() => createClient());
  const [submitting, setSubmitting] = useState(false);

  const send = useCallback(
    async (
      rawUsername: string,
    ): Promise<{ error: string | null; request: FriendRequest | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình.", request: null };
      if (!identity?.userId)
        return { error: "Bạn cần đăng nhập để gửi lời mời.", request: null };

      const username = rawUsername.trim();
      const validationError = validateUsername(username);
      if (validationError) return { error: validationError, request: null };

      setSubmitting(true);
      try {
        const { data: profile, error: lookupErr } = await supabase
          .from("profiles")
          .select("id, username")
          .ilike("username", username)
          .maybeSingle();

        if (lookupErr) {
          return { error: "Không thể tìm username. Vui lòng thử lại.", request: null };
        }
        if (!profile) {
          return { error: `Không tìm thấy username "${username}"`, request: null };
        }

        const recipientId = profile.id as string;

        if (recipientId === identity.userId) {
          return { error: "Không thể tự gửi lời mời cho chính mình", request: null };
        }

        // Kiểm tra đã là bạn chưa (DB không tự chặn ở bước INSERT vì insert luôn pending).
        const { data: existingFriendship, error: friendCheckErr } = await supabase
          .from("friend_requests")
          .select("id")
          .eq("status", "accepted")
          .or(
            `and(requester_id.eq.${identity.userId},recipient_id.eq.${recipientId}),and(requester_id.eq.${recipientId},recipient_id.eq.${identity.userId})`,
          )
          .maybeSingle();

        if (friendCheckErr) {
          return {
            error: "Không thể kiểm tra quan hệ bạn bè. Vui lòng thử lại.",
            request: null,
          };
        }
        if (existingFriendship) {
          return { error: `@${profile.username} đã là bạn của bạn`, request: null };
        }

        const { data: inserted, error: insertErr } = await supabase
          .from("friend_requests")
          .insert({
            requester_id: identity.userId,
            recipient_id: recipientId,
            status: "pending",
          })
          .select()
          .single();

        if (insertErr) {
          // 23505 = unique_violation -- đã có 1 row pending giữa 2 người (bất kỳ chiều nào).
          if (insertErr.code === "23505") {
            return {
              error: `Đã có lời mời đang chờ giữa bạn và @${profile.username}`,
              request: null,
            };
          }
          return { error: "Không thể gửi lời mời. Vui lòng thử lại.", request: null };
        }

        // Map sang FriendRequest (camelCase, đã join username) — khớp shape `outgoing` của
        // use-friend-requests.ts để AddFriendForm cập nhật ngay UI người gửi, không chờ Realtime.
        const request: FriendRequest = {
          id: inserted.id as string,
          requesterId: inserted.requester_id as string,
          requesterUsername: "", // người gửi chính là mình — không cần hiển thị username của mình
          recipientId: inserted.recipient_id as string,
          recipientUsername: profile.username as string,
          status: inserted.status as FriendRequest["status"],
          createdAt: inserted.created_at as string,
          updatedAt: inserted.updated_at as string,
        };

        return { error: null, request };
      } finally {
        setSubmitting(false);
      }
    },
    [supabase, identity?.userId],
  );

  return { send, submitting };
}
