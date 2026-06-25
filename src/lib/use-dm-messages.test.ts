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
      reply_to_message_id: null,
    });
  });

  it("send(): passes replyToMessageId through to the insert payload", async () => {
    const REPLY_TARGET_ID = "66666666-6666-6666-6666-666666666666";
    const { from, insertSpy, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(CONVERSATION_ID, { userId: ME_ID }));

    await act(async () => {
      await result.current.send("ok chốt giờ đó nha", REPLY_TARGET_ID);
    });

    expect(insertSpy).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      sender_id: ME_ID,
      body: "ok chốt giờ đó nha",
      reply_to_message_id: REPLY_TARGET_ID,
    });
  });

  it("send(): edge case #6 reply-scope trigger error does NOT set sendBlockedReason (not an unfriend signal)", async () => {
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
      insertError: {
        code: "P0001",
        message: "dm_messages: reply_to_message_id phai thuoc cung conversation_id (edge case #6)",
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(CONVERSATION_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("hello", "cross-conversation-message-id");
    });

    expect(response!.error).not.toBeNull();
    // Stays unblocked — this is a reply-scope violation, NOT an unfriend signal.
    expect(result.current.canSend).toBe(true);
    expect(result.current.sendBlockedReason).toBeNull();
  });

  it("send(): detects reply-scope violation via err.code === 'P0001', NOT by matching exception text (post-review fix #3 regression)", async () => {
    // Same SQLSTATE the DB trigger actually raises, but with a DIFFERENT/changed exception
    // message text (no literal "edge case #6" substring) — proves detection no longer
    // depends on brittle substring-matching against the trigger's exact wording.
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
      insertError: {
        code: "P0001",
        message: "dm_messages: some reworded exception text, no special substring here",
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(CONVERSATION_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("hello", "cross-conversation-message-id");
    });

    expect(response!.error).not.toBeNull();
    expect(result.current.canSend).toBe(true);
    expect(result.current.sendBlockedReason).toBeNull();
  });

  it("send(): RLS denial (err.code === '42501') still sets sendBlockedReason even if message text happens to mention 'edge case #6' (post-review fix #3 regression)", async () => {
    // Adversarial: an RLS-denial error whose message TEXT coincidentally contains the old
    // substring trigger ("edge case #6") must NOT be misclassified as a reply-scope
    // violation anymore — only err.code matters now.
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
      insertError: {
        code: "42501",
        message: "new row violates row-level security policy (edge case #6)",
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(CONVERSATION_ID, { userId: ME_ID }));

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

  it("load(): denormalizes replyPreview for messages whose reply target is in the same batch", async () => {
    const ORIGINAL_ID = "77777777-7777-7777-7777-777777777777";
    const REPLY_ID = "88888888-8888-8888-8888-888888888888";
    const { from, channel, removeChannel } = makeDmMessagesFromMock({
      loadMessages: {
        data: [
          {
            id: ORIGINAL_ID,
            conversation_id: CONVERSATION_ID,
            sender_id: PEER_ID,
            body: "Hẹn 7h tối nay nhé",
            created_at: new Date(Date.now() - 1000).toISOString(),
            reply_to_message_id: null,
          },
          {
            id: REPLY_ID,
            conversation_id: CONVERSATION_ID,
            sender_id: ME_ID,
            body: "Ok chốt giờ đó nha",
            created_at: new Date().toISOString(),
            reply_to_message_id: ORIGINAL_ID,
          },
        ],
        error: null,
      },
      conversationRow: { user_a_id: ME_ID, user_b_id: PEER_ID },
      friendshipRow: { id: "fr-1" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmMessages(CONVERSATION_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    const reply = result.current.messages.find((m) => m.id === REPLY_ID)!;
    expect(reply.replyToMessageId).toBe(ORIGINAL_ID);
    expect(reply.replyPreview).not.toBeNull();
    expect(reply.replyPreview!.bodyPreview).toBe("Hẹn 7h tối nay nhé");
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
