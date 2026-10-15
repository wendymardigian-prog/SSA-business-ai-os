export default function Loading() {
  return (
    <div className="p-4 md:p-6" aria-busy="true" aria-label="Cargando gastos recurrentes">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="mt-4 h-16 animate-pulse rounded-xl bg-muted/60" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />)}
      </div>
    </div>
  );
}
