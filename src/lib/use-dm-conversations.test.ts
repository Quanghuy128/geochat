/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-dm-conversations.ts — tập trung vào findOrCreate() (logic rủi ro
 * cao nhất: race 23505 + RLS-rejection mapping), theo dm-chat-testplan.md > mục 1.1.
 * Runner: Vitest (renderHook từ @testing-library/react — cần env jsdom riêng cho file
 * này, giống use-send-friend-request.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const PEER_ID = "22222222-2222-2222-2222-222222222222";

/**
 * Builder mock cho .from("conversations") — đủ cho findOrCreate()'s select().or().limit()
 * .maybeSingle() và insert().select().single(). Cũng mock .channel()/.removeChannel()
 * (no-op) vì hook subscribe Realtime ngay khi mount — KHÔNG test Realtime ở đây
 * (xem PLAN risk note — Realtime cần test E2E thật, không phải unit mock).
 */
function makeConversationsFromMock(handlers: {
  selectSequence: Array<{ data: unknown; error?: unknown }>;
  insert?: { data: unknown; error: unknown };
}) {
  let selectCallIndex = 0;
  const insertSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "conversations") {
      return {
        select: vi.fn(() => ({
          // .or() resolves either as a direct thenable (used by load()'s inbox fetch:
          // select("*").or(...) — no .limit()/.maybeSingle() chained) OR as a chain with
          // .limit().maybeSingle() (used by findOrCreate()'s existence check). Support both.
          or: vi.fn(() => ({
            // Direct await — load()'s inbox fetch path. Empty list (not under test here).
            then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
              Promise.resolve({ data: [], error: null }).then(resolve),
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                const result = handlers.selectSequence[selectCallIndex] ?? { data: null };
                selectCallIndex += 1;
                return result;
              }),
            })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => handlers.insert ?? { data: null, error: null }),
            })),
          };
        }),
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
import { useDmConversations } from "./use-dm-conversations";

describe("useDmConversations.findOrCreate", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("no existing conversation: SELECT no match, then INSERT, returns new id", async () => {
    const NEW_ID = "33333333-3333-3333-3333-333333333333";
    const { from, insertSpy, channel, removeChannel } = makeConversationsFromMock({
      selectSequence: [{ data: null }],
      insert: { data: { id: NEW_ID }, error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmConversations({ userId: ME_ID }));

    let response: { conversationId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.findOrCreate(PEER_ID);
    });

    expect(response!.conversationId).toBe(NEW_ID);
    expect(response!.error).toBeNull();
    expect(insertSpy).toHaveBeenCalledWith({ user_a_id: ME_ID, user_b_id: PEER_ID });
  });

  it("existing conversation found: SELECT match, returns existing id WITHOUT calling INSERT", async () => {
    const EXISTING_ID = "44444444-4444-4444-4444-444444444444";
    const { from, insertSpy, channel, removeChannel } = makeConversationsFromMock({
      selectSequence: [{ data: { id: EXISTING_ID } }],
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmConversations({ userId: ME_ID }));

    let response: { conversationId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.findOrCreate(PEER_ID);
    });

    expect(response!.conversationId).toBe(EXISTING_ID);
    expect(response!.error).toBeNull();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("INSERT race (23505 unique violation): falls back to a second SELECT, returns that id (not an error)", async () => {
    const RACE_WINNER_ID = "55555555-5555-5555-5555-555555555555";
    const { from, channel, removeChannel } = makeConversationsFromMock({
      // 1st select (no existing) -> insert fails 23505 -> 2nd select (fallback) finds it.
      selectSequence: [{ data: null }, { data: { id: RACE_WINNER_ID } }],
      insert: {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmConversations({ userId: ME_ID }));

    let response: { conversationId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.findOrCreate(PEER_ID);
    });

    expect(response!.conversationId).toBe(RACE_WINNER_ID);
    expect(response!.error).toBeNull();
  });

  it("RLS rejects INSERT (not friends): returns mapped Vietnamese error, not a raw Postgres message", async () => {
    const { from, channel, removeChannel } = makeConversationsFromMock({
      selectSequence: [{ data: null }],
      insert: {
        data: null,
        error: { code: "42501", message: "new row violates row-level security policy" },
      },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmConversations({ userId: ME_ID }));

    let response: { conversationId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.findOrCreate(PEER_ID);
    });

    expect(response!.conversationId).toBeNull();
    expect(response!.error).toBe("Chỉ chat riêng được với bạn bè đã kết bạn.");
    expect(response!.error).not.toMatch(/row-level security/);
  });

  it("self-DM: rejected client-side before any SELECT/INSERT call", async () => {
    const { from, insertSpy, channel, removeChannel } = makeConversationsFromMock({ selectSequence: [] });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useDmConversations({ userId: ME_ID }));

    let response: { conversationId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.findOrCreate(ME_ID);
    });

    expect(response!.conversationId).toBeNull();
    expect(response!.error).toContain("tự nhắn tin cho chính mình");
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
