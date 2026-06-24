"use client";

import { useState } from "react";
import { HeaderAuth } from "@/components/header-auth";
import { ChatPanel } from "@/components/chat-panel";
import { MapPanel } from "@/components/map-panel";
import { FriendsButton } from "@/components/friends-button";
import { FriendsPanel } from "@/components/friends-panel";
import { useAuth } from "@/lib/use-auth";
import { useFriendRequests } from "@/lib/use-friend-requests";
import { MOCK_LOCATIONS, MOCK_MESSAGES } from "@/lib/mock";

export default function Home() {
  const { user } = useAuth();
  const [friendsOpen, setFriendsOpen] = useState(false);
  // Mount duy nhất ở page.tsx (cấp cao hơn FriendsButton + FriendsPanel) — tránh
  // 2 channel Realtime trùng lặp subscribe cùng dữ liệu (xem friends-STATE.md > PLAN > mục 3.5).
  const identity = user ? { userId: user.id } : null;
  const friendRequests = useFriendRequests(identity);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-bold">GeoChat</h1>
          <p className="text-xs text-zinc-500">
            Chat realtime + bản đồ vị trí realtime
          </p>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <FriendsButton
              pendingCount={friendRequests.incoming.length}
              onClick={() => setFriendsOpen(true)}
            />
          )}
          <HeaderAuth />
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
        <ChatPanel fallback={MOCK_MESSAGES} />
        <MapPanel fallback={MOCK_LOCATIONS} />
      </div>
      <FriendsPanel
        open={friendsOpen}
        onOpenChange={setFriendsOpen}
        friendRequests={friendRequests}
      />
    </div>
  );
}
