"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dumbbell, Home, Salad, User, Users } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import { listConversations } from "@/lib/data/messaging";

const tabs = [
  { href: "/", label: "Home", icon: Home, also: ["/activity", "/recovery"] },
  { href: "/workout", label: "Workout", icon: Dumbbell, also: [] },
  { href: "/nutrition", label: "Nutrition", icon: Salad, also: ["/coach"] },
  { href: "/social", label: "Social", icon: Users, also: ["/chat"] },
  { href: "/profile", label: "Profile", icon: User, also: [] },
] as const;

const HIDDEN_ON = ["/login", "/onboarding"];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const { status, profile } = useAuth();
  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
    enabled: status === "signed_in" && Boolean(profile?.onboarded_at),
    refetchInterval: 60_000,
  });
  const unread = (conversations.data ?? []).reduce((sum, item) => sum + item.unread, 0);

  if (status !== "signed_in" || HIDDEN_ON.some((route) => pathname.startsWith(route))) return null;

  return (
    <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-phone -translate-x-1/2 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <ul className="grid grid-cols-5">
        {tabs.map((tab) => {
          const matches = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
          const active = matches(tab.href) || tab.also.some(matches);
          const Icon = tab.icon;
          const badge = tab.href === "/social" && unread > 0 ? (unread > 9 ? "9+" : String(unread)) : null;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`press relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10px] tracking-wide transition-colors ${
                  active ? "font-semibold text-max" : "text-muted"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2 : 1.5} />
                {active ? <span className="absolute top-0 h-px w-8 bg-max" aria-hidden="true" /> : null}
                {tab.label}
                {badge ? (
                  <span className="absolute right-[calc(50%-20px)] top-2 min-w-[18px] num rounded-full border border-bg bg-max px-1 text-center text-[10px] font-semibold leading-[16px] text-bg">
                    {badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
