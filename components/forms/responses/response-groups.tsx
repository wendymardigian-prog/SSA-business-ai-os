"use client";

import { ChevronRight } from "lucide-react";
import type { GroupCount } from "@/lib/forms/response-index";

const NUMBER = new Intl.NumberFormat("es-AR");
const percent = (value: number) => `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

/**
 * Cuántas respuestas hay de cada país, fuente, medio, campaña o contenido.
 *
 * Cada respuesta cae en UN grupo, así que el total de abajo es la suma de las filas (lo que no
 * tiene dato va a «Sin dato» y cuenta igual). Tocar un grupo muestra esas respuestas.
 */
export function ResponseGroups({
  groups,
  dimensionLabel,
  onSelect,
}: {
  groups: GroupCount[];
  dimensionLabel: string;
  onSelect: (group: GroupCount) => void;
}) {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const max = Math.max(1, ...groups.map((g) => g.count));

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Respuestas agrupadas por {dimensionLabel.toLowerCase()}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{dimensionLabel}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Respuestas</th>
            <th scope="col" className="px-3 py-2 text-right font-medium sm:w-[40%] sm:text-left">%</th>
            <th scope="col" className="hidden w-8 px-2 py-2 sm:table-cell"><span className="sr-only">Ver</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => (
            <tr key={g.value} className="group cursor-pointer hover:bg-muted/30" onClick={() => onSelect(g)}>
              <td className="max-w-[20rem] px-3 py-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(g);
                  }}
                  className="block max-w-full truncate text-left underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`Ver las respuestas de ${g.label}`}
                >
                  {g.label}
                </button>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{NUMBER.format(g.count)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {/* En el celular no entra: queda el número. */}
                  <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(g.count / max) * 100}%` }} />
                  </div>
                  <span className="ml-auto w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{percent(g.pct)}</span>
                </div>
              </td>
              <td className="hidden px-2 py-2 text-muted-foreground sm:table-cell">
                <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/30 text-sm font-medium">
          <tr>
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{NUMBER.format(total)}</td>
            <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{total ? "100 %" : "—"}</td>
            <td className="hidden sm:table-cell" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
