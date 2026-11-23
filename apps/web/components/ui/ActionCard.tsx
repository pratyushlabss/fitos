import Link from "next/link";

import { buttonClass } from "@/components/ui/Button";

export function ActionCard({ title, body, cta, href }: { title: string; body: string; cta: string; href: string }) {
  return (
    <section className="texture-dots rounded-card border border-line bg-surface-1 p-5">
      <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-muted">{body}</p>
      <Link href={href} data-press className={`${buttonClass.base} ${buttonClass.primary} mt-5 w-full`}>
        {cta}
      </Link>
    </section>
  );
}
