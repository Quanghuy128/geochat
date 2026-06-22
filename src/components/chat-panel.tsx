"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/identity";
import { useMessages } from "@/lib/use-messages";
import type { Message } from "@/lib/types";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Panel chat realtime qua Supabase.
 * `fallback`: dùng khi Supabase chưa cấu hình key (chế độ mock, gửi tin chỉ local).
 */
export function ChatPanel({ fallback }: { fallback: Message[] }) {
  const identity = useIdentity();
  const { messages, ready, error, send } = useMessages(identity);
  const [draft, setDraft] = useState("");
  const [mockMessages, setMockMessages] = useState<Message[]>(fallback);
  const bottomRef = useRef<HTMLDivElement>(null);

  const list = ready ? messages : mockMessages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [list.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");

    if (ready) {
      await send(body);
    } else {
      // chế độ mock: append local
      setMockMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          userId: identity.userId || "me",
          userName: identity.userName || "Bạn",
          body,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }

  return (
    <div className="flex h-full flex-col border-r border-zinc-200 dark:border-zinc-800">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="font-semibold">Chat</h2>
        <p className="text-xs text-zinc-500">
          {ready
            ? `Realtime (Supabase) · bạn là ${identity.userName || "…"}`
            : "Mock — chưa nối Supabase"}
        </p>
        {error && <p className="text-xs text-red-500">Lỗi: {error}</p>}
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {list.map((m) => {
          const mine = m.userId === identity.userId;
          return (
            <div
              key={m.id}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <div className="text-xs text-zinc-500">
                {m.userName} · {formatTime(m.createdAt)}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Nhập tin nhắn…"
          className="flex-1 rounded-full border border-zinc-300 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
        />
        <button
          onClick={handleSend}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
