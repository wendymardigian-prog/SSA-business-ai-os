import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Piezas chicas que comparte el editor de reglas: clases de botones con el foco visible, un campo con su etiqueta y
 * su error, y una sección con título. Sin lógica.
 */
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export const btnPrimary = cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60", FOCUS);
export const btnSecondary = cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60", FOCUS);
export const btnSmall = cn("inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50", FOCUS);
export const btnIcon = cn("inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50", FOCUS);

export const inputClass = cn("w-full rounded-lg border border-border bg-background px-3 py-2 text-sm", FOCUS);
export const inputError = "border-red-500/70";

/** Un campo con su etiqueta visible, su ayuda y su error (el error se anuncia con `role="alert"`). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** Un grupo de campos que no es un solo control (varias etiquetas, chips): se nombra con un título, no con `label`. */
export function GroupField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("space-y-1", className)}>
      <p className="text-xs font-medium">{label}</p>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border px-4 py-4 last:border-b-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export const STATE_CLASSES: Record<string, string> = {
  activa: "bg-green-500/12 text-green-700 dark:text-green-300",
  pausada: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  vencida: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};
