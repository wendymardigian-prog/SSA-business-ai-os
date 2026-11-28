// @plantilla-quitar(servicios)
/**
 * «Descargas» en la ficha del servicio (00538): qué archivos de las clases bajó esta persona desde el portal y cuándo.
 * Solo muestra; lo anota SSA cuando firma el link (`/api/portal/file`).
 */
export type ResourceDownloadRow = { id: string; resource_name: string | null; lesson_title: string | null; downloaded_at: string };

export function ServiceDownloadsBlock({ rows, timeZone }: { rows: ResourceDownloadRow[]; timeZone: string }) {
  const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
  return (
    <section aria-labelledby="record-descargas" className="space-y-2 rounded-xl border border-border p-3">
      <h3 id="record-descargas" className="text-sm font-semibold">
        Descargas
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no descargó ningún archivo.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
              <span className="min-w-0 break-words">
                {r.resource_name ?? "Archivo"}
                {r.lesson_title && <span className="text-xs text-muted-foreground"> · {r.lesson_title}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{fmt.format(new Date(r.downloaded_at))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
