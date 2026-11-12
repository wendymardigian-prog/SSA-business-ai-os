import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** ‹ Hoy › para una vista por mes, en la barra superior (Servicios A2). Los tres son links. */
export function MonthNav({ prevHref, nextHref, todayHref }: { prevHref: string; nextHref: string; todayHref: string }) {
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-input bg-background px-2 text-sm hover:border-muted-foreground/60 max-topbar:h-10 max-topbar:min-w-10";
  return (
    <nav aria-label="Cambiar de mes" className="flex shrink-0 items-center gap-1">
      <Link href={prevHref} aria-label="Mes anterior" className={btn}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Link>
      <Link href={todayHref} className={btn}>
        Hoy
      </Link>
      <Link href={nextHref} aria-label="Mes siguiente" className={btn}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </nav>
  );
}
