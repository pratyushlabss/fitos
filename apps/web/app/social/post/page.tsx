"use client";

import type { PostComment } from "@fitos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { PostCard } from "@/components/social/PostCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState, ErrorState, QueryView, SkeletonList } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { addComment, deleteComment, getPost, listComments, subscribeToPostActivity } from "@/lib/data/social";
import { timeAgo } from "@/lib/logic/format";

export default function PostPage() {
  return (
    <Suspense fallback={<SkeletonList rows={2} height="h-48" />}>
      <PostDetail />
    </Suspense>
  );
}

function PostDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { userId } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const post = useQuery({ queryKey: ["feed", "post", id], queryFn: () => getPost(id), enabled: Boolean(id) });
  const comments = useQuery({ queryKey: ["comments", id], queryFn: () => listComments(id), enabled: Boolean(id) });

  useEffect(() => {
    if (!id) return;
    return subscribeToPostActivity(id, () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", id] });
      void queryClient.invalidateQueries({ queryKey: ["feed", "post", id] });
    });
  }, [id, queryClient]);

  const add = useMutation({
    mutationFn: (text: string) => addComment(id, text),
    onMutate: (text) => {
      setBody("");
      const optimistic: PostComment = {
        id: `pending-${Date.now()}`,
        post_id: id,
        user_id: userId ?? "",
        body: text,
        created_at: new Date().toISOString(),
        profiles: null,
      };
      queryClient.setQueryData<PostComment[]>(["comments", id], (current) => [...(current ?? []), optimistic]);
    },
    onError: (error, text) => {
      setBody(text);
      toast(error.message, "error");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", id] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const remove = useMutation({
    mutationFn: deleteComment,
    onMutate: (commentId) =>
      queryClient.setQueryData<PostComment[]>(["comments", id], (current) => (current ?? []).filter((comment) => comment.id !== commentId)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["comments", id] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  if (!id) return <ErrorState message="No post selected." />;

  return (
    <PullToRefresh onRefresh={() => Promise.all([post.refetch(), comments.refetch()])}>
      <button onClick={() => router.back()} className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400">
        <ArrowLeft size={16} /> Back
      </button>
      <div className="space-y-5">
        <QueryView
          query={post}
          skeleton={<SkeletonList rows={1} height="h-56" />}
          isEmpty={(data) => data === null}
          empty={<ErrorState message="This post was deleted or is not visible to you." />}
        >
          {(data) => (data ? <PostCard post={data} linkToPost={false} /> : null)}
        </QueryView>

        {post.data ? (
          <SectionCard title={`Comments${comments.data ? ` · ${comments.data.length}` : ""}`}>
            <QueryView
              query={comments}
              skeleton={<SkeletonList rows={2} height="h-12" />}
              isEmpty={(data) => data.length === 0}
              empty={<EmptyState title="No comments yet" body="Say something encouraging." />}
            >
              {(data) => (
                <ul className="space-y-3">
                  {data.map((comment) => {
                    const mine = comment.user_id === userId;
                    const canDelete = mine || post.data?.user_id === userId;
                    return (
                      <li key={comment.id} className={`flex gap-3 ${comment.id.startsWith("pending-") ? "opacity-60" : ""}`}>
                        <Link href={`/social/profile?id=${comment.user_id}`}>
                          <Avatar name={comment.profiles?.display_name ?? "You"} url={comment.profiles?.avatar_url} size="sm" />
                        </Link>
                        <div className="min-w-0 flex-1 rounded-2xl bg-slate-950/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="truncate font-medium text-slate-300">{mine ? "You" : comment.profiles?.display_name}</span>
                            <span>{timeAgo(comment.created_at)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{comment.body}</p>
                        </div>
                        {canDelete && !comment.id.startsWith("pending-") ? (
                          <button
                            className="self-center p-1 text-slate-500 hover:text-rose-300"
                            aria-label="Delete comment"
                            onClick={() => window.confirm("Delete this comment?") && remove.mutate(comment.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </QueryView>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (body.trim()) add.mutate(body.trim());
              }}
            >
              <input
                value={body}
                onChange={(event) => setBody(event.target.value.slice(0, 1000))}
                placeholder="Add a comment"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-base text-white outline-none placeholder:text-slate-600 focus:border-emerald-300/40"
              />
              <Button type="submit" aria-label="Send comment" disabled={!body.trim()}>
                <Send size={16} />
              </Button>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </PullToRefresh>
  );
}
