"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "./supabase/client";
import type { Message } from "./types";

/** Row dạng snake_case từ Postgres → map sang Message (camelCase). */
type MessageRow = {
  id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
};

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    body: r.body,
    createdAt: r.created_at,
  };
}

export type UseMessages = {
  messages: Message[];
  /** null = Supabase chưa cấu hình (chế độ mock). */
  ready: boolean;
  error: string | null;
  send: (body: string) => Promise<void>;
};

/**
 * Quản lý chat realtime qua Supabase:
 * - Load tin cũ (sắp xếp theo thời gian).
 * - Subscribe INSERT realtime → append tin mới.
 * - send(): insert vào bảng messages; tin của mình về qua realtime nên KHÔNG tự append (tránh trùng).
 *
 * userId/userName: danh tính tạm cho giai đoạn chưa có auth.
 */
export function useMessages(identity: {
  userId: string;
  userName: string;
}): UseMessages {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Lazy-init: createClient() chỉ chạy 1 lần. KHÔNG đọc .current khi render
  // (vi phạm react-hooks/refs) — `ready` được set trong effect bên dưới.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) supabaseRef.current = createClient();

  useEffect(() => {
    const supabase = supabaseRef.current;
    setReady(supabase !== null);
    if (!supabase) return;

    let cancelled = false;

    // Load tin cũ
    supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        setMessages((data as MessageRow[]).map(rowToMessage));
      });

    // Subscribe realtime INSERT
    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (cancelled) return;
          const incoming = rowToMessage(payload.new as MessageRow);
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const send = useCallback(
    async (body: string) => {
      const supabase = supabaseRef.current;
      const trimmed = body.trim();
      if (!supabase || !trimmed) return;

      const { error: err } = await supabase.from("messages").insert({
        user_id: identity.userId,
        user_name: identity.userName,
        body: trimmed,
      });
      if (err) setError(err.message);
    },
    [identity.userId, identity.userName],
  );

  return { messages, ready, error, send };
}
