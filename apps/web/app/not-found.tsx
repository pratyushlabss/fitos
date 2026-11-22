import Link from "next/link";

import { ScreenHeader } from "@/components/shell/ScreenHeader";

export default function NotFound() {
  return (
    <>
      <ScreenHeader eyebrow="404" title="Page not found" subtitle="This screen does not exist or has moved." />
      <Link
        href="/"
        className="flex w-full items-center justify-center rounded-xl bg-accent py-3 text-sm font-semibold text-ink"
      >
        Back to home
      </Link>
    </>
  );
}
