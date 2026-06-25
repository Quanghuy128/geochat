"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { ReactionSummary } from "./types";

/** Row dạng snake_case từ Postgres (bảng `group_message_reactions`). */
type GroupMessageReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ReactBlockedReason = "removed" | null;

export type UseGroupMessageReactions = {
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
 * Quản lý reaction cho 1 group thread — cùng cấu trúc với `useDmMessageReactions` (PLAN:
 * 2 hook riêng, KHÔNG unify — chỉ boilerplate giống nhau, semantics RLS khác: active
 * membership thay vì friend status). Xem use-dm-message-reactions.ts cho giải thích đầy đủ
 * từng đoạn — comment ở đây chỉ note phần khác biệt.
 *
 * - Realtime: subscribe `group-reactions-{groupId}` — channel RIÊNG với `group-thread-{groupId}`.
 * - react() lỗi (RLS reject) → reactBlockedReason="removed" (không còn active member — edge case #1).
 * - cancelled-flag race-safety pattern TỪ ĐẦU.
 */
export function useGroupMessageReactions(
  groupId: string | null,
  identity: { userId: string } | null,
  messageIds: string[],
): UseGroupMessageReactions {
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
  const groupIdRef = useRef(groupId);
  useEffect(() => {
    groupIdRef.current = groupId;
  }, [groupId]);
  const messageIdsRef = useRef(messageIds);
  useEffect(() => {
    messageIdsRef.current = messageIds;
  }, [messageIds]);

  const buildSummaries = useCallback(
    (rows: GroupMessageReactionRow[]): Map<string, ReactionSummary[]> => {
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
    const currentGroupId = groupIdRef.current;
    const ids = messageIdsRef.current;
    if (!supabase || !currentGroupId || ids.length === 0) {
      if (isCancelled()) return;
      setReactionsByMessageId(new Map());
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("group_message_reactions")
      .select("*")
      .in("message_id", ids);

    if (isCancelled()) return;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setReactionsByMessageId(buildSummaries((data as GroupMessageReactionRow[] | null) ?? []));
    setLoading(false);
  }, [supabase, buildSummaries]);

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
  }, [supabase, groupId, hasMessages, load]);

  useEffect(() => {
    if (!supabase || !groupId) return;

    let cancelled = false;

    function patchInsertOrUpdate(row: GroupMessageReactionRow) {
      setReactionsByMessageId((prev) => {
        const next = new Map(prev);
        const me = identityRef.current?.userId;
        const current = next.get(row.message_id) ?? [];
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

    function patchDelete(row: GroupMessageReactionRow) {
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
      .channel(`group-reactions-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchInsertOrUpdate(payload.new as GroupMessageReactionRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchInsertOrUpdate(payload.new as GroupMessageReactionRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "group_message_reactions" },
        (payload) => {
          if (cancelled) return;
          patchDelete(payload.old as GroupMessageReactionRow);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, groupId]);

  const react = useCallback(
    async (messageId: string, emoji: string): Promise<{ error: string | null }> => {
      if (!supabase) return { error: "Supabase chưa cấu hình." };
      const userId = identityRef.current?.userId;
      if (!userId) return { error: "Bạn cần đăng nhập." };
      const trimmedEmoji = emoji.trim();
      if (!trimmedEmoji) return { error: null };

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
        .from("group_message_reactions")
        .upsert(
          { message_id: messageId, user_id: userId, emoji: trimmedEmoji },
          { onConflict: "message_id,user_id" },
        );

      if (err) {
        // Revert optimistic update — RLS reject (edge case #1: đã rời/bị xóa tại thời điểm react).
        if (previousSnapshot) setReactionsByMessageId(previousSnapshot);
        setReactBlockedReason("removed");
        return { error: "Không thể thêm reaction. Có thể bạn không còn là thành viên nhóm." };
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

      const { error: err } = await supabase
        .from("group_message_reactions")
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
