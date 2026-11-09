"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Columns3, Plus, SlidersHorizontal, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { ChannelChip } from "@/components/shared/channel-chip";
import { SearchPicker } from "@/components/sales/search-picker";
import { SaleWizard } from "@/components/sales/wizard/sale-wizard";
import { searchPiecesForSale, type PieceOption } from "@/lib/actions/sales-attribution";
import { SalesViewToggle } from "@/components/sales/sales-view-toggle";
import type { WizardConfig } from "@/components/sales/wizard/types";
import { CHANNELS, CHANNEL_LABELS, MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/contacts/taxonomy";
import { formatMoney } from "@/lib/shared/format";
import { ATTRIBUTION_TYPE_LABELS, SALE_STATUS_LABELS, SALE_STATUSES, type SaleStatus } from "@/lib/sales/labels";
import { PILLS, PILL_LABELS, countActiveSalesFilters, parseSalesFilters, salesFiltersToParams, scopeChip, type Pill, type SaleListRow, type SalesFilters } from "@/lib/sales/list";
import { saleStatusClasses } from "@/lib/sales/status-colors";
import { MODULE_CELL_TONE_CLASS, type ModuleColumn } from "@/lib/sales/module-columns";

export type SalesListRowView = SaleListRow & { contactName: string; vendedorName: string | null };

export interface SalesListData {
  rows: SalesListRowView[];
  total: number;
  page: number;
  pageSize: number;
  filters: SalesFilters;
  loadError: boolean;
  pills: Record<Pill, number>;
  hasAnySale: boolean;
  scopeAll: boolean;
  canManage: boolean;
  products: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; product_id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  timeZone: string;
  /** El titulo de la pieza del filtro `?pieza=` (null si no hay filtro o la pieza no se ve). */
  pieceTitle: string | null;
}

const ORIGIN_COLUMN_KEY = "ventas-columna-origen";

/** La columna «Origen» se puede ocultar; la eleccion vive en este navegador (puede no haber `localStorage`). */
function readOriginColumn(): boolean {
  try {
    return window.localStorage.getItem(ORIGIN_COLUMN_KEY) !== "oculta";
  } catch {
    return true;
  }
}
const originListeners = new Set<() => void>();
function writeOriginColumn(visible: boolean) {
  try {
    window.localStorage.setItem(ORIGIN_COLUMN_KEY, visible ? "visible" : "oculta");
  } catch {
    // Sin almacenamiento, la eleccion vale hasta recargar.
  }
  originListeners.forEach((l) => l());
}
function useOriginColumn(): [boolean, (visible: boolean) => void] {
  const visible = useSyncExternalStore(
    (listener) => {
      originListeners.add(listener);
      return () => originListeners.delete(listener);
    },
    readOriginColumn,
    () => true,
  );
  return [visible, writeOriginColumn];
}

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** La lista de ventas (F25). Qué se ve lo decide la base (RLS); los filtros viven en la URL. */
export function SalesList({ data, wizard, moduleColumns = [] }: { data: SalesListData; wizard: WizardConfig; moduleColumns?: ModuleColumn[] }) {
  const { rows, total, page, pageSize, filters } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showOrigin, setShowOrigin] = useOriginColumn();

  const active = countActiveSalesFilters(filters);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasProducts = wizard.catalog.length > 0;

  function go(next: Partial<SalesFilters>) {
    const merged: SalesFilters = { ...filters, ...next, page: next.page ?? 1 };
    const qs = salesFiltersToParams(merged).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const toggleStatus = (s: string) => go({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s], pill: null });
  const variantsOfProduct = filters.productId ? data.variants.filter((v) => v.product_id === filters.productId) : data.variants;
  const empty = !data.hasAnySale && active === 0 && !filters.q && !filters.pill;
  // El estado de cobro (las pastillas) tambien vive adentro de «Filtros»: cuenta para el globito.
  const menuActive = active + (filters.pill ? 1 : 0);

  // Buscar, Filtros y Columnas van en la barra de arriba (nunca una barra adentro de la pagina).
  const barFilters = empty ? undefined : (
    <>
      <ExpandableSearch
        value={filters.q ?? ""}
        onCommit={(q) => go({ q: q || null })}
        label="Buscar ventas por contacto"
        placeholder="Buscar por contacto…"
      />
      <FilterMenu
        label="Filtros"
        compact
        badge={menuActive}
        active={menuActive > 0}
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[460px]"
      >
        <div className="space-y-3 px-2.5 pb-2 pt-1">
          <p className="text-xs text-muted-foreground">{scopeChip(data.scopeAll)}</p>

          <div>
            <MenuGroupLabel>Estado de cobro</MenuGroupLabel>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estado de cobro">
              {PILLS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filters.pill === p}
                  onClick={() => go({ pill: filters.pill === p ? null : p, status: [] })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filters.pill === p ? "border-primary-edge bg-primary/10 font-medium text-primary-ink" : "border-border hover:bg-accent"}`}
                >
                  {PILL_LABELS[p]}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{data.pills[p]}</span>
                </button>
              ))}
            </div>
          </div>

          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs font-medium">Estado</legend>
            {SALE_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={filters.status.includes(s)} onChange={() => toggleStatus(s)} /> {SALE_STATUS_LABELS[s as SaleStatus]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Producto">
              <select className={selectClass} value={filters.productId ?? ""} onChange={(e) => go({ productId: e.target.value || null, variantId: null })}>
                <option value="">Todos</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Variante">
              <select className={selectClass} value={filters.variantId ?? ""} onChange={(e) => go({ variantId: e.target.value || null })}>
                <option value="">Todas</option>
                {variantsOfProduct.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Vendedor">
              <select className={selectClass} value={filters.vendedorId ?? ""} onChange={(e) => go({ vendedorId: e.target.value || null })}>
                <option value="">Todos</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Setter">
              <select className={selectClass} value={filters.setterId ?? ""} onChange={(e) => go({ setterId: e.target.value || null })}>
                <option value="">Todos</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Atribución">
              <select className={selectClass} value={filters.attributionType ?? ""} onChange={(e) => go({ attributionType: e.target.value || null })}>
                <option value="">Todas</option>
                {Object.entries(ATTRIBUTION_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Canal">
              <select className={selectClass} value={filters.channel ?? ""} onChange={(e) => go({ channel: (e.target.value || null) as SalesFilters["channel"] })}>
                <option value="">Todos</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <SearchPicker<PieceOption>
                label="Pieza de contenido"
                placeholder="Buscá por título o por código"
                search={searchPiecesForSale}
                getKey={(p) => p.id}
                renderOption={(p) => (
                  <>
                    <span className="font-medium">{p.title}</span>
                    <span className="text-xs text-muted-foreground">Código {p.code}</span>
                  </>
                )}
                selectedLabel={filters.pieceId ? (data.pieceTitle ?? "Una pieza que no podés ver") : null}
                onPick={(p) => go({ pieceId: p.id })}
                onClear={() => go({ pieceId: null })}
              />
            </div>
            <Field label="Origen (source)">
              <select className={selectClass} value={filters.utmSource ?? ""} onChange={(e) => go({ utmSource: e.target.value || null })}>
                <option value="">Todos</option>
                {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Medio (medium)">
              <select className={selectClass} value={filters.utmMedium ?? ""} onChange={(e) => go({ utmMedium: e.target.value || null })}>
                <option value="">Todos</option>
                {MEDIUMS.map((m) => <option key={m} value={m}>{MEDIUM_LABELS[m]}</option>)}
              </select>
            </Field>
            <Field label="Campaña contiene">
              <CampaignInput value={filters.utmCampaign ?? ""} onCommit={(v) => go({ utmCampaign: v || null })} />
            </Field>
            <Field label="Fechas de venta">
              <div className="flex gap-1">
                <input type="date" aria-label="Desde" className={selectClass} value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || null })} />
                <input type="date" aria-label="Hasta" className={selectClass} value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || null })} />
              </div>
            </Field>
          </div>

          {menuActive > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">{menuActive === 1 ? "1 filtro activo" : `${menuActive} filtros activos`}</span>
              <button
                type="button"
                onClick={() => go({ ...parseSalesFilters({}), q: filters.q })}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </FilterMenu>
      <FilterMenu
        label="Columnas"
        compact
        active={false}
        icon={<Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[260px]"
      >
        <MenuGroupLabel>Columnas de la tabla</MenuGroupLabel>
        <MenuOption checked={showOrigin} onSelect={() => setShowOrigin(!showOrigin)} title="Origen" description="Canal y fuente de cada venta" />
      </FilterMenu>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/ventas"
        left={<SalesViewToggle active="ventas" />}
        filters={barFilters}
        right={
          data.canManage && hasProducts ? (
            <button type="button" onClick={() => setWizardOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:px-3" aria-label="Nueva venta">
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Nueva venta</span>
            </button>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {empty ? (
          <EmptyState canManage={data.canManage} hasProducts={hasProducts} canManageCatalog={wizard.canManageCatalog} onNew={() => setWizardOpen(true)} />
        ) : (
          <>
            {data.loadError ? (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
                <p className="text-red-700 dark:text-red-300">No se pudieron cargar las ventas.</p>
                <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
                <p>No hay ventas con estos filtros.</p>
                <button type="button" onClick={() => router.push(pathname)} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                  <table className={`w-full text-sm ${showOrigin ? "min-w-[1180px]" : "min-w-[960px]"}`}>
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        {["Fecha", "Contacto", "Producto", "Monto", "Cobrado", "Pendiente", "Estado", "Vendedor", "Atribución", ...(showOrigin ? ["Origen"] : []), ...moduleColumns.map((c) => c.header)].map((h, i) => (
                          <th key={h} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i >= 3 && i <= 5 ? "text-right" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/30">
                          <td className="whitespace-nowrap px-3 py-2"><Link href={`/dashboard/ventas/${r.id}`} className="underline-offset-2 hover:underline">{formatDate(r.saleDate)}</Link></td>
                          <td className="max-w-[200px] truncate px-3 py-2"><Link href={`/dashboard/contacts/${r.contactId}`} className="font-medium underline-offset-2 hover:underline">{r.contactName}</Link></td>
                          <td className="max-w-[220px] truncate px-3 py-2">{r.product}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(r.finalAmount)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.paid)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(r.pending)}</td>
                          <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                          <td className="whitespace-nowrap px-3 py-2">{r.vendedorName ?? "—"}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground" title={r.attribution}>{r.attribution}</td>
                          {showOrigin && (
                            <td className="max-w-[260px] px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <ChannelChip channel={r.origin.channel} />
                                <span className="min-w-0 truncate text-xs" title={r.origin.summary}>{r.origin.channel === "direct" || r.origin.channel === null ? <span className="text-muted-foreground">{r.origin.summary}</span> : r.origin.summary}</span>
                              </div>
                            </td>
                          )}
                          {moduleColumns.map((c) => {
                            const cell = c.cells[r.id];
                            return (
                              <td key={c.key} className={`max-w-[240px] truncate px-3 py-2 text-xs ${cell?.tone ? MODULE_CELL_TONE_CLASS[cell.tone] : "text-muted-foreground"}`}>
                                {cell?.href ? <Link href={cell.href} className="underline-offset-2 hover:underline">{cell.label}</Link> : cell?.label ?? "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-2 md:hidden">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/dashboard/ventas/${r.id}`} className="block rounded-xl border border-border p-3 hover:bg-muted/30">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.contactName}</p>
                            <p className="truncate text-xs text-muted-foreground">{r.product} · {formatDate(r.saleDate)}</p>
                          </div>
                          <StatusChip status={r.status} />
                        </div>
                        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div><dt className="text-muted-foreground">Monto</dt><dd className="font-medium tabular-nums">{formatMoney(r.finalAmount)}</dd></div>
                          <div><dt className="text-muted-foreground">Cobrado</dt><dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(r.paid)}</dd></div>
                          <div><dt className="text-muted-foreground">Pendiente</dt><dd className="font-medium tabular-nums">{formatMoney(r.pending)}</dd></div>
                        </dl>
                        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{r.attribution}</p>
                        {showOrigin && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <ChannelChip channel={r.origin.channel} />
                            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{r.origin.summary}</span>
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>

                <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación">
                  <span className="text-xs text-muted-foreground">{total} {total === 1 ? "venta" : "ventas"}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })} aria-label="Página anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                    <span className="text-xs">Página {page} de {pages}</span>
                    <button type="button" disabled={page >= pages} onClick={() => go({ page: page + 1 })} aria-label="Página siguiente" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                  </div>
                </nav>
              </>
            )}
          </>
        )}
      </div>

      {wizardOpen && <SaleWizard config={wizard} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * «Campaña contiene»: se aplica con Enter, al salir del campo o un rato despues
 * de dejar de escribir. Esta adentro del menu de filtros, que un clic afuera
 * cierra sin que el campo llegue a perder el foco; el temporizador no se cancela
 * al desmontar, asi lo escrito no se pierde.
 */
function CampaignInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Si lo aplicado cambia desde afuera (limpiar filtros), el campo lo sigue.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next.trim() !== value) onCommit(next.trim());
  }
  return (
    <input
      className={selectClass}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), 800);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
        }
      }}
    />
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${saleStatusClasses(status)}`}>{SALE_STATUS_LABELS[status as SaleStatus] ?? status}</span>;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function EmptyState({ canManage, hasProducts, canManageCatalog, onNew }: { canManage: boolean; hasProducts: boolean; canManageCatalog: boolean; onNew: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-3 text-center">
      <p className="text-sm font-medium">Todavía no hay ventas</p>
      <p className="text-xs text-muted-foreground">Cuando cargues la primera, la vas a ver acá con su plan de pagos y su estado.</p>
      {!hasProducts ? (
        canManageCatalog ? (
          <Link href="/dashboard/settings/productos" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Creá tu primer producto</Link>
        ) : (
          <p className="text-xs text-muted-foreground">Pedile a un admin que cargue un producto con su precio.</p>
        )
      ) : (
        canManage && (
          <button type="button" onClick={onNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" aria-hidden /> Nueva venta
          </button>
        )
      )}
    </div>
  );
}
