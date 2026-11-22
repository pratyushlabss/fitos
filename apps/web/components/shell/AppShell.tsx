import type { ReactNode } from "react";

import { AuthGate } from "@/components/auth/AuthGate";
import { BottomNav } from "@/components/shell/BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-phone flex-col bg-[radial-gradient(circle_at_top,#111827_0%,#070b14_30%,#050812_100%)] text-white">
      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-6">
        <AuthGate>{children}</AuthGate>
      </main>
      <BottomNav />
    </div>
  );
}
