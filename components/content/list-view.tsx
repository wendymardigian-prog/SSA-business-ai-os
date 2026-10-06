"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { STATUS_LABELS } from "@/lib/content/status";
import { applyContentFilters, type ContentFilters, type FilterablePost } from "@/lib/content/filters";
import type { ContentPostStatus } from "@/lib/types/database";
import type { TaxonomyTag } from "@/lib/content/taxonomy";
import { Users } from "lucide-react";
import { drawerHref } from "@/lib/content/drawer-url";
import { attributionTooltip } from "@/lib/content/board";
import { NetworkBadges } from "./network-badge";
import { PillarDot } from "./pillar-tag";

/**
 * La vista lista (F21): la misma informacion que el tablero, pero ordenable y
 * buscable. Es la que sirve cuando hay cien piezas y el kanban deja de
 * entrar en la pantalla.
 */

export interface ListRow extends FilterablePost {
  format: string | null;
  authorName: string | null;
  /** "Wendy · creada el 3 oct · editada el 5 oct" (F91). */
  authorship: string | null;
  /** El pilar, para reconocerla de un vistazo (F91). */
  pillar: TaxonomyTag | null;
  /** La fecha mas temprana de sus redes. */
  firstAt: string | null;
  /** Si ya tiene el guion escrito (C15). */
  hasCopy: boolean;
  /** Contactos con esta pieza como primer toque; null = no se muestra (F101). */
  attributedContacts?: number | null;
  /** Una idea todavia sin decidir, para que la lista muestre TODO (C15). */
  isIdea?: boolean;
}

export function ContentList({
  rows,
  filters,
  authors,
  months,
}: {
  rows: ListRow[];
  filters: ContentFilters;
  authors: Array<{ id: string; name: string }>;
  /** Los meses que tienen algo, para el filtro de fecha (C15). */
  months: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/dashboard/content?${next.toString()}`);
  }

  const visible = applyContentFilters(rows, filters);

  /** Una idea o una pieza se abren en el drawer, sin salir de la lista. */
  function open(row: ListRow) {
    router.push(
      drawerHref(new URLSearchParams(params.toString()), { kind: row.isIdea ? "idea" : "piece", id: row.id }),
      { scroll: false },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-6">
        <input
          type="search"
          defaultValue={filters.q ?? ""}
          onChange={(e) => setFilter("q", e.target.value)}
          placeholder="Buscar por titulo"
          aria-label="Buscar piezas"
          className="h-8 min-w-48 flex-1 rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs"
        />
        <Select
          label="Estado"
          value={filters.status ?? ""}
          onChange={(v) => setFilter("estado", v)}
          options={(Object.keys(STATUS_LABELS) as ContentPostStatus[]).map((s) => ({
            value: s,
            label: STATUS_LABELS[s],
          }))}
        />
        <Select
          label="Autor"
          value={filters.author ?? ""}
          onChange={(v) => setFilter("autor", v)}
          options={authors.map((a) => ({ value: a.id, label: a.name }))}
        />
        <Select
          label="Mes"
          value={filters.month ?? ""}
          onChange={(v) => setFilter("mes", v)}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
        />
        <span className="text-xs text-muted-foreground">
          {visible.length} de {rows.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "Todavia no hay contenido. Crea la primera pieza desde el boton de arriba."
              : "Ninguna pieza coincide con esos filtros."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Titulo</th>
                <th className="py-2 pr-3 font-medium">Redes</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">Guion</th>
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">Fecha</th>
                <th className="hidden py-2 pr-3 font-medium lg:table-cell">Contactos</th>
                <th className="hidden py-2 font-medium md:table-cell">Autor</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                // La fila entera es clickeable: apuntarle al título en una
                // tabla de cien filas es una puntería que nadie tiene (C15).
                <tr
                  key={row.id}
                  data-card-id={`${row.isIdea ? "idea" : "piece"}-${row.id}`}
                  tabIndex={0}
                  aria-label={`Abrir ${row.title}`}
                  onClick={() => open(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(row);
                    }
                  }}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <td className="py-2 pr-3">
                    <span className="font-medium">{row.title}</span>
                    {row.format && (
                      <span className="ml-2 text-xs text-muted-foreground">{row.format}</span>
                    )}
                    {row.pillar && <PillarDot tag={row.pillar} />}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {row.isIdea ? <span>—</span> : <NetworkBadges platforms={row.platforms} />}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {row.isIdea ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wide">
                        Idea
                      </span>
                    ) : (
                      STATUS_LABELS[row.status]
                    )}
                  </td>
                  <td className="hidden py-2 pr-3 text-xs sm:table-cell">
                    {row.isIdea ? (
                      <span className="text-muted-foreground">—</span>
                    ) : row.hasCopy ? (
                      <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    ) : (
                      <span className="text-muted-foreground">Falta</span>
                    )}
                  </td>
                  <td className="hidden py-2 pr-3 text-xs text-muted-foreground sm:table-cell">
                    {row.firstAt
                      ? new Date(row.firstAt).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "short",
                        })
                      : "Sin fecha"}
                  </td>
                  <td className="hidden py-2 pr-3 text-xs lg:table-cell">
                    {row.attributedContacts === null || row.attributedContacts === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 tabular-nums"
                        title={attributionTooltip(row.attributedContacts)}
                      >
                        <Users className="h-3 w-3 text-muted-foreground" aria-hidden />
                        {row.attributedContacts}
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2 text-xs text-muted-foreground md:table-cell">
                    {row.authorship ?? row.authorName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
      >
        <option value="">{label}: todas</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}
