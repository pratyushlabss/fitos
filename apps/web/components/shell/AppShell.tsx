import type { ReactNode } from "react";

import { AuthGate } from "@/components/auth/AuthGate";
import { BottomNav } from "@/components/shell/BottomNav";
import { PwaSupport } from "@/components/shell/PwaSupport";
import { Texture } from "@/components/shell/Texture";
import { PressFeedback } from "@/components/motion/PressFeedback";
import { PageTransition } from "@/components/motion/PageTransition";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-phone flex-col bg-bg text-fg">
      <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+7rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <AuthGate>
          <PageTransition>{children}</PageTransition>
        </AuthGate>
      </main>
      <BottomNav />
      <PwaSupport />
      <Texture />
      <PressFeedback />
    </div>
  );
}
