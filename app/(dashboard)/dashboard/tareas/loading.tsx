/** El esqueleto de Tareas mientras llegan los datos. */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Cargando tareas">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-6">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 w-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-11 animate-pulse border-t border-border/70 bg-muted/40 first:border-t-0" />)}
        </div>
      </div>
    </div>
  );
}
