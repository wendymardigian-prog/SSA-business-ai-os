/**
 * Los esqueletos de carga del dashboard de anuncios.
 *
 * Solo dibujo: marcan donde va a caer cada cosa para que la pantalla no
 * salte cuando llegan los datos.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden />;
}

export function KpiSkeleton({ cols = 8 }: { cols?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-4 gap-y-3 lg:grid-cols-8">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="space-y-2 px-2 sm:px-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-full max-w-20" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = "h-48" }: { height?: string }) {
  return <Skeleton className={`w-full ${height} rounded-lg`} />;
}

export function SectionSkeleton({ rows = 4, height = "h-4" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`w-full ${height}`} />
      ))}
    </div>
  );
}

export function CardSkeleton({ height = "h-40" }: { height?: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className={`w-full ${height}`} />
    </div>
  );
}

/** El dashboard entero, para el `loading.tsx` de la ruta. */
export function AdsPageSkeleton() {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-4 sm:p-6" role="status" aria-label="Cargando el dashboard de anuncios">
      <Skeleton className="h-3 w-20" />
      <KpiSkeleton />
      <CardSkeleton height="h-72" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardSkeleton height="h-72" />
        </div>
        <CardSkeleton height="h-72" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <CardSkeleton height="h-48" />
    </div>
  );
}
