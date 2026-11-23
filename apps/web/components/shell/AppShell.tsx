import type { ReactNode } from "react";

import { AuthGate } from "@/components/auth/AuthGate";
import { BottomNav } from "@/components/shell/BottomNav";
import { PwaSupport } from "@/components/shell/PwaSupport";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-phone flex-col bg-[radial-gradient(circle_at_top,#111827_0%,#070b14_30%,#050812_100%)] text-white">
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+7rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <AuthGate>{children}</AuthGate>
      </main>
      <BottomNav />
      <PwaSupport />
    </div>
  );
}
