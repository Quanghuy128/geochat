import { AuthPanel } from "@/components/auth-panel";
import { ChatPanel } from "@/components/chat-panel";
import { MapPanel } from "@/components/map-panel";
import { MOCK_LOCATIONS, MOCK_MESSAGES } from "@/lib/mock";

export default function Home() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-bold">GeoChat</h1>
          <p className="text-xs text-zinc-500">
            Chat realtime + bản đồ vị trí realtime
          </p>
        </div>
        <AuthPanel />
      </header>
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
        <ChatPanel fallback={MOCK_MESSAGES} />
        <MapPanel fallback={MOCK_LOCATIONS} />
      </div>
    </div>
  );
}
