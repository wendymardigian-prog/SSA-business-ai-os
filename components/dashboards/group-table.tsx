import type { GroupRow } from "@/lib/dashboards/content";
import { sumTotals } from "@/lib/dashboards/content";

/**
 * La tabla de rendimiento agrupado (F105): por pieza, oferta, pilar, etapa del
 * embudo, red o formato.
 *
 * Tres cosas que importan:
 *
 * - **El total de abajo es la suma de las filas.** Si agrupar hiciera
 *   desaparecer publicaciones, el dashboard diria dos verdades; lo que no tiene
 *   valor va a "Sin asignar" y se suma igual.
 * - **Un guion es un dato que falta**, no un cero: una red que no entrega la
 *   metrica, o que no vincula comentarios con contactos.
 * - Las sumas de alcance e interacciones son contexto (se suman redes con
 *   unidades distintas); lo que se compara es el engagement.
 */

const NUMBER = new Intl.NumberFormat("es-AR");
const fmt = (value: number | null) => (value === null ? "—" : NUMBER.format(value));
const percent = (value: number | null) => (value === null ? "—" : `${value.toString().replace(".", ",")}%`);

export function GroupTable({
  rows,
  dimensionLabel,
  onSelect,
  selectedKey,
}: {
  rows: GroupRow[];
  dimensionLabel: string;
  /** Al tocar un grupo se filtra el dashboard por el. Sin esto, la fila no es un boton. */
  onSelect?: (row: GroupRow) => void;
  selectedKey?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        No hay publicaciones en este periodo con estos filtros.
      </p>
    );
  }

  const totals = sumTotals(rows);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">Rendimiento agrupado por {dimensionLabel.toLowerCase()}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="p-2 font-medium">{dimensionLabel}</th>
            <th scope="col" className="p-2 text-right font-medium">Publicaciones</th>
            <th scope="col" className="p-2 text-right font-medium">Piezas</th>
            <th scope="col" className="p-2 text-right font-medium">Alcance</th>
            <th scope="col" className="p-2 text-right font-medium">Interacciones</th>
            <th scope="col" className="p-2 text-right font-medium">Engag. prom.</th>
            <th scope="col" className="p-2 text-right font-medium">Engag. 7 días</th>
            <th scope="col" className="p-2 text-right font-medium">Leads</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={`border-b border-border last:border-0 ${selectedKey === row.key ? "bg-accent/40" : ""}`}
            >
              <th scope="row" className="p-2 text-left font-normal">
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(row)}
                    aria-pressed={selectedKey === row.key}
                    title={`Filtrar el dashboard por ${row.label}`}
                    className={`text-left hover:underline ${row.unassigned ? "text-muted-foreground" : ""}`}
                  >
                    {row.label}
                  </button>
                ) : (
                  <span className={row.unassigned ? "text-muted-foreground" : undefined}>{row.label}</span>
                )}
              </th>
              <td className="p-2 text-right tabular-nums">{fmt(row.posts)}</td>
              <td className="p-2 text-right tabular-nums">{row.pieces === 0 ? "—" : fmt(row.pieces)}</td>
              <td className="p-2 text-right tabular-nums">{fmt(row.reach)}</td>
              <td className="p-2 text-right tabular-nums">{fmt(row.interactions)}</td>
              <td className="p-2 text-right tabular-nums">{percent(row.avgEngagement)}</td>
              <td className="p-2 text-right tabular-nums">{percent(row.avgEngagementD7)}</td>
              <td className="p-2 text-right tabular-nums">{fmt(row.leads)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/20 font-medium">
            <th scope="row" className="p-2 text-left font-medium">Total</th>
            <td className="p-2 text-right tabular-nums">{fmt(totals.posts)}</td>
            <td className="p-2 text-right text-muted-foreground">—</td>
            <td
              className="p-2 text-right tabular-nums"
              title="Suma de lo crudo de cada publicación: es contexto, no un ranking."
            >
              {fmt(totals.reach)}
            </td>
            <td
              className="p-2 text-right tabular-nums"
              title="Suma de lo crudo de cada publicación: es contexto, no un ranking."
            >
              {fmt(totals.interactions)}
            </td>
            <td className="p-2 text-right text-muted-foreground">—</td>
            <td className="p-2 text-right text-muted-foreground">—</td>
            <td className="p-2 text-right tabular-nums">{fmt(totals.leads)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
