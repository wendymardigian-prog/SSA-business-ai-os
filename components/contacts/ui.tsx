/**
 * Piezas visuales que comparten la ficha y la lista de contactos.
 *
 * El repo no tiene libreria de componentes (ni shadcn ni Radix): son clases de
 * Tailwind sobre HTML. Esto existe solo para no repetir catorce veces el mismo
 * borde y el mismo encabezado, no para inventar un design system nuevo.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LeadTemperature } from "@/lib/types/database";
import { LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Empty state chico, para las secciones de la ficha. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground/70">
      {children}
    </p>
  );
}

const TEMPERATURE_CLASSES: Record<LeadTemperature, string> = {
  cold: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  warm: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  hot: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

export function TemperatureBadge({ value }: { value: LeadTemperature | null }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
        TEMPERATURE_CLASSES[value],
      )}
    >
      {LEAD_TEMPERATURE_LABELS[value]}
    </span>
  );
}

/** El aviso mas fuerte de la ficha: nadie deberia escribirle a este contacto. */
export function DoNotContactBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
      No contactar
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-xs font-medium"
      style={
        color
          ? { backgroundColor: `${color}20`, borderColor: `${color}40`, color }
          : undefined
      }
    >
      {name}
    </span>
  );
}

/** Mensaje de error de una accion, con el mismo tono que usa la pantalla de integraciones. */
export function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/** Fechas siempre en la zona del navegador: la base guarda todo en UTC. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "Nunca";
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} dias`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
