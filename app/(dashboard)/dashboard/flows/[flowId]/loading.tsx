/**
 * El editor de flows ocupa la pantalla entera y no tiene la barra de titulo:
 * mientras carga, solo el lienzo en gris (sin esto se veia el esqueleto de la
 * lista de flows, que vive un nivel arriba).
 */
export default function Loading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div className="h-14 flex-shrink-0 animate-pulse border-b border-border bg-muted/40" />
      <div className="flex-1 animate-pulse bg-muted/20" />
    </div>
  );
}
