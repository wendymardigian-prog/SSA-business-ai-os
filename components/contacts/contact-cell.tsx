"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/components/contacts/ui";
import type { CellTone, CellValue } from "@/lib/contacts/filters/types";

/**
 * Una celda de la lista de contactos armada con datos (`CellValue`): la
 * calcula el servidor (`lib/contacts/columns-core.ts` y cada área de
 * `lib/contacts/related/*`) y acá solo se dibuja. Las fechas se muestran en la
 * zona y el idioma del navegador.
 */

const TONES: Record<CellTone, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  muted: "bg-muted text-muted-foreground",
};

const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function Sub({ children }: { children?: string }) {
  if (!children) return null;
  return <span className="block truncate text-xs text-muted-foreground/80">{children}</span>;
}

export function ContactCell({ value, loading, memberLabel }: { value: CellValue | undefined; loading?: boolean; memberLabel: Map<string, string> }) {
  if (loading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" aria-label="Cargando" />;
  if (!value) return <span className="text-muted-foreground">—</span>;
  switch (value.t) {
    case "text": {
      const body = (
        <>
          <span className="block max-w-56 truncate text-muted-foreground" title={value.title ?? value.text}>
            {value.text}
          </span>
          <Sub>{value.sub}</Sub>
        </>
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
        <span className="block whitespace-nowrap text-muted-foreground">
          {value.mode === "relative" ? formatRelative(value.at) : value.mode === "datetime" ? formatDateTime(value.at) : formatDay(value.at)}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "member":
      return <span className="text-muted-foreground">{memberLabel.get(value.userId) ?? "—"}</span>;
    case "badge":
      return (
        <span className="block">
          <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[value.tone])}>{value.text}</span>
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "number":
      return (
        <span className="block tabular-nums text-muted-foreground">
          {value.n}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "money":
      return (
        <span className="block whitespace-nowrap tabular-nums text-muted-foreground">
          {usd.format(value.cents / 100)}
          <Sub>{value.sub}</Sub>
        </span>
      );
    case "list":
      return <span className="block max-w-56 truncate text-muted-foreground" title={value.items.join(", ")}>{value.items.join(", ")}</span>;
  }
}
