import type { ProfileSearchResult } from "@fitos/types";
import { Lock } from "lucide-react";
import Link from "next/link";

import { FollowButton } from "@/components/social/FollowButton";
import { Avatar } from "@/components/ui/Avatar";

export function PersonRow({ person }: { person: ProfileSearchResult }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3">
      <Link href={`/social/profile?id=${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={person.display_name} url={person.avatar_url} />
        <span className="min-w-0">
          <strong className="flex items-center gap-1 truncate text-sm text-white">
            {person.display_name || person.username}
            {person.is_private ? <Lock size={12} className="text-slate-500" /> : null}
          </strong>
          <span className="text-xs text-slate-500">@{person.username}</span>
        </span>
      </Link>
      <FollowButton userId={person.id} status={person.follow_status} />
    </div>
  );
}
