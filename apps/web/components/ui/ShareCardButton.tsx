"use client";

import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { renderShareCard, type ShareCardData, shareFileNow } from "@/lib/shareCard";

export function ShareCardButton({
  data,
  filename,
  label = "Share",
  variant = "secondary",
  className = "",
}: {
  data: ShareCardData | null;
  filename: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const toast = useToast();
  const key = data ? JSON.stringify(data) : "";

  useEffect(() => {
    if (!data) return;
    let active = true;
    setFile(null);
    renderShareCard(data)
      .then((blob) => active && setFile(new File([blob], filename, { type: "image/png" })))
      .catch(() => active && setFile(null));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filename]);

  return (
    <Button
      variant={variant}
      className={`gap-2 ${className}`}
      disabled={!file}
      onClick={() => {
        if (!file || !data) return;
        shareFileNow(file, `${data.title} on FitOS`)
          .then((result) => result === "downloaded" && toast("Card saved to your downloads"))
          .catch(() => toast("Sharing failed", "error"));
      }}
    >
      <Share2 size={15} /> {file ? label : "Preparing…"}
    </Button>
  );
}
