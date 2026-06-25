/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-group-message-reactions.ts — mirror cấu trúc test
 * use-dm-message-reactions.test.ts (PLAN: 2 hook riêng nhưng cấu trúc tương tự nhau).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const GROUP_ID = "33333333-3333-3333-3333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-4444-444444444444";

function makeReactionsFromMock(opts: {
  selectInResult?: { data: unknown; error?: unknown };
  upsertError?: { code?: string; message: string } | null;
  deleteError?: { code?: string; message: string } | null;
}) {
  const selectInSpy = vi.fn();
  const upsertSpy = vi.fn();
  const deleteSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "group_message_reactions") {
      return {
        select: vi.fn(() => ({
          in: vi.fn((...args: unknown[]) => {
            selectInSpy(...args);
            return Promise.resolve(opts.selectInResult ?? { data: [], error: null });
          }),
        })),
        upsert: vi.fn((payload: unknown) => {
          upsertSpy(payload);
          return Promise.resolve({ data: null, error: opts.upsertError ?? null });
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => {
              deleteSpy();
              return Promise.resolve({ data: null, error: opts.deleteError ?? null });
            }),
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

  return { from, selectInSpy, upsertSpy, deleteSpy, channel, removeChannel };
}

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { useGroupMessageReactions } from "./use-group-message-reactions";

describe("useGroupMessageReactions", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("bulk-loads reactions for ALL messageIds in ONE query (not per-message)", async () => {
    const { from, selectInSpy, channel, removeChannel } = makeReactionsFromMock({
      selectInResult: {
        data: [
          { id: "r1", message_id: MESSAGE_ID, user_id: OTHER_ID, emoji: "👍", created_at: "" },
        ],
        error: null,
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useGroupMessageReactions(GROUP_ID, { userId: ME_ID }, [MESSAGE_ID, "other-msg"]),
    );

    await waitFor(() => {
      expect(result.current.reactionsByMessageId.get(MESSAGE_ID)).toHaveLength(1);
    });

    expect(selectInSpy).toHaveBeenCalledTimes(1);
    expect(selectInSpy).toHaveBeenCalledWith("message_id", [MESSAGE_ID, "other-msg"]);

    const summary = result.current.reactionsByMessageId.get(MESSAGE_ID)![0];
    expect(summary.emoji).toBe("👍");
    expect(summary.count).toBe(1);
    expect(summary.reactedByMe).toBe(false);
  });

  it("react(): upserts on conflict (message_id, user_id) — replace semantics", async () => {
    const { from, upsertSpy, channel, removeChannel } = makeReactionsFromMock({});
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useGroupMessageReactions(GROUP_ID, { userId: ME_ID }, [MESSAGE_ID]),
    );

    await act(async () => {
      await result.current.react(MESSAGE_ID, "😍");
    });

    expect(upsertSpy).toHaveBeenCalledWith({
      message_id: MESSAGE_ID,
      user_id: ME_ID,
      emoji: "😍",
    });
  });

  it("react(): RLS rejection reverts optimistic state and sets reactBlockedReason='removed'", async () => {
    const { from, channel, removeChannel } = makeReactionsFromMock({
      upsertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useGroupMessageReactions(GROUP_ID, { userId: ME_ID }, [MESSAGE_ID]),
    );

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.react(MESSAGE_ID, "👍");
    });

    expect(response!.error).not.toBeNull();
    expect(result.current.reactBlockedReason).toBe("removed");
    expect(result.current.reactionsByMessageId.get(MESSAGE_ID) ?? []).toHaveLength(0);
  });

  it("unreact(): deleting a non-existent reaction (0 rows matched) is a no-op success", async () => {
    const { from, deleteSpy, channel, removeChannel } = makeReactionsFromMock({
      deleteError: null,
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() =>
      useGroupMessageReactions(GROUP_ID, { userId: ME_ID }, [MESSAGE_ID]),
    );

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.unreact(MESSAGE_ID);
    });

    expect(response!.error).toBeNull();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("returns empty map when groupId is null", () => {
    const { from, channel, removeChannel } = makeReactionsFromMock({});
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMessageReactions(null, { userId: ME_ID }, []));

    expect(result.current.reactionsByMessageId.size).toBe(0);
  });
});
