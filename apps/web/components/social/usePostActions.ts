"use client";

import { type InfiniteData, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui/Toast";
import { deletePost, type FeedPostWithMedia, setLiked, setSaved } from "@/lib/data/social";

type FeedCache = FeedPostWithMedia[] | FeedPostWithMedia | InfiniteData<FeedPostWithMedia[]> | null | undefined;

function mapCache(data: FeedCache, update: (post: FeedPostWithMedia) => FeedPostWithMedia | null): FeedCache {
  if (!data) return data;
  const mapList = (list: FeedPostWithMedia[]) => list.map(update).filter((post): post is FeedPostWithMedia => post !== null);
  if (Array.isArray(data)) return mapList(data);
  if ("pages" in data) return { ...data, pages: data.pages.map(mapList) };
  return update(data);
}

export function patchPostEverywhere(queryClient: QueryClient, postId: string, update: (post: FeedPostWithMedia) => FeedPostWithMedia | null) {
  queryClient.setQueriesData<FeedCache>({ queryKey: ["feed"] }, (data) => mapCache(data, (post) => (post.id === postId ? update(post) : post)));
}

export function usePostActions() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const like = useMutation({
    mutationFn: ({ post, liked }: { post: FeedPostWithMedia; liked: boolean }) => setLiked(post.id, liked),
    onMutate: ({ post, liked }) =>
      patchPostEverywhere(queryClient, post.id, (current) => ({
        ...current,
        liked_by_me: liked,
        like_count: Math.max(0, current.like_count + (liked ? 1 : -1)),
      })),
    onError: (error, { post, liked }) => {
      patchPostEverywhere(queryClient, post.id, (current) => ({
        ...current,
        liked_by_me: !liked,
        like_count: Math.max(0, current.like_count + (liked ? -1 : 1)),
      }));
      toast(error.message, "error");
    },
  });

  const save = useMutation({
    mutationFn: ({ post, saved }: { post: FeedPostWithMedia; saved: boolean }) => setSaved(post.id, saved),
    onMutate: ({ post, saved }) => patchPostEverywhere(queryClient, post.id, (current) => ({ ...current, saved_by_me: saved })),
    onSuccess: (_data, { saved }) => {
      toast(saved ? "Saved" : "Removed from saved", "success");
      void queryClient.invalidateQueries({ queryKey: ["feed", "saved"] });
    },
    onError: (error, { post, saved }) => {
      patchPostEverywhere(queryClient, post.id, (current) => ({ ...current, saved_by_me: !saved }));
      toast(error.message, "error");
    },
  });

  const remove = useMutation({
    mutationFn: (post: FeedPostWithMedia) => deletePost(post.id),
    onMutate: (post) => patchPostEverywhere(queryClient, post.id, () => null),
    onSuccess: () => toast("Post deleted"),
    onError: (error) => {
      toast(error.message, "error");
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  return { like, save, remove };
}
