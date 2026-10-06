import type { IndexTone } from "@/lib/dashboards/piece-index";
import { INDEX_BASE_MIN, INDEX_HIGH, INDEX_LOW, INDEX_WINDOW_DAYS } from "@/lib/dashboards/piece-index";
import type { PerformanceRow, PiecePerformance } from "@/lib/dashboards/piece-performance";
import { platformLabel } from "@/lib/platforms";
import { NetworkBadge } from "../network-badge";

/**
 * Como le fue a la pieza, red por red (F102).
 *
 * Una fila por publicacion y una de total. Tres cosas que importan:
 *
 * - **Edad** es la de cada publicacion: un Reel de 10 dias y un Short de 3 no
 *   se miran con los numeros de hoy. Debajo de la tabla van los dos al dia de
 *   la mas joven, que es la comparacion que dice algo.
 * - **Ningun cero inventado.** Lo que la red no da es un guion, y una red que no
 *   da ninguna metrica (LinkedIn) muestra su aviso en vez de la fila de cifras.
 * - **El indice es lo que rankea**; las sumas son contexto. Por eso el indice
 *   usa color Y flecha: el color solo no llega a quien no lo distingue.
 */

const NUMBER = new Intl.NumberFormat("es-AR");
const fmt = (value: number | null) => (value === null ? "—" : NUMBER.format(value));

function dateLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone }).format(new Date(iso));
}

const TONE: Record<IndexTone, { className: string; glyph: string }> = {
  good: { className: "font-semibold text-emerald-600 dark:text-emerald-400", glyph: "▲ " },
  bad: { className: "font-semibold text-destructive", glyph: "▼ " },
  neutral: { className: "font-medium", glyph: "" },
};

function IndexCell({ index }: { index: PerformanceRow["index"] }) {
  if (index.status === "ok" && index.tone) {
    const tone = TONE[index.tone];
    return (
      <span
        className={tone.className}
        title={`Rindió ${index.label} lo normal para su red y formato (${index.comparables} publicaciones comparables)`}
      >
        {tone.glyph}
        {index.label}
      </span>
    );
  }

  const reason =
    index.status === "insufficient"
      ? `Hay ${index.comparables} publicaciones comparables y hacen falta ${INDEX_BASE_MIN}.`
      : index.status === "in_progress"
        ? "Todavía no cumplió 7 días: el número comparable se congela a esa edad."
        : "No hay dato para calcularlo.";

  return (
    <span className="text-muted-foreground" title={reason}>
      {index.label}
    </span>
  );
}

export function PiecePerformanceSection({
  performance,
  timeZone,
}: {
  performance: PiecePerformance | null;
  timeZone: string;
}) {
  if (!performance || performance.rows.length === 0) return null;

  const { rows, total, commonAge } = performance;
  const comparable = rows.filter((r) => r.atCommonAge);

  return (
    <section aria-labelledby="rendimiento" className="space-y-2">
      <h2 id="rendimiento" className="text-sm font-semibold">
        Rendimiento
      </h2>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <caption className="sr-only">Rendimiento de cada publicación de la pieza</caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">Red</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Publicado</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Edad</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Alcance</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Interacciones</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Engag. 7 días</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Índice</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Leads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.socialPostId}>
                <th scope="row" className="px-2 py-1.5 font-normal">
                  <NetworkBadge platform={row.platform} size="sm" />
                </th>
                <td className="px-2 py-1.5 text-muted-foreground">{dateLabel(row.publishedAt, timeZone)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.ageDays}</td>
                {row.notice ? (
                  <td colSpan={5} className="px-2 py-1.5 text-muted-foreground">
                    {row.notice}
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmt(row.reach)}
                      {row.reach !== null && row.reachIsViews && (
                        <span className="ml-1 text-[10px] text-muted-foreground">vistas</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.interactions)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.engagementD7 === null ? "—" : `${row.engagementD7.toString().replace(".", ",")}%`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <IndexCell index={row.index} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.leads)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20 font-medium">
            <tr>
              <th scope="row" className="px-2 py-1.5 text-left font-medium">
                Total
              </th>
              <td className="px-2 py-1.5 text-muted-foreground">
                {total.publications} {total.publications === 1 ? "publicación" : "publicaciones"}
              </td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
              <td
                className="px-2 py-1.5 text-right tabular-nums"
                title="Suma de lo crudo de cada red: es contexto, no un ranking."
              >
                {fmt(total.reach)}
              </td>
              <td
                className="px-2 py-1.5 text-right tabular-nums"
                title="Suma de lo crudo de cada red: es contexto, no un ranking."
              >
                {fmt(total.interactions)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {total.engagementD7 === null ? "—" : `${total.engagementD7.toString().replace(".", ",")}%`}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                <IndexCell
                  index={{
                    status: total.index.value === null ? "insufficient" : "ok",
                    value: total.index.value,
                    tone: total.index.tone,
                    comparables: total.index.counted,
                    median: null,
                    engagement: null,
                    label: total.index.label,
                  }}
                />
                {total.index.value !== null && total.index.total > 1 && (
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {total.index.counted} de {total.index.total} redes
                  </span>
                )}
              </td>
              <td
                className="px-2 py-1.5 text-right tabular-nums"
                title="Cada persona cuenta una vez, aunque haya comentado más de una publicación."
              >
                {fmt(total.leads)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {commonAge !== null && comparable.length >= 2 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">A la misma edad (día {commonAge}):</span>{" "}
          {comparable.map((row, i) => (
            <span key={row.socialPostId}>
              {i > 0 && " · "}
              {platformLabel(row.platform)} {fmt(row.atCommonAge?.reach ?? null)}
              {row.reachIsViews ? " vistas" : " de alcance"}, {fmt(row.atCommonAge?.interactions ?? null)} interacciones
              {row.atCommonAge?.estimated ? " (estimado)" : ""}
            </span>
          ))}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        El índice compara el engagement a 7 días contra la mediana de la misma red y formato en los{" "}
        {INDEX_WINDOW_DAYS} días anteriores: 1,0× es lo normal, desde {INDEX_HIGH.toString().replace(".", ",")}× rindió
        mucho más y por debajo de {INDEX_LOW.toString().replace(".", ",")}× rindió menos. Con menos de {INDEX_BASE_MIN}{" "}
        publicaciones comparables no se calcula.
      </p>
    </section>
  );
}
