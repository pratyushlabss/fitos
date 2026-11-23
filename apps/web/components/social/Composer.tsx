"use client";

import type { Visibility } from "@fitos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";

import { useProfile } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Segmented, TextArea } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { createPost } from "@/lib/data/social";

export function Composer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfile();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(profile.default_visibility === "private" ? "friends" : profile.default_visibility);
  const input = useRef<HTMLInputElement>(null);

  const post = useMutation({
    mutationFn: () => createPost({ post_type: photo ? "photo" : "text", body, visibility, photo }),
    onSuccess: () => {
      toast("Posted", "success");
      setBody("");
      setPhoto(null);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      onClose();
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <Sheet open={open} onClose={onClose} title="New post">
      <div className="space-y-3 pb-2">
        <TextArea value={body} onChange={(event) => setBody(event.target.value.slice(0, 2000))} placeholder="Share a win, a PR or a question…" autoFocus />
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="max-h-64 w-full rounded-2xl object-cover" />
            <button
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
              aria-label="Remove photo"
              onClick={() => {
                setPhoto(null);
                setPreview(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full gap-2" onClick={() => input.current?.click()}>
            <ImagePlus size={16} /> Add photo
          </Button>
        )}
        <input
          ref={input}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPhoto(file);
            setPreview(URL.createObjectURL(file));
          }}
        />
        <Segmented
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "friends", label: "Followers" },
            { value: "public", label: "Everyone" },
          ]}
        />
        <p className="text-xs text-slate-500">Photos are compressed and only shown to people who can see this post.</p>
        <Button className="w-full" disabled={post.isPending || (!body.trim() && !photo)} onClick={() => post.mutate()}>
          {post.isPending ? "Posting…" : "Post"}
        </Button>
      </div>
    </Sheet>
  );
}
