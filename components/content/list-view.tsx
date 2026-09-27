"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { STATUS_LABELS } from "@/lib/content/status";
import { applyContentFilters, type ContentFilters, type FilterablePost } from "@/lib/content/filters";
import type { ContentPostStatus } from "@/lib/types/database";
import { NetworkBadges } from "./network-badge";

/**
 * La vista lista (F21): la misma informacion que el tablero, pero ordenable y
 * buscable. Es la que sirve cuando hay cien piezas y el kanban deja de
 * entrar en la pantalla.
 */

export interface ListRow extends FilterablePost {
  format: string | null;
  authorName: string | null;
  /** La fecha mas temprana de sus redes. */
  firstAt: string | null;
}

export function ContentList({
  rows,
  filters,
  authors,
  platforms,
}: {
  rows: ListRow[];
  filters: ContentFilters;
  authors: Array<{ id: string; name: string }>;
  platforms: string[];
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
          label="Red"
          value={filters.platform ?? ""}
          onChange={(v) => setFilter("red", v)}
          options={platforms.map((p) => ({ value: p, label: p }))}
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
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">Fecha</th>
                <th className="hidden py-2 font-medium md:table-cell">Autor</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/dashboard/content/${row.id}`} className="font-medium hover:underline">
                      {row.title}
                    </Link>
                    {row.format && (
                      <span className="ml-2 text-xs text-muted-foreground">{row.format}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    <NetworkBadges platforms={row.platforms} />
                  </td>
                  <td className="py-2 pr-3 text-xs">{STATUS_LABELS[row.status]}</td>
                  <td className="hidden py-2 pr-3 text-xs text-muted-foreground sm:table-cell">
                    {row.firstAt
                      ? new Date(row.firstAt).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
                  </td>
                  <td className="hidden py-2 text-xs text-muted-foreground md:table-cell">
                    {row.authorName ?? "—"}
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
