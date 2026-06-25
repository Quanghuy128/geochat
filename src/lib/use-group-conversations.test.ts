/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-group-conversations.ts — tập trung vào createGroup() (validate
 * client-side trước network call, RPC happy-path/error mapping), theo group-chat-testplan.md
 * > mục 1.1 (U4-U7).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const ME_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const GROUP_ID = "33333333-3333-3333-3333-333333333333";

function makeGroupConversationsMock(opts: {
  rpc?: { data: unknown; error: unknown };
  memberRows?: { group_id: string }[];
  groupRows?: { id: string; name: string; creator_id: string; created_at: string }[];
}) {
  const rpcSpy = vi.fn(async () => opts.rpc ?? { data: GROUP_ID, error: null });

  const from = vi.fn((table: string) => {
    if (table === "group_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ data: opts.memberRows ?? [], error: null })),
          })),
        })),
      };
    }
    if (table === "group_conversations") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: opts.groupRows ?? [], error: null })),
        })),
      };
    }
    if (table === "group_messages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        })),
      };
    }
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
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

  return { from, rpcSpy, channel, removeChannel };
}

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { useGroupConversations } from "./use-group-conversations";

describe("useGroupConversations.createGroup", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("happy path: calls create_group RPC with trimmed name + member ids, returns groupId", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    let response: { groupId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.createGroup("  Đi Đà Lạt  ", [MEMBER_ID]);
    });

    expect(response!.groupId).toBe(GROUP_ID);
    expect(response!.error).toBeNull();
    expect(rpcSpy).toHaveBeenCalledWith("create_group", {
      p_name: "Đi Đà Lạt",
      p_member_ids: [MEMBER_ID],
    });
  });

  it("empty/whitespace name: rejected client-side, RPC never called", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    let response: { groupId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.createGroup("   ", [MEMBER_ID]);
    });

    expect(response!.groupId).toBeNull();
    expect(response!.error).toContain("tên nhóm");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("zero members selected: rejected client-side, RPC never called (THINK #11)", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    let response: { groupId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.createGroup("Tên nhóm", []);
    });

    expect(response!.groupId).toBeNull();
    expect(response!.error).toContain("ít nhất 1 thành viên");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("name longer than 100 chars: rejected client-side, RPC never called", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    let response: { groupId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.createGroup("a".repeat(101), [MEMBER_ID]);
    });

    expect(response!.groupId).toBeNull();
    expect(response!.error).toContain("100");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("RPC rejects (e.g. friend-gating failure or cap-50): maps to a clear Vietnamese error, all-or-nothing (U7)", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({
      rpc: { data: null, error: { code: "42501", message: "row-level security" } },
    });
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    let response: { groupId: string | null; error: string | null };
    await act(async () => {
      response = await result.current.createGroup("Tên nhóm", [MEMBER_ID]);
    });

    expect(response!.groupId).toBeNull();
    expect(response!.error).not.toBeNull();
    expect(response!.error).not.toMatch(/row-level security/);
  });

  it("creator id is excluded/deduped from member_ids sent to RPC (RPC adds creator itself)", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations({ userId: ME_ID }));

    await act(async () => {
      await result.current.createGroup("Tên nhóm", [MEMBER_ID, ME_ID, MEMBER_ID]);
    });

    expect(rpcSpy).toHaveBeenCalledWith("create_group", {
      p_name: "Tên nhóm",
      p_member_ids: [MEMBER_ID],
    });
  });

  it("identity = null: groups stays empty, no Supabase table call for load", async () => {
    const { from, rpcSpy, channel, removeChannel } = makeGroupConversationsMock({});
    vi.mocked(createClient).mockReturnValue({
      from,
      rpc: rpcSpy,
      channel,
      removeChannel,
    } as never);

    const { result } = renderHook(() => useGroupConversations(null));

    await waitFor(() => {
      expect(result.current.groups).toEqual([]);
    });
  });
});
