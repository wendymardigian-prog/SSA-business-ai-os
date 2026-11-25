"use client";

import { usePathname } from "next/navigation";
import { PageSkeleton } from "@/components/page-skeleton";
import { skeletonVariantFor } from "@/lib/nav/skeleton-variant";

/**
 * El esqueleto de las pantallas del panel que no tienen `loading.tsx` propio (Clientes, Portal, Finanzas,
 * Notificaciones, Mi cuenta…): su título y una forma parecida, en vez de la misma grilla para todas.
 * Inicio conserva su grilla (tiene su propia barra).
 */
export function PanelFallbackSkeleton() {
  const variant = skeletonVariantFor(usePathname());
  if (variant !== "home") return <PageSkeleton variant={variant} />;
  return (
    <div className="p-8" aria-busy="true" aria-label="Cargando">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
              <div>
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-1.5 h-3 w-16 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="mt-4 h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
