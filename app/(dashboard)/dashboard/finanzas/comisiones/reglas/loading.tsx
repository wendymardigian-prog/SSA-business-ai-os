export default function Loading() {
  return (
    <div className="p-4 md:p-6" aria-busy="true" aria-label="Cargando las reglas de comisión">
      <div className="mx-auto max-w-4xl">
        <div className="h-9 w-80 animate-pulse rounded-lg bg-muted" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />)}
        </div>
      </div>
    </div>
  );
}
