"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { ReactionSummary } from "./types";

/** Row dạng snake_case từ Postgres (bảng `dm_message_reactions`). */
type DmMessageReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ReactBlockedReason = "unfriended" | null;

export type UseDmMessageReactions = {
  /** key = message_id, value = mảng ReactionSummary (1 phần tử/emoji distinct trên tin đó). */
  reactionsByMessageId: Map<string, ReactionSummary[]>;
  ready: boolean;
  loading: boolean;
  error: string | null;
  reactBlockedReason: ReactBlockedReason;
  /** Upsert on conflict (message_id, user_id) — THINK #3 "re-react = replace", không phải insert thêm row. */
  react: (messageId: string, emoji: string) => Promise<{ error: string | null }>;
  /** Delete own row — 0-row match là no-op hợp lệ (edge case #4), không phải lỗi. */
  unreact: (messageId: string) => Promise<{ error: string | null }>;
};

/**
 * Quản lý reaction cho 1 DM thread — load bulk theo `messageIds` đang hiển thị (KHÔNG
 * per-message query, PLAN > Trade-offs mục 2) + Realtime + react/unreact.
 *
 * - Bulk load: select * from dm_message_reactions where message_id in (...messageIds).
 * - react(): optimistic local update trước (PLAN > Data flow > React flow — ngoại lệ DUY
 *   NHẤT trong feature này cho optimistic UI, không áp dụng cho gửi tin nhắn) → upsert →
 *   nếu lỗi (RLS reject, edge case #1 unfriended), revert optimistic + set reactBlockedReason.
 * - unreact(): optimistic remove → delete where message_id=X and user_id=me. 0 row affected
 *   vẫn là thành công (edge case #4 no-op).
 * - Realtime: subscribe `dm-reactions-{conversationId}` — channel RIÊNG biệt với
 *   `dm-thread-{conversationId}` (PLAN > Subscribe channels — tránh nhồi payload không liên
 *   quan vào 1 channel) — INSERT/UPDATE/DELETE patch trực tiếp map cục bộ, KHÔNG re-fetch.
 * - cancelled-flag race-safety pattern TỪ ĐẦU (giống use-dm-messages.ts/use-group-messages.ts).
 *
 * Null-safe: Supabase chưa cấu hình hoặc identity/conversationId null → ready=false/rỗng.
 */
export function useDmMessageReactions(
  conversationId: string | null,
  identity: { userId: string } | null,
  messageIds: string[],
): UseDmMessageReactions {
  const [reactionsByMessageId, setReactionsByMessageId] = useState<Map<string, ReactionSummary[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactBlockedReason, setReactBlockedReason] = useState<ReactBlockedReason>(null);

  const [supabase] = useState(() => createClient());
  const ready = supabase !== null;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  // messageIds đổi liên tục khi load thêm tin nhắn mới — giữ ref để load() đọc snapshot
  // mới nhất mà KHÔNG cần liệt kê toàn bộ array trong dependency của effect (tránh
  // re-subscribe/refetch trên MỌI tin nhắn mới — chỉ refetch khi messageIds rỗng→có lần đầu
  // hoặc conversationId đổi; tin mới riêng lẻ tự không có reaction nên không cần refetch).
  const messageIdsRef = useRef(messageIds);
  useEffect(() => {
    messageIdsRef.current = messageIds;
  }, [messageIds]);

  const buildSummaries = useCallback(
    (rows: DmMessageReactionRow[]): Map<string, ReactionSummary[]> => {
      const me = identityRef.current?.userId;
      const byMessage = new Map<string, Map<string, ReactionSummary>>();
      for (const r of rows) {
        let byEmoji = byMessage.get(r.message_id);
        if (!byEmoji) {
          byEmoji = new Map();
          byMessage.set(r.message_id, byEmoji);
        }
        const existing = byEmoji.get(r.emoji);
        if (existing) {
          existing.count += 1;
          existing.reactorUserIds.push(r.user_id);
          if (r.user_id === me) existing.reactedByMe = true;
        } else {
          byEmoji.set(r.emoji, {
            emoji: r.emoji,
            count: 1,
            reactedByMe: r.user_id === me,
            reactorUserIds: [r.user_id],
          });
        }
      }
      const result = new Map<string, ReactionSummary[]>();
      for (const [messageId, byEmoji] of byMessage) {
        result.set(messageId, Array.from(byEmoji.values()));
      }
      return result;
    },
    [],
  );

  const load = useCallback(async (isCancelled: () => boolean) => {
    const currentConversationId = conversationIdRef.current;
    const ids = messageIdsRef.current;
    if (!supabase || !currentConversationId || ids.length === 0) {
      if (isCancelled()) return;
      setReactionsByMessageId(new Map());
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("dm_message_reactions")
      .select("*")
      .in("message_id", ids);

    if (isCancelled()) return;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setReactionsByMessageId(buildSummaries((data as DmMessageReactionRow[] | null) ?? []));
    setLoading(false);
  }, [supabase, buildSummaries]);

  // Load lại khi conversationId đổi HOẶC khi messageIds đi từ rỗng -> có lần đầu (mở thread,
  // tin nhắn vừa load xong). Không liệt kê messageIds đầy đủ trong deps (xem ref comment trên)
  // — dùng .length === 0 -> >0 transition như 1 proxy đơn giản, đủ cho mục đích bulk-load 1 lần.
  const hasMessages = messageIds.length > 0;
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      await load(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId, hasMessages, load]);

  // Realtime — channel RIÊNG `dm-reactions-{conversationId}`, KHÔNG chung với
  // `dm-thread-{conversationId}` (PLAN > Subscribe channels).
  useEffect(() => {
    if (!supabase || !conversationId) return;

    let cancelled = false;

    function patchInsertOrUpdate(row: DmMessageReactionRow) {
      setReactionsByMessageId((prev) => {
        const next = new Map(prev);
        const me = identityRef.current?.userId;
        // Rebuild summaries CHỈ cho message_id bị ảnh hưởng — đơn giản nhất là gộp lại từ
        // list hiện có + patch theo (message_id, user_id) unique constraint (THINK #3: 1
        // reaction/user/message, nên UPDATE/INSERT luôn nghĩa là "user này giờ có đúng 1 emoji").
        const current = next.get(row.message_id) ?? [];
        // Xóa reaction CŨ của đúng user này (nếu có, ở emoji khác — re-react replace).
        const withoutUser = current
          .map((s) => ({
            ...s,
            reactorUserIds: s.reactorUserIds.filter((id) => id !== row.user_id),
          }))
          .map((s) => ({ ...s, count: s.reactorUserIds.length, reactedByMe: s.reactorUserIds.includes(me ?? "") }))
          .filter((s) => s.count > 0);

        const existingForEmoji = withoutUser.find((s) => s.emoji === row.emoji);
        let updated: ReactionSummary[];
        if (existingForEmoji) {
          updated = withoutUser.map((s) =>
            s.emoji === row.emoji
              ? {
                  ...s,
                  count: s.count + 1,
                  reactorUserIds: [...s.reactorUserIds, row.user_id],
                  reactedByMe: s.reactedByMe || row.user_id === me,
                }
              : s,
          );
        } else {
          updated = [
            ...withoutUser,
            {
              emoji: row.emoji,
              count: 1,
              reactedByMe: row.user_id === me,
              reactorUserIds: [row.user_id],
            },
          ];
        }
        next.set(row.message_id, updated);
        return next;
      });
    }

    function patchDelete(row: DmMessageReactionRow) {
      setReactionsByMessageId((prev) => {
        const current = prev.get(row.message_id);
        if (!current) return prev;
        const next = new Map(prev);
        const updated = current
          .map((s) =>
            s.emoji === row.emoji
              ? {
                  ...s,
                  count: s.count - (s.reactorUserIds.includes(row.user_id) ? 1 : 0),
                  reactorUserIds: s.reactorUserIds.filter((id) => id !== row.user_id),
                  reactedByMe: s.reactorUserIds.filter((id) => id !== row.user_id).includes(
                    identityRef.current?.userId ?? "",
                  ),
                }
              : s,
          )
          .filter((s) => s.count > 0);
        next.set(row.message_id, updated);
        return next;
      });
    }

    const channel = supabase
      .channel(`dm-reactions-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchInsertOrUpdate(payload.new as DmMessageReactionRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dm_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchInsertOrUpdate(payload.new as DmMessageReactionRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "dm_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchDelete(payload.old as DmMessageReactionRow);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId]);

  const react = useCallback(
    async (messageId: string, emoji: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { error: "Bạn cần đăng nhập." };
      const trimmedEmoji = emoji.trim();
      if (!trimmedEmoji) return { error: null };

      // Optimistic: snapshot trước để revert nếu lỗi.
      let previousSnapshot: Map<string, ReactionSummary[]> | null = null;
      setReactionsByMessageId((prev) => {
        previousSnapshot = prev;
        const next = new Map(prev);
        const current = next.get(messageId) ?? [];
        const withoutUser = current
          .map((s) => ({
            ...s,
            reactorUserIds: s.reactorUserIds.filter((id) => id !== userId),
          }))
          .map((s) => ({ ...s, count: s.reactorUserIds.length, reactedByMe: false }))
          .filter((s) => s.count > 0);
        const existingForEmoji = withoutUser.find((s) => s.emoji === trimmedEmoji);
        const updated = existingForEmoji
          ? withoutUser.map((s) =>
              s.emoji === trimmedEmoji
                ? {
                    ...s,
                    count: s.count + 1,
                    reactorUserIds: [...s.reactorUserIds, userId],
                    reactedByMe: true,
                  }
                : s,
            )
          : [
              ...withoutUser,
              { emoji: trimmedEmoji, count: 1, reactedByMe: true, reactorUserIds: [userId] },
            ];
        next.set(messageId, updated);
        return next;
      });

      const { error: err } = await supabase
        .from("dm_message_reactions")
        .upsert(
          { message_id: messageId, user_id: userId, emoji: trimmedEmoji },
          { onConflict: "message_id,user_id" },
        );

      if (err) {
        // Revert optimistic update — RLS reject (edge case #1: unfriended tại thời điểm react).
        if (previousSnapshot) setReactionsByMessageId(previousSnapshot);
        setReactBlockedReason("unfriended");
        return { error: "Không thể thêm reaction. Có thể bạn không còn là bạn bè." };
      }

      return { error: null };
    },
    [supabase],
  );

  const unreact = useCallback(
    async (messageId: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { error: "Bạn cần đăng nhập." };

      let previousSnapshot: Map<string, ReactionSummary[]> | null = null;
      setReactionsByMessageId((prev) => {
        previousSnapshot = prev;
        const current = prev.get(messageId);
        if (!current) return prev;
        const next = new Map(prev);
        const updated = current
          .map((s) => ({
            ...s,
            count: s.count - (s.reactorUserIds.includes(userId) ? 1 : 0),
            reactorUserIds: s.reactorUserIds.filter((id) => id !== userId),
            reactedByMe: false,
          }))
          .filter((s) => s.count > 0);
        next.set(messageId, updated);
        return next;
      });

      // 0-row match là thành công bình thường (edge case #4) — không có error riêng cho case này.
      const { error: err } = await supabase
        .from("dm_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId);

      if (err) {
        if (previousSnapshot) setReactionsByMessageId(previousSnapshot);
        return { error: "Không thể gỡ reaction." };
      }

      return { error: null };
    },
    [supabase],
  );

  return { reactionsByMessageId, ready, loading, error, reactBlockedReason, react, unreact };
}
