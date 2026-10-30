import type { ReactNode } from "react";

/** Una tarjeta de Mi cuenta: titulo, una linea que explica para que sirve, y su contenido. */
export function AccountCard({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="rounded-xl border border-border bg-card p-4 md:p-5">
      <h2 id={headingId} className="text-sm font-semibold">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** El renglon de estado de abajo de un formulario: guardado, o el error con lo que hay que hacer. */
export function SaveStatus({ error, saved, savedText = "Guardado" }: { error: string | null; saved: boolean; savedText?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
        {savedText} ✓
      </p>
    );
  }
  return null;
}

export const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export const primaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";
