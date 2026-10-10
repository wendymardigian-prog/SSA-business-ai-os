"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { routePattern } from "@/lib/nav/page-actions";

/**
 * Lo que se ve mientras carga una pantalla (los `loading.tsx`).
 *
 * Sin esto, un clic en el menu dejaba la pantalla anterior congelada hasta
 * que la nueva terminaba de cargar entera, y parecia que el clic no habia
 * andado. Con esto, al instante: la barra con el titulo de la pantalla nueva
 * (sale de la URL, igual que en la pagina real) y la forma del contenido en
 * gris.
 *
 * Next lo prefetchea junto con el link, asi que aparece sin esperar al
 * servidor.
 */
export type SkeletonVariant = "list" | "cards" | "detail" | "split" | "form";

export function PageSkeleton({ variant = "list" }: { variant?: SkeletonVariant }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-live="polite">
      <PageHeader route={routePattern(pathname)} />
      <span className="sr-only">Cargando…</span>
      {variant === "list" && <ListBody />}
      {variant === "cards" && <CardsBody />}
      {variant === "detail" && <DetailBody />}
      {variant === "split" && <SplitBody />}
      {variant === "form" && <FormBody />}
    </div>
  );
}

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

function ListBody() {
  return (
    <div className="flex-1 overflow-hidden p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Bar className="h-9 w-56 rounded-lg" />
        <Bar className="h-9 w-24 rounded-lg" />
      </div>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="h-8 w-8 rounded-full" />
            <div className="flex-1">
              <Bar className="h-4 w-48" />
              <Bar className="mt-1.5 h-3 w-32" />
            </div>
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsBody() {
  return (
    <div className="flex-1 overflow-hidden p-4 md:p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <Bar className="h-9 w-9 rounded-lg" />
              <div>
                <Bar className="h-4 w-28" />
                <Bar className="mt-1.5 h-3 w-16" />
              </div>
            </div>
            <Bar className="mt-4 h-3 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailBody() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="flex gap-4 border-b border-border px-4 md:px-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="my-3 h-4 w-20" />
        ))}
      </div>
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Bar className="h-40 w-full rounded-xl" />
          <Bar className="h-64 w-full rounded-xl" />
        </div>
        <Bar className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}

function SplitBody() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-full divide-y divide-border border-r border-border md:w-80">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="h-9 w-9 rounded-full" />
            <div className="flex-1">
              <Bar className="h-4 w-32" />
              <Bar className="mt-1.5 h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden flex-1 flex-col justify-end gap-3 p-6 md:flex">
        <Bar className="h-10 w-2/5 rounded-2xl" />
        <Bar className="ml-auto h-10 w-1/3 rounded-2xl" />
        <Bar className="h-16 w-1/2 rounded-2xl" />
        <Bar className="mt-4 h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

function FormBody() {
  return (
    <div className="flex-1 overflow-hidden p-4 md:p-6">
      <div className="max-w-3xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Bar className="h-5 w-40" />
            <Bar className="mt-2 h-3 w-72" />
            <Bar className="mt-5 h-9 w-full rounded-lg" />
            <Bar className="mt-3 h-9 w-2/3 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
