"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart2, Download } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { Popover } from "@/components/ui/popover";
import { buildCrmRows, countByStatus, filterByParent, filterByStatus, showNoAdSignalNotice, totalFootnote, totalReachOptions, totalRowDetailed, type CrmLevel, type CrmRow, type DistinctLeads, type ParentScope, type StatusFilter } from "@/lib/dashboards/ads-crm";
import { GROUP_LABEL, GROUP_ORDER, GROUP_TIP, REACH_SUM_NOTE, formatCell, isReachColumn, needsLiveReach, reachAheadOfSync, type ColumnDef, type ColumnGroup } from "@/lib/dashboards/ads-crm-columns";
import { visibleColumns } from "@/lib/dashboards/ads-columns";
import { csvFilename, toCsv } from "@/lib/dashboards/ads-crm-csv";
import { canOpenCell } from "@/lib/dashboards/ads-crm-detail";
import { ADS_GUIDE_STEPS, ADS_NO_SIGNAL_MESSAGE, ADS_URL_PARAMS } from "@/lib/dashboards/ads-guide";
import { loadCrmDistinctTotals, loadCrmObjectReach, type CrmReachResult } from "@/lib/actions/ads-crm";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";
import type { AdsRow, AdsTotalsWithSource } from "@/lib/dashboards/ads";
import { ColumnsMenu } from "./columns-menu";
import { CrmCellPanel, type CellTarget } from "./crm-cell-panel";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import { useColumnPrefs } from "./use-column-prefs";
import { StatusDot } from "./status-dot";

/**
 * La tabla «Meta vs CRM» de una pestaña (campañas, conjuntos o anuncios): lo que dice Meta, lo que dicen los dos
 * y lo que paso en el CRM, en grupos de color. Todas las cuentas salen de `lib/dashboards/ads-crm.ts` y las
 * columnas de `ads-crm-columns.ts`; esto solo las dibuja.
 *
 * - Un clic en una fila lleva al detalle del objeto, o abre su menu si la pantalla pasa `rowActions` (Anuncios). Un clic en un
 *   NUMERO de leads, agendas o ventas (por fila y en el total) abre el panel con las personas o registros que lo forman (`CrmCellPanel`).
 * - `scope` muestra solo los hijos de una campaña o un conjunto: el total deja de ser el de la cuenta y se calcula sobre lo que se ve.
 * - La primera columna queda fija al desplazarse de costado; la pagina nunca hace scroll horizontal (la tabla se desplaza adentro).
 * - El total suma lo sumable, cuenta a cada persona UNA vez en «Leads totales» y calcula los cocientes sobre los totales.
 * - Alcance y Frec. se le piden a Meta recien cuando estan a la vista. Lo que Meta no dio es la suma de los dias y se ve con «≈».
 */

const FIRST_LABEL: Record<CrmLevel, string> = { campaign: "Campaña", adset: "Ad Set", ad: "Anuncio" };
const EMPTY_LABEL: Record<CrmLevel, string> = {
  campaign: "Sin campañas en este período",
  adset: "Sin ad sets en este período",
  ad: "Sin anuncios en este período",
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "paused", label: "Pausados" },
];

// Cada grupo tiene su color en un borde y un fondo suave; el texto usa los tokens del tema (claro y oscuro).
const GROUP_STYLE: Record<ColumnGroup, { head: string; cell: string }> = {
  info: { head: "border-t-2 border-border bg-muted/40", cell: "" },
  meta: { head: "border-t-2 border-sky-500 bg-sky-500/10", cell: "" },
  metaVsCrm: { head: "border-t-2 border-amber-500 bg-amber-500/10", cell: "bg-amber-500/[0.04]" },
  crm: { head: "border-t-2 border-emerald-500 bg-emerald-500/10", cell: "" },
};

const TD = "px-2 py-2 text-right text-foreground whitespace-nowrap";
const NUMBER_BUTTON = "cursor-pointer rounded px-1 underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ColumnHeader({ column }: { column: ColumnDef }) {
  const left = column.kind === "text" || column.kind === "status" || column.kind === "link";
  return (
    <th scope="col" className={`whitespace-nowrap px-2 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground ${left ? "text-left" : "text-right"}`}>
      <Tip
        align="center"
        content={
          <>
            <p className="mb-1 font-semibold text-foreground">{column.tip.title}</p>
            <p className="text-muted-foreground">{column.tip.body}</p>
          </>
        }
      >
        <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {column.label}
        </span>
      </Tip>
    </th>
  );
}

function FirstCell({ row, level }: { row: CrmRow; level: CrmLevel }) {
  // «campaña · conjunto» debajo del nombre: en un anuncio las dos, en un conjunto solo la campaña.
  const trail = (level === "ad" ? [row.campaignName, row.adsetName] : level === "adset" ? [row.campaignName] : []).filter((x): x is string => !!x);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {level === "ad" && (
        // La miniatura es una URL firmada de Storage con vencimiento: next/image no la puede optimizar. Carga lazy.
        row.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage con vencimiento.
          <img src={row.thumbnailUrl} alt="" title={row.creativeTitle ?? undefined} loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-border object-cover" />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-border" aria-hidden title={row.creativeTitle ?? "Sin miniatura todavía"} />
        )
      )}
      <div className="min-w-0">
        <p className="max-w-[170px] truncate font-medium text-foreground sm:max-w-[240px]" title={row.name ?? row.objectId}>
          {row.name || row.objectId}
        </p>
        {trail.length > 0 && (
          <p className="max-w-[170px] truncate text-[11px] text-muted-foreground sm:max-w-[240px]" title={trail.join(" · ")}>
            {trail.join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusCell({ row }: { row: CrmRow }) {
  if (row.effectiveStatus) return <span className="text-xs"><StatusDot status={row.effectiveStatus} /></span>;
  return <span className="text-xs text-muted-foreground" title="El estado llega al sincronizar el catálogo de Meta">Sin estado</span>;
}

/** Una celda segun su tipo: numero (con su boton si se puede abrir), texto, estado o enlace. */
function Cell({ column, row, currency, onOpen, titleNote, reachPending }: { column: ColumnDef; row: CrmRow; currency: string | null; onOpen?: () => void; titleNote?: string; reachPending: boolean }) {
  // Mientras Meta responde no se muestra la suma: un numero que despues cambia se lee como el dato real.
  if (reachPending && isReachColumn(column.id) && row.reach !== null) return <span aria-label="Cargando" title="Preguntándole a Meta">…</span>;
  if (isReachColumn(column.id) && row.reachIsSum) return <span title={REACH_SUM_NOTE}>{formatCell(column, row, currency)}</span>;
  if (column.kind === "status") return row.objectId === "total" ? <span>—</span> : <StatusCell row={row} />;
  if (column.kind === "link") {
    const href = column.href?.(row);
    if (!href) return <span>—</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary-ink underline underline-offset-4">
        Ver
      </a>
    );
  }
  const text = formatCell(column, row, currency);
  if (column.kind !== "text" && canOpenCell(column.cell, column.value(row)) && onOpen) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} title={titleNote} aria-label={`${column.label}: ${text}. Ver el detalle`} className={NUMBER_BUTTON}>
        {text}
      </button>
    );
  }
  return <span title={titleNote}>{text}</span>;
}

/** Por que se ve algun «≈»: Meta no respondio, el periodo es muy largo o faltan algunas filas en su respuesta. */
function ReachSumNotice({ result }: { result: CrmReachResult | null }) {
  const why = !result || result.ok ? "Meta no dio el alcance único de algunas filas." : result.reason === "period_too_long" ? result.error : `No pude leer el alcance único de Meta: ${result.error}`;
  return (
    <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      {why} Lo marcado con «≈» es la suma de los días: cuenta dos veces a quien vio el anuncio en días distintos, y por eso la frecuencia queda más baja.
    </p>
  );
}

function NoSignalNotice() {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <span>{ADS_NO_SIGNAL_MESSAGE}</span>
      <Popover label="Cómo configurarlo" trigger={<span className="font-medium underline underline-offset-4">Cómo configurarlo</span>} triggerClassName="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" panelClassName="w-80 space-y-2 text-xs" align="start">
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          {ADS_GUIDE_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <code className="block break-all rounded-md bg-muted p-2 text-[11px] text-foreground">{ADS_URL_PARAMS}</code>
        <p className="text-[11px] text-muted-foreground">La guía completa está en docs/atribucion.md («Guía: parámetros de URL para los anuncios»).</p>
      </Popover>
    </div>
  );
}

export function CrmLevelTable({
  level,
  rows,
  totals,
  crm,
  currency,
  hrefOf,
  scope = null,
  rowActions,
}: {
  level: CrmLevel;
  /** Las filas de metricas del periodo (todos los niveles). */
  rows: AdsRow[];
  /** Los totales de la cuenta (con el alcance unico real). */
  totals: AdsTotalsWithSource;
  crm: CrmTableData;
  currency: string | null;
  hrefOf: (objectId: string) => string;
  /** Solo los hijos de esta campaña o conjunto. */
  scope?: ParentScope | null;
  /** Con esto, un clic en una fila abre un menu en vez de llevar al detalle. */
  rowActions?: (row: CrmRow) => RowAction[];
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useColumnPrefs(level);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [target, setTarget] = useState<CellTarget | null>(null);
  const [menu, setMenu] = useState<{ row: CrmRow; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const columns = visibleColumns(prefs, level);

  // El alcance unico: un pedido por nivel y periodo, solo si se ve (las dos columnas estan ocultas por defecto y cada consulta
  // gasta cupo de Meta). Un fallo tambien se recuerda: no se reintenta en cada cambio de pestaña.
  const wantsReach = needsLiveReach(columns);
  const reachKey = `${level}|${crm.adAccountId}|${crm.since}|${crm.until}`;
  const [reachResults, setReachResults] = useState<Record<string, CrmReachResult>>({});
  const reachResult = reachResults[reachKey] ?? null;
  const reachAnswered = reachResult !== null;
  useEffect(() => {
    if (!wantsReach || reachAnswered || !crm.adAccountId) return;
    let cancelled = false;
    const remember = (result: CrmReachResult) => {
      if (!cancelled) setReachResults((before) => ({ ...before, [reachKey]: result }));
    };
    loadCrmObjectReach({ level, since: crm.since, until: crm.until, adAccountId: crm.adAccountId, objectIds: null })
      .then(remember)
      .catch(() => remember({ ok: false, reason: "unavailable", error: "no hubo respuesta" }));
    return () => {
      cancelled = true;
    };
  }, [wantsReach, reachAnswered, reachKey, level, crm.adAccountId, crm.since, crm.until]);
  const reachPending = wantsReach && !reachAnswered && Boolean(crm.adAccountId);
  const liveReach = reachResult?.ok ? reachResult.byObject : null;
  const liveAccount = reachResult?.ok ? reachResult.account : null;

  const all = useMemo(
    () => filterByParent(buildCrmRows({ rows, level, metrics: crm.metrics[level], catalog: crm.catalog[level], adLinks: crm.adLinks, liveReach }), scope),
    [rows, level, crm.metrics, crm.catalog, crm.adLinks, liveReach, scope],
  );
  const shown = useMemo(() => filterByStatus(all, filter), [all, filter]);
  const counts = useMemo(() => countByStatus(all), [all]);

  // Las personas DISTINTAS: con todos los objetos vienen en la misma consulta que las filas. Con un filtro de estado o de padre hay que
  // pedir las de los objetos que se ven (una sola vez por filtro, y solo si hace falta).
  const subset = filter !== "all" || scope !== null;
  const shownIds = useMemo(() => shown.map((r) => r.objectId), [shown]);
  const [filtered, setFiltered] = useState<{ key: string; distinct: DistinctLeads } | null>(null);
  const filterKey = `${level}|${subset}|${shownIds.join(",")}`;
  useEffect(() => {
    if (!subset || shownIds.length === 0 || !crm.adAccountId) return;
    let cancelled = false;
    void loadCrmDistinctTotals({ level, since: crm.since, until: crm.until, adAccountId: crm.adAccountId, objectIds: shownIds }).then((res) => {
      if (!cancelled && res.ok) setFiltered({ key: filterKey, distinct: res.distinct });
    });
    return () => {
      cancelled = true;
    };
  }, [subset, filterKey, level, shownIds, crm.adAccountId, crm.since, crm.until]);

  const distinct: DistinctLeads | null = !subset ? crm.distinct[level] : filtered?.key === filterKey ? filtered.distinct : null;
  // El alcance de la cuenta solo corresponde al total cuando se ven todos los objetos: con un filtro o un padre, el total queda sin alcance.
  const { row: total, leadsTotalIsSum } = useMemo(
    () =>
      totalRowDetailed(shown, {
        ...totalReachOptions({ subset, liveAccount, totals }),
        distinctLeads: distinct,
      }),
    [shown, subset, totals, liveAccount, distinct],
  );

  const groups = GROUP_ORDER.map((group) => ({ group, columns: columns.filter((c) => c.group === group) })).filter((g) => g.columns.length > 0);
  const noSignal = !crm.error && all.length > 0 && showNoAdSignalNotice(total);

  const exportCsv = () => {
    const csv = toCsv({ firstColumnLabel: FIRST_LABEL[level], columns, rows: shown, total });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(level, crm.since, crm.until);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const open = (row: CrmRow, column: ColumnDef) => {
    if (!column.cell) return;
    const isTotal = row.objectId === "total";
    setTarget({ metric: column.cell, objectId: isTotal ? null : row.objectId, objectName: isTotal ? null : row.name, objectIds: isTotal && subset ? shownIds : null });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Estado" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label} · {counts[value]}
            </button>
          ))}
        </div>

        {crm.unmatchedCount > 0 && (
          <Link href="/dashboard/dashboards/ads/sin-vincular" className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20">
            {crm.unmatchedCount} sin vincular
          </Link>
        )}

        <div className="ml-auto flex items-center gap-2">
          {crm.canExport === true && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={shown.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Exportar CSV</span>
            <span className="sr-only sm:hidden">Exportar CSV</span>
          </button>
          )}
          <ColumnsMenu prefs={prefs} onChange={setPrefs} level={level} />
        </div>
      </div>

      {crm.error && (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          No pude leer los datos del CRM, así que se muestra solo lo que dice Meta. Probá de nuevo en un rato.
        </p>
      )}
      {noSignal && <NoSignalNotice />}
      {wantsReach && !reachPending && [...shown, total].some((row) => row.reachIsSum) && <ReachSumNotice result={reachResult} />}
      {wantsReach && !reachPending && [...shown, total].some(reachAheadOfSync) && (
        <p className="text-xs text-muted-foreground">
          Donde el alcance supera a las impresiones, las dos cifras no son del mismo momento: Alcance y Frec. se le preguntan a Meta ahora, y el resto de la fila viene de la última sincronización. Se emparejan en la próxima.
        </p>
      )}
      {crm.scopeLimited && <p className="text-xs text-muted-foreground">Ves los leads, agendas y ventas de tu alcance.</p>} {/* @plantilla-quitar(ventas) */}
      {/* @plantilla-sin(ventas): {crm.scopeLimited && <p className="text-xs text-muted-foreground">Ves los leads y las agendas de tu alcance.</p>} */}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-40" aria-hidden />
          {all.length > 0 ? "No hay objetos con ese estado en este período" : scope ? "No hay nada de esta selección en este período" : EMPTY_LABEL[level]}
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card" />
                {groups.map(({ group, columns: cols }) => (
                  <th key={group} colSpan={cols.length} scope="colgroup" className={`px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground ${GROUP_STYLE[group].head}`}>
                    <Tip align="start" content={<p className="text-muted-foreground">{GROUP_TIP[group]}</p>}>
                      <span tabIndex={0} className="cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{GROUP_LABEL[group]}</span>
                    </Tip>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border">
                <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {FIRST_LABEL[level]}
                </th>
                {columns.map((column) => (
                  <ColumnHeader key={column.id} column={column} />
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.objectId}
                  onClick={(e) => (rowActions ? setMenu({ row, x: e.clientX, y: e.clientY }) : router.push(hrefOf(row.objectId)))}
                  className="group cursor-pointer border-b border-border/50 hover:bg-muted/30"
                >
                  <td className="sticky left-0 z-[1] bg-card px-2 py-2 group-hover:bg-muted">
                    {rowActions ? (
                      <button
                        type="button"
                        aria-haspopup="menu"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenu({ row, x: rect.left, y: rect.bottom });
                        }}
                        className="block w-full rounded text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <FirstCell row={row} level={level} />
                      </button>
                    ) : (
                      <Link href={hrefOf(row.objectId)} onClick={(e) => e.stopPropagation()} className="block hover:underline">
                        <FirstCell row={row} level={level} />
                      </Link>
                    )}
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className={`${TD} ${column.kind === "text" || column.kind === "status" || column.kind === "link" ? "text-left" : ""} ${GROUP_STYLE[column.group].cell}`}>
                      <Cell column={column} row={row} currency={currency} onOpen={() => open(row, column)} reachPending={reachPending} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="sticky left-0 z-[1] bg-card px-2 py-2 text-foreground">Total</td>
                {columns.map((column) => (
                  <td key={column.id} className={`${TD} ${column.kind === "text" || column.kind === "status" || column.kind === "link" ? "text-left" : ""} ${column.id === "spend" ? "text-primary-ink" : ""}`}>
                    <Cell
                      column={column}
                      row={total}
                      currency={currency}
                      onOpen={() => open(total, column)}
                      reachPending={reachPending}
                      titleNote={column.id === "leadsTotal" && leadsTotalIsSum ? "Puede contar dos veces a quien tocó varios anuncios" : undefined}
                    />
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">{totalFootnote(leadsTotalIsSum)}</p>

      {menu && rowActions && (
        <RowActionsMenu label={menu.row.name || menu.row.objectId} actions={rowActions(menu.row)} x={menu.x} y={menu.y} onClose={closeMenu} />
      )}

      {target && (
        <CrmCellPanel
          key={`${target.metric}:${target.objectId ?? "total"}`}
          target={target}
          level={level}
          since={crm.since}
          until={crm.until}
          adAccountId={crm.adAccountId}
          currency={currency}
          timeZone={crm.timeZone ?? "UTC"}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
