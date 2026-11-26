"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/components/contacts/ui";
import type { CellTone, CellValue } from "@/lib/contacts/filters/types";
import { Tip } from "@/components/ui/tooltip";

/**
 * Una celda de la lista de contactos armada con datos (`CellValue`): la
 * calcula el servidor (`lib/contacts/columns-core.ts` y cada área de
 * `lib/contacts/related/*`) y acá solo se dibuja. Las fechas se muestran en la
 * zona de quien mira.
 */

const TONES: Record<CellTone, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  muted: "bg-muted text-disabled-foreground",
};

const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function formatDay(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // "AAAA-MM-DD" es una fecha civil (una venta, un seguimiento): no cambia de dia segun quien mira.
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return d.toLocaleDateString("es-AR", { timeZone: civil ? "UTC" : timeZone, day: "2-digit", month: "short", year: "numeric" });
}

/** La aclaración va en el MISMO renglón («valor · aclaración»): cada fila de la tabla mide un renglón. */
function Sub({ children }: { children?: string }) {
  if (!children) return null;
  return <span className="text-xs text-muted-foreground"> · {children}</span>;
}

export function ContactCell({ value, loading, memberLabel }: { value: CellValue | undefined; loading?: boolean; memberLabel: Map<string, string> }) {
  const timeZone = useViewerTimezone();
  if (loading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />;
  if (!value) return <span className="text-muted-foreground">—</span>;
  switch (value.t) {
    case "text": {
      const body = (
        <Tip asChild content={[value.title ?? value.text, value.sub].filter(Boolean).join(" · ")}>
          <span className="block truncate text-muted-foreground">
            {value.text}
            <Sub>{value.sub}</Sub>
          </span>
        </Tip>
      );
      return value.href ? (
        <Link href={value.href} className="block hover:underline">
          {body}
        </Link>
      ) : (
        body
      );
    }
    case "date":
      return (
        <span className="block truncate text-muted-foreground">
          {value.mode === "relative" ? formatRelative(value.at, timeZone) : value.mode === "datetime" ? formatDateTime(value.at, timeZone) : formatDay(value.at, timeZone)}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "member":
      return <span className="text-muted-foreground">{memberLabel.get(value.userId) ?? "—"}</span>;
    case "badge":
      return (
        <span className="block truncate">
          <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[value.tone])}>{value.text}</span>
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "number":
      return (
        <span className="block truncate tabular-nums text-muted-foreground">
          {value.n}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "money":
      return (
        <span className="block truncate tabular-nums text-muted-foreground">
          {usd.format(value.cents / 100)}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "list":
      return <Tip asChild content={value.items.join(", ")}><span className="block truncate text-muted-foreground">{value.items.join(", ")}</span></Tip>;
  }
}
