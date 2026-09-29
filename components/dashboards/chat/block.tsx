"use client";

import { Suspense, use, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockResult } from "@/lib/dashboards/chat/types";

/**
 * Un bloque del dashboard: se pide solo, se muestra cuando llega, y si falla lo
 * dice sin arrastrar a los demas.
 *
 * El servidor arma una promesa por bloque y las manda sin esperarlas; aca cada
 * una se lee con `use()` adentro de su propio `Suspense`. Mientras llega se ve
 * su skeleton. Los loaders nunca rechazan (ver lib/dashboards/chat/result.ts),
 * asi que `use()` no puede tirar la pantalla abajo.
 *
 * "Reintentar" rehace la consulta del servidor (`router.refresh()`), que vuelve
 * a pedir todos los bloques. Es mas simple que un reintento por bloque y, si se
 * cayo la base, igual hacia falta rehacerlos todos.
 */

export function Block<T>({
  promise,
  label,
  skeleton,
  children,
}: {
  promise: Promise<BlockResult<T>>;
  /** Como se llama el bloque en el mensaje de error. */
  label: string;
  skeleton?: ReactNode;
  children: (data: T, loadedAt: string) => ReactNode;
}) {
  return (
    <Suspense fallback={skeleton ?? <BlockSkeleton />}>
      <Resolved promise={promise} label={label}>
        {children}
      </Resolved>
    </Suspense>
  );
}

function Resolved<T>({
  promise,
  label,
  children,
}: {
  promise: Promise<BlockResult<T>>;
  label: string;
  children: (data: T, loadedAt: string) => ReactNode;
}) {
  const result = use(promise);
  if (!result.ok) return <BlockError label={label} error={result.error} />;
  return <>{children(result.data, result.loadedAt)}</>;
}

/** El error de un bloque: que falló y como volver a intentarlo. Nunca un 0. */
export function BlockError({ label, error }: { label: string; error: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[14px] border border-dashed border-bad/50 bg-card p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden />
        No pudimos mostrar {label}
      </p>
      <p className="text-xs text-muted-foreground">{error}</p>
      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden />
        Reintentar
      </button>
    </div>
  );
}

/** Lo que se ve mientras el bloque viaja. Con la forma de lo que va a venir. */
export function BlockSkeleton({
  kind = "panel",
  className,
}: {
  kind?: "panel" | "kpis" | "chart" | "table" | "cards3";
  className?: string;
}) {
  const bar = "animate-pulse rounded bg-muted";
  if (kind === "kpis") {
    return (
      <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-5", className)} aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-card p-4">
            <div className={cn(bar, "h-3 w-3/5")} />
            <div className={cn(bar, "mt-2 h-6 w-2/5")} />
            <div className={cn(bar, "mt-2 h-2.5 w-4/5")} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "cards3") {
    return (
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", className)} aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[14px] border border-border bg-card p-4">
            <div className={cn(bar, "h-3 w-1/2")} />
            <div className={cn(bar, "mt-3 h-8 w-2/5")} />
            <div className={cn(bar, "mt-2 h-2.5 w-3/4")} />
          </div>
        ))}
      </div>
    );
  }
  const bodyHeight = kind === "chart" ? "h-[240px]" : kind === "table" ? "h-[180px]" : "h-[120px]";
  return (
    <div className={cn("rounded-[14px] border border-border bg-card p-4", className)} aria-hidden>
      <div className={cn(bar, "h-4 w-48 max-w-full")} />
      <div className={cn(bar, "mt-4", bodyHeight)} />
    </div>
  );
}

/**
 * Una tarjeta. Radio de 14 px y fondo de superficie sobre el fondo de pagina,
 * como el prototipo.
 */
export function Panel({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Pestañas, leyenda o un link, a la derecha del titulo. */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-[14px] border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-[18px] pb-1.5 pt-4">
          {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
      {footer && (
        <footer className="flex flex-wrap justify-between gap-2 border-t border-border px-[18px] py-2.5 text-xs text-muted-foreground">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** El encabezado de una seccion: mayusculas, subtitulo y un link a la derecha. */
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground/80">{subtitle}</p>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** Un bloque sin datos: explica y ofrece algo, nunca un cero. */
export function EmptyBlock({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-border bg-card px-5 py-14 text-center">
      {icon && <div className="grid h-13 w-13 place-items-center rounded-[14px] bg-muted p-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-medium">{title}</h3>
      {text && <p className="max-w-[52ch] text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}
