"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { STATUS_LABELS } from "@/lib/content/status";
import { applyContentFilters, type ContentFilters, type FilterablePost } from "@/lib/content/filters";
import { FilterMenu } from "@/components/ui/filter-menu";
import type { ContentPostStatus } from "@/lib/types/database";
import type { TaxonomyTag } from "@/lib/content/taxonomy";
import { SlidersHorizontal, Users } from "lucide-react";
import { drawerHref } from "@/lib/content/drawer-url";
import { attributionTooltip } from "@/lib/content/board";
import { NetworkBadges } from "./network-badge";
import { PillarDot } from "./pillar-tag";
import { showPaidIndicator } from "@/lib/meta/content-ad-summary";

/**
 * La vista lista (F21): la misma informacion que el tablero, pero ordenable y
 * buscable. Es la que sirve cuando hay cien piezas y el kanban deja de
 * entrar en la pantalla.
 */

export interface ListRow extends FilterablePost {
  format: string | null;
  authorName: string | null;
  /** "Ana · creada el 3 oct · editada el 5 oct" (F91). */
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
  timeZone,
  showPaid = false,
}: {
  rows: ListRow[];
  filters: ContentFilters;
  /** La zona de quien mira. */
  timeZone: string;
  /** Mostrar el indicador «Pautada» y su filtro: solo para quien puede ver anuncios (A2). */
  showPaid?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

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
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
          {visible.length} de {rows.length}
        </p>
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
                    {showPaidIndicator(showPaid, row.paid) && (
                      <span
                        className="ml-2 rounded-full border border-primary-edge/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-ink"
                        title="Tiene al menos un anuncio de Meta vinculado"
                      >
                        Pautada
                      </span>
                    )}
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
                          timeZone,
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

/**
 * Los filtros de la vista lista, en la barra superior (`<PageHeader filters={…} />` de Contenido): buscar, Estado,
 * Autor, Responsable, Mes y Pauta. Todo vive en la URL (`?q=`, `?estado=`, `?autor=`, `?responsable=`, `?mes=`,
 * `?pautada=`), así que la lista lo lee de `filters` sin pasar estado de un componente a otro. `PageHeader` dibuja los
 * filtros dos veces (computadora y celular): no guardan estado propio salvo el texto a medio escribir del buscador.
 */
export function ContentListFilters({
  filters,
  authors,
  months,
  showPaid = false,
}: {
  filters: ContentFilters;
  authors: Array<{ id: string; name: string }>;
  /** Los meses que tienen algo, para el filtro de fecha (C15). */
  months: string[];
  /** El filtro «Pauta»: solo para quien puede ver anuncios (A2). */
  showPaid?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`/dashboard/content?${next.toString()}`));
  }

  const responsible = filters.responsible ?? [];
  const active = [filters.status, filters.author, filters.month, showPaid ? filters.paid : undefined].filter(Boolean).length + (responsible.length > 0 ? 1 : 0);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <ExpandableSearch
        value={filters.q ?? ""}
        onCommit={(v) => setFilter("q", v)}
        label="Buscar piezas"
        placeholder="Buscar por titulo"
        pending={pending}
      />
      {/* Un solo menú con todos los filtros de la lista: uno por campo no entraba en la barra. */}
      <FilterMenu
        label="Filtros"
        compact
        badge={active}
        active={active > 0}
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[300px]"
      >
        <ContentListFilterFields
          filters={filters}
          authors={authors}
          months={months}
          showPaid={showPaid}
          active={active}
          onSet={setFilter}
          onClear={() => {
            const next = new URLSearchParams(params.toString());
            for (const k of ["estado", "autor", "mes", "pautada", "responsable"]) next.delete(k);
            startTransition(() => router.push(`/dashboard/content?${next.toString()}`));
          }}
        />
      </FilterMenu>
    </div>
  );
}

/** Lo de adentro del menú «Filtros» de la lista (separado para poder probarlo sin abrir el menú). */
export function ContentListFilterFields({
  filters,
  authors,
  months,
  showPaid,
  active,
  onSet,
  onClear,
}: {
  filters: ContentFilters;
  authors: Array<{ id: string; name: string }>;
  months: string[];
  showPaid: boolean;
  active: number;
  onSet: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const responsible = filters.responsible ?? [];
  return (
    <div className="space-y-3 p-2">
      <Select
        label="Estado"
        value={filters.status ?? ""}
        onChange={(v) => onSet("estado", v)}
        options={(Object.keys(STATUS_LABELS) as ContentPostStatus[]).map((s) => ({
          value: s,
          label: STATUS_LABELS[s],
        }))}
      />
      <Select
        label="Autor"
        value={filters.author ?? ""}
        onChange={(v) => onSet("autor", v)}
        options={authors.map((a) => ({ value: a.id, label: a.name }))}
      />
      <Select
        label="Mes"
        value={filters.month ?? ""}
        onChange={(v) => onSet("mes", v)}
        options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
      />
      {showPaid && (
        <Select
          label="Pauta"
          value={filters.paid ?? ""}
          onChange={(v) => onSet("pautada", v)}
          options={[
            { value: "si", label: "Pautadas" },
            { value: "no", label: "No pautadas" },
          ]}
        />
      )}
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Responsable</legend>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-input p-1">
          {authors.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-accent">
              <input type="checkbox" checked={responsible.includes(a.id)} onChange={() => onSet("responsable", (responsible.includes(a.id) ? responsible.filter((r) => r !== a.id) : [...responsible, a.id]).join(","))} />
              <span className="truncate">{a.name}</span>
            </label>
          ))}
          {authors.length === 0 && <p className="px-1.5 py-1 text-[13px] text-muted-foreground">Todavía no hay personas.</p>}
        </div>
      </fieldset>
      {active > 0 && (
        <button type="button" onClick={onClear} className="h-8 w-full rounded-lg border border-border text-sm hover:bg-accent">
          Limpiar filtros
        </button>
      )}
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
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-sm"
      >
        <option value="">Todas</option>
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
