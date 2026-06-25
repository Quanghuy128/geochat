/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-group-messages.ts — tập trung vào send() (no-op rỗng, RLS-rejection
 * reactive) + cancelled-flag race-safety (PHẢI có từ đầu, xem group-chat-STATE.md > PLAN
 * > Hooks > use-group-messages.ts, port trực tiếp pattern test từ use-dm-messages.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const GROUP_ID = "33333333-3333-3333-3333-333333333333";

function makeGroupMessagesFromMock(opts: {
  loadMessages?: { data: unknown; error?: unknown };
  profiles?: { data: unknown; error?: unknown };
  memberRow?: { left_at: string | null } | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const insertSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "group_messages") {
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
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => opts.profiles ?? { data: [], error: null }),
        })),
      };
    }
    if (table === "group_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.memberRow ?? null,
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
import { useGroupMessages } from "./use-group-messages";

describe("useGroupMessages", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("send(): empty/whitespace-only body is a no-op (no insert call)", async () => {
    const { from, insertSpy, channel, removeChannel } = makeGroupMessagesFromMock({
      memberRow: { left_at: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("   ");
    });

    expect(response!.error).toBeNull();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("send(): trims body before insert", async () => {
    const { from, insertSpy, channel, removeChannel } = makeGroupMessagesFromMock({
      memberRow: { left_at: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    await act(async () => {
      await result.current.send("  hello  ");
    });

    expect(insertSpy).toHaveBeenCalledWith({
      group_id: GROUP_ID,
      sender_id: ME_ID,
      body: "hello",
    });
  });

  it("membership hint: no active group_members row -> canSend=false, sendBlockedReason='removed' on mount", async () => {
    const { from, channel, removeChannel } = makeGroupMessagesFromMock({
      memberRow: null, // no row at all (or left)
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.canSend).toBe(false);
    });
    expect(result.current.sendBlockedReason).toBe("removed");
  });

  it("membership hint: active row (left_at null) -> canSend=true", async () => {
    const { from, channel, removeChannel } = makeGroupMessagesFromMock({
      memberRow: { left_at: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });
    expect(result.current.sendBlockedReason).toBeNull();
  });

  it("send(): RLS rejection sets sendBlockedReason='removed' reactively and returns an error", async () => {
    const { from, channel, removeChannel } = makeGroupMessagesFromMock({
      memberRow: { left_at: null }, // client hint says OK at mount...
      insertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.canSend).toBe(true);
    });

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.send("hello");
    });

    expect(response!.error).not.toBeNull();
    expect(result.current.canSend).toBe(false);
    expect(result.current.sendBlockedReason).toBe("removed");
  });

  it("returns empty/safe state when groupId is null", async () => {
    const { from, channel, removeChannel } = makeGroupMessagesFromMock({});
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(null, { userId: ME_ID }));

    expect(result.current.messages).toEqual([]);
  });

  it("each loaded message includes joined senderUsername", async () => {
    const { from, channel, removeChannel } = makeGroupMessagesFromMock({
      loadMessages: {
        data: [
          {
            id: "msg-1",
            group_id: GROUP_ID,
            sender_id: OTHER_ID,
            body: "hi",
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      },
      profiles: { data: [{ id: OTHER_ID, username: "bob_tran" }], error: null },
      memberRow: { left_at: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessages(GROUP_ID, { userId: ME_ID }));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0].senderUsername).toBe("bob_tran");
  });

  it("regression-class test (cancelled-flag from day one, U14): switching groupId quickly does not let a stale slower load() overwrite the newer thread's state", async () => {
    const GROUP_X = "44444444-4444-4444-4444-444444444444";
    const GROUP_Y = "55555555-5555-5555-5555-555555555555";

    // X's group_messages select resolves SLOWLY (after Y has already started+finished),
    // simulating the race: user opens X then quickly switches to Y before X's load()
    // settles. X's stale resolution arriving late must NOT overwrite Y's state.
    let resolveXMessages!: (v: { data: unknown; error: null }) => void;
    const xMessagesPromise = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveXMessages = resolve;
    });

    const yMessages = [
      {
        id: "y-msg-1",
        group_id: GROUP_Y,
        sender_id: OTHER_ID,
        body: "from Y",
        created_at: new Date().toISOString(),
      },
    ];

    const from = vi.fn((table: string) => {
      if (table === "group_messages") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, value: string) => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => {
                  if (value === GROUP_X) return xMessagesPromise;
                  return { data: yMessages, error: null };
                }),
              })),
            })),
          })),
          insert: vi.fn(),
        };
      }
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [{ id: OTHER_ID, username: "bob_tran" }], error: null })),
          })),
        };
      }
      if (table === "group_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { left_at: null }, error: null })),
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
      ({ groupId }: { groupId: string }) => useGroupMessages(groupId, { userId: ME_ID }),
      { initialProps: { groupId: GROUP_X } },
    );

    // Switch to Y BEFORE X's load() resolves.
    rerender({ groupId: GROUP_Y });

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
