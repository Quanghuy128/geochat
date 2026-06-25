/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-send-friend-request.ts — pure logic branches, mock Supabase client.
 * Runner: Vitest (renderHook từ @testing-library/react — cần env jsdom riêng cho file này,
 * vitest.config.ts mặc định "node" cho các file khác).
 * Chạy: npx vitest run src/lib/use-send-friend-request.test.ts
 *
 * Khớp docs/loops/friends-testplan.md > mục B #2 (self-check) và #3 (23505 mapping).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";

// Builder cho 1 query-chain mock đơn giản — đủ cho .select().ilike().maybeSingle() /
// .select().eq().or().maybeSingle() / .insert().select().single().
function makeFromMock(handlers: {
  profilesLookup?: { data: unknown; error: unknown };
  friendshipCheck?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
}) {
  const insertSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          ilike: vi.fn(() => ({
            maybeSingle: vi.fn(async () => handlers.profilesLookup),
          })),
        })),
      };
    }
    if (table === "friend_requests") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            or: vi.fn(() => ({
              maybeSingle: vi.fn(async () => handlers.friendshipCheck),
            })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => handlers.insert),
            })),
          };
        }),
      };
    }
    throw new Error(`Unexpected table in test mock: ${table}`);
  });

  return { from, insertSpy };
}

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { useSendFriendRequest } from "./use-send-friend-request";

describe("useSendFriendRequest", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("self-check: gửi tới username của chính mình bị chặn TRƯỚC khi insert", async () => {
    const { from, insertSpy } = makeFromMock({
      profilesLookup: {
        data: { id: ME_ID, username: "alice99" },
        error: null,
      },
    });
    vi.mocked(createClient).mockReturnValue({ from } as never);

    const { result } = renderHook(() => useSendFriendRequest({ userId: ME_ID }));

    let response: { error: string | null; request: unknown };
    await act(async () => {
      // Case-sensitivity: username input khác case với profile (ALICE99 vs alice99) —
      // self-check phải dựa trên `id` lookup được, không phải so string trực tiếp.
      response = await result.current.send("ALICE99");
    });

    expect(response!.error).toContain("tự gửi lời mời cho chính mình");
    expect(response!.request).toBeNull();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("map lỗi 23505 (unique violation) sang message 'đã có lời mời đang chờ'", async () => {
    const OTHER_ID = "22222222-2222-2222-2222-222222222222";
    const { from } = makeFromMock({
      profilesLookup: {
        data: { id: OTHER_ID, username: "bob" },
        error: null,
      },
      friendshipCheck: { data: null, error: null },
      insert: {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
    });
    vi.mocked(createClient).mockReturnValue({ from } as never);

    const { result } = renderHook(() => useSendFriendRequest({ userId: ME_ID }));

    let response: { error: string | null; request: unknown };
    await act(async () => {
      response = await result.current.send("bob");
    });

    expect(response!.error).toContain("có lời mời đang chờ");
    expect(response!.error).not.toMatch(/Không thể gửi lời mời\. Vui lòng thử lại\./);
    expect(response!.request).toBeNull();
  });
});
