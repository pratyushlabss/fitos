import Link from "next/link";

export function ActionCard({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-panel p-4">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-accent py-3 text-sm font-semibold text-ink"
      >
        {cta}
      </Link>
    </section>
  );
}
