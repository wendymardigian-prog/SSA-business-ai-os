/** Las ejecuciones no son el lienzo: sin esto se veria el esqueleto del editor mientras cargan. */
export default function Loading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div className="h-14 flex-shrink-0 animate-pulse border-b border-border bg-muted/40" />
      <div className="flex-1 space-y-3 px-4 py-6 md:px-8">
        <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-muted/60" />
        <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
      </div>
    </div>
  );
}
