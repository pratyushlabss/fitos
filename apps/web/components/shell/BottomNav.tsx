"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Dumbbell, Home, Moon, Salad, User, Users } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/workout", label: "Workout", icon: Dumbbell },
  { href: "/social", label: "Social", icon: Users },
  { href: "/nutrition", label: "Nutrition", icon: Salad },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/recovery", label: "Recovery", icon: Moon },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-phone -translate-x-1/2 border-t border-white/10 bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="grid grid-cols-7">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-1 text-[11px] ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
