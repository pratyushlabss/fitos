import { initials } from "@/lib/logic/format";

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-2xl",
};

export function Avatar({ name, url, size = "md" }: { name: string | null | undefined; url?: string | null; size?: keyof typeof SIZES }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-3 font-semibold tracking-tight text-fg ${SIZES[size]}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
