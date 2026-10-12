export default function Loading() {
  return (
    <div className="p-4 md:p-6" aria-busy="true" aria-label="Cargando ventas">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/60" />)}
      </div>
    </div>
  );
}
