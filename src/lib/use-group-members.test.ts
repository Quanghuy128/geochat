/**
 * @vitest-environment jsdom
 *
 * Unit tests cho use-group-members.ts — load members + isCreator derivation, addMembers
 * (update-then-insert re-join path), removeMember/leaveGroup soft-delete semantics, theo
 * group-chat-testplan.md > mục 1.3 (U21-U29).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const CREATOR_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ID = "33333333-3333-3333-3333-333333333333";
const GROUP_ID = "44444444-4444-4444-4444-444444444444";

function makeGroupMembersMock(opts: {
  groupRow?: { id: string; creator_id: string } | null;
  memberRows?: { group_id: string; user_id: string; joined_at: string; left_at: string | null }[];
  profiles?: { id: string; username: string }[];
  updateResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
}) {
  const updateSpy = vi.fn();
  const insertSpy = vi.fn();

  const from = vi.fn((table: string) => {
    if (table === "group_conversations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: opts.groupRow ?? null, error: null })),
          })),
        })),
      };
    }
    if (table === "group_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => ({ data: opts.memberRows ?? [], error: null })),
          })),
        })),
        update: vi.fn((payload: unknown) => {
          updateSpy(payload);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(async () => opts.updateResult ?? { data: [], error: null }),
              })),
            })),
          };
        }),
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return Promise.resolve(opts.insertResult ?? { data: [{ }], error: null });
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: opts.profiles ?? [], error: null })),
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

  return { from, updateSpy, insertSpy, channel, removeChannel };
}

vi.mock("./supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "./supabase/client";
import { useGroupMembers } from "./use-group-members";

describe("useGroupMembers", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("load(): returns only active (left_at null) members with isCreator derived per row", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      memberRows: [
        { group_id: GROUP_ID, user_id: CREATOR_ID, joined_at: "2024-01-01", left_at: null },
        { group_id: GROUP_ID, user_id: OTHER_ID, joined_at: "2024-01-02", left_at: null },
      ],
      profiles: [
        { id: CREATOR_ID, username: "huy_nguyen" },
        { id: OTHER_ID, username: "alice99" },
      ],
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    await waitFor(() => {
      expect(result.current.members).toHaveLength(2);
    });
    const creatorRow = result.current.members.find((m) => m.id === CREATOR_ID);
    const otherRow = result.current.members.find((m) => m.id === OTHER_ID);
    expect(creatorRow?.isCreator).toBe(true);
    expect(otherRow?.isCreator).toBe(false);
  });

  it("isCreator (viewer flag): true only when viewer's userId === group creator_id", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      memberRows: [],
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result: asCreator } = renderHook(() =>
      useGroupMembers(GROUP_ID, { userId: CREATOR_ID }),
    );
    await waitFor(() => expect(asCreator.current.creatorId).toBe(CREATOR_ID));
    expect(asCreator.current.isCreator).toBe(true);

    const { result: asOther } = renderHook(() => useGroupMembers(GROUP_ID, { userId: OTHER_ID }));
    await waitFor(() => expect(asOther.current.creatorId).toBe(CREATOR_ID));
    expect(asOther.current.isCreator).toBe(false);
  });

  it("addMembers(): tries UPDATE (re-join path) first; falls back to INSERT if no existing row", async () => {
    const { from, updateSpy, insertSpy, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [], error: null }, // 0 rows matched -> not yet a member
      insertResult: { data: [{}], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.addMembers([OTHER_ID]);
    });

    expect(response!.error).toBeNull();
    expect(updateSpy).toHaveBeenCalledWith({ left_at: null });
    expect(insertSpy).toHaveBeenCalledWith({
      group_id: GROUP_ID,
      user_id: OTHER_ID,
      left_at: null,
    });
  });

  it("addMembers(): re-join path — UPDATE matches existing row, INSERT is NOT called", async () => {
    const { from, updateSpy, insertSpy, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [{ group_id: GROUP_ID, user_id: OTHER_ID }], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.addMembers([OTHER_ID]);
    });

    expect(response!.error).toBeNull();
    expect(updateSpy).toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("addMembers(): target already an active member -> clear error, no UPDATE/INSERT attempted", async () => {
    const { from, updateSpy, insertSpy, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      memberRows: [
        { group_id: GROUP_ID, user_id: CREATOR_ID, joined_at: "2024-01-01", left_at: null },
        { group_id: GROUP_ID, user_id: OTHER_ID, joined_at: "2024-01-02", left_at: null },
      ],
      profiles: [
        { id: CREATOR_ID, username: "huy_nguyen" },
        { id: OTHER_ID, username: "alice99" },
      ],
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    await waitFor(() => {
      expect(result.current.members).toHaveLength(2);
    });

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.addMembers([OTHER_ID]);
    });

    expect(response!.error).not.toBeNull();
    expect(response!.error).toBe("đã là thành viên");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("addMembers(): DB rejection (friend-gating fail or cap-50) maps to a clear error", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: null, error: { code: "42501", message: "rls" } },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.addMembers([OTHER_ID]);
    });

    expect(response!.error).not.toBeNull();
  });

  it("removeMember(): updates left_at to now() for the target user", async () => {
    const { from, updateSpy, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [{ user_id: OTHER_ID }], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.removeMember(OTHER_ID);
    });

    expect(response!.error).toBeNull();
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ left_at: expect.any(String) }));
  });

  it("removeMember(): RLS rejects when caller is not the creator (0 rows updated)", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: OTHER_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.removeMember(CREATOR_ID);
    });

    expect(response!.error).not.toBeNull();
  });

  it("leaveGroup(): updates own left_at, succeeds for regular member", async () => {
    const { from, updateSpy, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [{ user_id: OTHER_ID }], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: OTHER_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.leaveGroup();
    });

    expect(response!.error).toBeNull();
    expect(updateSpy).toHaveBeenCalled();
  });

  it("leaveGroup(): allowed for creator too (THINK #9 — orphaning accepted, no special-case block)", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({
      groupRow: { id: GROUP_ID, creator_id: CREATOR_ID },
      updateResult: { data: [{ user_id: CREATOR_ID }], error: null },
    });
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(GROUP_ID, { userId: CREATOR_ID }));

    let response: { error: string | null };
    await act(async () => {
      response = await result.current.leaveGroup();
    });

    expect(response!.error).toBeNull();
  });

  it("identity/groupId null-safe: empty members, no throw", async () => {
    const { from, channel, removeChannel } = makeGroupMembersMock({});
    vi.mocked(createClient).mockReturnValue({ from, channel, removeChannel } as never);

    const { result } = renderHook(() => useGroupMembers(null, null));

    await waitFor(() => {
      expect(result.current.members).toEqual([]);
    });
    expect(result.current.isCreator).toBe(false);
  });
});
