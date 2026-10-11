export default function Loading() {
  return (
    <div className="space-y-4 p-4 md:p-6" aria-busy="true" aria-label="Cargando la venta">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}
