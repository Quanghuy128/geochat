/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-dm-messages.ts — tập trung vào send() (edge case #4 empty/whitespace,
 * edge case #11 RLS-rejection → sendBlockedReason reactive), theo dm-chat-testplan.md
 * > mục 1.2. KHÔNG test Realtime filter string ở đây (cần test E2E thật — xem PLAN
 * mục 5b risk note); chỉ verify hook không crash khi mock .channel()/.on()/.subscribe().
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const PEER_ID = "22222222-2222-2222-2222-222222222222";
const CONVERSATION_ID = "33333333-3333-3333-3333-333333333333";

function makeDmMessagesFromMock(opts: {
  loadMessages?: { data: unknown; error?: unknown };
  conversationRow?: { user_a_id: string; user_b_id: string } | null;
  friendshipRow?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const insertSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "dm_messages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => opts.loadMessages ?? { data: [], error: null }),
            })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return Promise.resolve({
            data: opts.insertError ? null : [{ id: "new-msg" }],
            error: opts.insertError ?? null,
          });
        }),
      };
    }
    if (table === "conversations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: opts.conversationRow ?? null,
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "friend_requests") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            or: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.friendshipRow ?? null,
                error: null,
              })),
            })),
          })),
        })),
      };
    }
    throw new Error(`Unexpected table in test mock: ${table}`);
  });

  const channel = vi.fn(() => {
    const chain = {
      on: vi.fn(() => chain),
      subscribe: vi.fn(() => chain),
    };
    return chain;
  });
  const removeChannel = vi.fn();

  return { from, insertSpy, channel, removeChannel };
}

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { useDmMessages } from "./use-dm-messages";

describe("useDmMessages", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("send(): empty/whitespace-only body is a no-op (no insert call)", async () => {
    const { from, insertSpy, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useDmMessages(CONVERSATION_ID, { userId: ME_ID }),
    );

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("   ");
    });

    expect(response!.error).toBeNull();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("send(): trims body before insert", async () => {
    const { from, insertSpy, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useDmMessages(CONVERSATION_ID, { userId: ME_ID }),
    );

    await act(async () => {
      await result.current.send("  hello  ");
    });

    expect(insertSpy).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      sender_id: ME_ID,
      body: "hello",
    });
  });

  it("canSend/sendBlockedReason: no accepted friend_requests row -> canSend=false, sendBlockedReason='unfriended' on mount", async () => {
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: null, // not friends (e.g. unfriended)
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useDmMessages(CONVERSATION_ID, { userId: ME_ID }),
    );

    await waitFor(() => {
      expect(result.current.canSend).toBe(false);
    });
    expect(result.current.sendBlockedReason).toBe("unfriended");
  });

  it("send(): RLS rejection sets sendBlockedReason='unfriended' reactively and returns an error", async () => {
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" }, // client hint says OK at mount...
      insertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useDmMessages(CONVERSATION_ID, { userId: ME_ID }),
    );

    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("hello");
    });

    expect(response!.error).not.toBeNull();
    expect(result.current.canSend).toBe(false);
    expect(result.current.sendBlockedReason).toBe("unfriended");
  });

  it("returns ready=false-safe empty state when conversationId is null", async () => {
    const { from, channel, removeChannel } = makeDmMessagesFromMock({});
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(null, { userId: ME_ID }));

    expect(result.current.messages).toEqual([]);
  });

  it("regression: switching conversationId quickly does not let a stale slower load() overwrite the newer thread's state", async () => {
    const CONVERSATION_X = "44444444-4444-4444-4444-444444444444";
    const CONVERSATION_Y = "55555555-5555-5555-5555-555555555555";

    // X's dm_messages select resolves SLOWLY (after Y has already started+finished),
    // simulating the race: user opens X then quickly switches to Y before X's load()
    // settles. X's stale resolution arriving late must NOT overwrite Y's state.
    let resolveXMessages!: (v: { data: unknown; error: null }) => void;
    const xMessagesPromise = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveXMessages = resolve;
    });

    const yMessages = [
      {
        id: "y-msg-1",
        conversation_id: CONVERSATION_Y,
        sender_id: PEER_ID,
        body: "from Y",
        created_at: new Date().toISOString(),
      },
    ];

    const from = vi.fn((table: string) => {
      if (table === "dm_messages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, value: string) => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => {
                  if (value === CONVERSATION_X) return xMessagesPromise;
                  return { data: yMessages, error: null };
                }),
              })),
            })),
          })),
          insert: vi.fn(),
        };
      }
      if (table === "conversations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { user_a_id: ME_ID, user_b_id: PEER_ID },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "friend_requests") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: "fr-1" }, error: null })),
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    });

    const channel = vi.fn(() => {
      const chain = {
        on: vi.fn(() => chain),
        subscribe: vi.fn(() => chain),
      };
      return chain;
    });
    const removeChannel = vi.fn();

    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useDmMessages(conversationId, { userId: ME_ID }),
      { initialProps: { conversationId: CONVERSATION_X } },
    );

    // Switch to Y BEFORE X's load() resolves.
    rerender({ conversationId: CONVERSATION_Y });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("y-msg-1");
    });

    // Now let X's stale load() resolve late — must be a no-op (cancelled), not overwrite Y.
    resolveXMessages({ data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe("y-msg-1");
  });
});
