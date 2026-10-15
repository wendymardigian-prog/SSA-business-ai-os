import Link from "next/link";
import { CornerDownRight } from "lucide-react";
import type { OriginChipView } from "@/lib/inbox/origin-chip";

/**
 * El chip "Vino de…" debajo de un mensaje entrante (Extra I, F44).
 *
 * El texto y el link los arma el servidor (`lib/inbox/origin-chip.ts`); aca solo se dibuja. Un texto largo se corta con
 * puntos suspensivos en vez de desbordar la burbuja (a 390 px la burbuja ocupa el 85 % del ancho).
 */
export function OriginChip({ chip }: { chip: OriginChipView }) {
  const className =
    "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground";
  const content = (
    <>
      <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{chip.text}</span>
    </>
  );

  return (
    <div className="mt-1 flex min-w-0">
      {chip.href ? (
        <Link
          href={chip.href}
          title={chip.text}
          className={`${className} transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
        >
          {content}
        </Link>
      ) : (
        <span title={chip.text} className={className}>
          {content}
        </span>
      )}
    </div>
  );
}
