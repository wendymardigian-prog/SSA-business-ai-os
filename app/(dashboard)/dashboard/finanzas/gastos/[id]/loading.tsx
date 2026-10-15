export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6" aria-busy="true" aria-label="Cargando el gasto">
      <div className="h-8 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
      <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}
