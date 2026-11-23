"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { followUser, unfollowUser } from "@/lib/data/social";

export function FollowButton({
  userId,
  status,
  className = "",
}: {
  userId: string;
  status: "pending" | "accepted" | null;
  className?: string;
}) {
  const [current, setCurrent] = useState(status);
  const [synced, setSynced] = useState(status);
  if (status !== synced) {
    setSynced(status);
    setCurrent(status);
  }
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async () => {
      if (current) {
        await unfollowUser(userId);
        return null;
      }
      return followUser(userId);
    },
    onMutate: () => {
      const previous = current;
      setCurrent(previous ? null : "accepted");
      return previous;
    },
    onSuccess: (next) => {
      setCurrent(next);
      if (next === "pending") toast("Request sent. They need to approve it.");
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-card"] });
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
    onError: (error, _vars, previous) => {
      setCurrent(previous ?? null);
      toast(error.message, "error");
    },
  });
  const label = current === "accepted" ? "Following" : current === "pending" ? "Requested" : "Follow";
  return (
    <Button
      variant={current ? "secondary" : "primary"}
      className={`px-3 py-2 text-xs ${className}`}
      disabled={mutation.isPending}
      onClick={(event) => {
        event.preventDefault();
        if (current && !window.confirm(current === "pending" ? "Cancel your follow request?" : "Unfollow?")) return;
        mutation.mutate();
      }}
    >
      {label}
    </Button>
  );
}
