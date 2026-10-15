export default function Loading() {
  return (
    <div className="p-4 md:p-6" aria-busy="true" aria-label="Cargando comisiones">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[72px] animate-pulse rounded-xl bg-muted/60" />)}
      </div>
      <div className="mt-4 h-9 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/60" />)}
      </div>
    </div>
  );
}
