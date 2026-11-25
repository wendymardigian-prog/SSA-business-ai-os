"use client";

import Link from "next/link";
import type { CategoryGroup } from "@/lib/calls/catalog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronLeft, ChevronRight, Link2, Loader2, Pencil, Phone, Plus, RefreshCw, SlidersHorizontal, Sparkles, Star, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { ImportCallModal } from "@/components/calls/import-call-modal";
import { AlertsChip, OutcomeChip, QualificationChip, ScoreCell, StatusChip, TypeChip } from "@/components/calls/call-chips";
import { syncFathomNow } from "@/lib/actions/fathom";
import { analyzePendingCalls } from "@/lib/actions/calls-edit";
import { loadCallPanel } from "@/lib/actions/calls-panel";
import { CallPanel, CallPanelSkeleton } from "@/components/calls/call-panel";
import { CallPeople } from "@/components/calls/call-people";
import { CallsBulkBar, type BulkItem } from "@/components/calls/calls-bulk-bar";
import { TypeSelect } from "@/components/calls/call-actions";
import type { CallDetailTab, CallPanelNav } from "@/components/calls/call-detail";
import type { LoadedCallDetail } from "@/lib/calls/load-detail";
import type { CallParticipants } from "@/lib/calls/participants";
import { CallsAiAgentsButton } from "@/components/calls/calls-ai-agents";
import type { CallsAiAgent } from "@/lib/calls/ai-agents";
import { deleteManyToTrash } from "@/lib/actions/trash";
import { TRASH_RETENTION_DAYS } from "@/lib/trash/entities";
import { SaleModal } from "@/components/shared/sale-modal";
import { formatCallDate, formatDuration, humanize } from "@/lib/calls/format";
import {
  ANALYSIS_STATUSES,
  EMPTY_FILTERS,
  UNCLASSIFIED_AREA, callFiltersToParams,
  countActiveCallFilters,
  isNonSaleRow,
  parseSavedViews,
  savedViewsKey,
  typeDeciderText,
  INTERNAL_FILTERS,
  type CallFilters,
  type SavedView,
  callListColumns,
  CALLS_TABLE_KEY,
} from "@/lib/calls/list";
import { statusLabel } from "@/lib/calls/status";
import type { CallAnalysisStatus } from "@/lib/types/database";
import { CallPortalMenu } from "@/components/services/portal/call-portal-menu"; // @plantilla-quitar(servicios)
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";

/**
 * La lista de llamadas (F12). Que se ve lo decide la base (RLS) y los filtros
 * viven en la URL; esto solo los dibuja. En celular, tarjetas.
 */

export interface CallListRow {
  id: string;
  title: string;
  recordedAt: string;
  durationSeconds: number | null;
  closerName: string | null;
  contactId: string | null;
  contactName: string | null;
  callType: string | null;
  categoryLabel: string;
  /** El área o tipo elegido (para cambiarlo desde la fila y para el lote). */
  categoryId: string | null;
  /** El host y los invitados (la foto o las iniciales y «+N»). */
  participants: CallParticipants;
  classificationSource: string | null;
  classificationRule: string | null;
  classificationConfidence: number | null;
  status: CallAnalysisStatus;
  outcome: string | null;
  closerScore: number | null;
  leadScore: number | null;
  leadQualification: string | null;
  hasOpenAlerts: boolean;
  hasBooking: boolean;
  source: string;
  /** Servicios A4 (F136): el servicio de la reunión (producto · variante), «Por revisar» o nada. */
  serviceLabel?: string | null;
  serviceLink?: string | null;
  serviceId?: string | null;
  /** F141: cargada a mano. */
  manual?: boolean;
}

interface Props {
  rows: CallListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: CallFilters;
  loadError: boolean;
  closers: Array<{ id: string; name: string }>;
  outcomes: string[];
  currentUserId: string;
  workspaceId: string;
  canEdit: boolean;
  /** `calls.delete`: elegir grabaciones y «Eliminar seleccionadas» (van a la Papelera 30 días). */
  canDelete?: boolean;
  /** El nombre del contacto cuando la lista viene filtrada por uno (el "Ver todas" de su ficha). */
  contactFilterName: string | null;
  /** Tiene `calls.configure`: ve el atajo a la configuracion de las dos tareas. */
  canConfigure: boolean;
  /** «Agentes IA» (con `calls.configure` o `agents.view`): quién clasifica y analiza, y dónde se edita. null = no se muestra. */
  aiAgents?: CallsAiAgent[] | null;
  /** Cuantas llamadas que ve estan pendientes de analisis (para "Analizar pendientes"). */
  pendingCount: number;
  /** Qué grabaciones ve esta persona, en una frase. */
  scopeLabel: string;
  categoryGroups: CategoryGroup[];
  /** Las que todavia no tienen area, para el aviso de arriba. */
  unclassifiedCount: number;
  hasAnyCall: boolean;
  workspaceHasConnections: boolean;
  hasApp: boolean;
  hasLiveConnection: boolean;
  nudgeConnect: boolean;
  /** Servicios (F65): las grabaciones de esta página que ya están en el portal, y si puede agregarlas. */
  portal?: { inPortal: string[]; canAdd: boolean } | null; // @plantilla-quitar(servicios)
  /** Servicios A4 (F136): con el módulo prendido, la columna y el filtro Servicio y el aviso «por revisar». */
  services?: { on: boolean; reviewCount: number; filterLabel: string | null } | null;
}

// El almacenamiento del navegador puede no estar (ventana privada, datos bloqueados): la lista sigue andando sin vistas guardadas.
const VIEWS_EVENT = "calls:views-changed";
function subscribeViews(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(VIEWS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VIEWS_EVENT, onChange);
  };
}
function readViews(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeViews(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: no se guarda */
  }
  window.dispatchEvent(new Event(VIEWS_EVENT));
}

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

export function CallsList(props: Props) {
  const { rows, total, page, pageSize, filters, closers, outcomes, canEdit } = props;
  const canDelete = props.canDelete === true;
  // Las casillas sirven para analizar (calls.edit) o para eliminar (calls.delete).
  const canSelect = canEdit || canDelete;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeZone = useViewerTimezone();
  const [importOpen, setImportOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, startSync] = useTransition();
  const [queueing, startQueue] = useTransition();
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");

  const active = countActiveCallFilters(filters);
  // La busqueda tiene su propio campo en la barra: el globito de «Filtros» cuenta lo que esta adentro del menu.
  const menuActive = active - (filters.q ? 1 : 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const storageKey = savedViewsKey(props.workspaceId, props.currentUserId);

  // Las vistas guardadas viven en el navegador, por persona y workspace.
  const rawViews = useSyncExternalStore(
    (onChange) => subscribeViews(onChange),
    () => readViews(storageKey),
    () => null,
  );
  const views = useMemo(() => parseSavedViews(rawViews), [rawViews]);

  function persistViews(next: SavedView[]) {
    writeViews(storageKey, JSON.stringify(next));
  }

  function go(next: Partial<CallFilters>) {
    const merged: CallFilters = { ...filters, ...next, pagina: next.pagina ?? 1 };
    const qs = callFiltersToParams(merged).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Lo elegido cuenta solo si sigue en la pagina: cambiar de filtro o de pagina no arrastra nada a ciegas.
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedOnPage = useMemo(() => selected.filter((id) => rows.some((r) => r.id === id)), [selected, rows]);
  const bulkItems = useMemo<BulkItem[]>(
    () =>
      rows
        .filter((r) => selectedOnPage.includes(r.id))
        .map((r) => ({
          callId: r.id,
          title: r.contactName ?? r.title,
          subtitle: `${formatCallDate(r.recordedAt, timeZone)} · ${r.title}`,
          categoryId: r.categoryId,
          needsType: !r.categoryId || r.status === "needs_review",
        })),
    [rows, selectedOnPage, timeZone],
  );

  // ── El panel de la grabación ──────────────────────────────────────────────────────────────────────────────────────
  // El detalle abierto vive en `?llamada=` (un link lo abre), pero abrirlo o cerrarlo NO le pide la página al servidor:
  // se cambia la URL con la API del navegador y el detalle se pide aparte (`loadCallPanel`), igual que la Agenda.
  const openId = searchParams.get("llamada");
  const rawTab = searchParams.get("tab");
  const panelTab: CallDetailTab = (["resumen", "closer", "lead", "tecnico", "transcripcion", "actividad"] as const).find((t) => t === rawTab) ?? "resumen";
  // Lo último que llegó del servidor, con el id que se pidió: si no coincide con el abierto, se muestra el esqueleto
  // (y no los datos de otra grabación).
  const [loaded, setLoaded] = useState<{ id: string; data: LoadedCallDetail | null } | null>(null);
  const detail = loaded && loaded.id === openId ? loaded.data : null;
  const detailMissing = loaded !== null && loaded.id === openId && loaded.data === null;
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    void loadCallPanel(openId).then((data) => {
      if (!cancelled) setLoaded({ id: openId, data });
    });
    return () => {
      cancelled = true;
    };
  }, [openId, reloadKey]);

  // Toda acción de adentro del panel termina con `router.refresh()`: cuando llegan filas nuevas del servidor, se vuelve
  // a pedir solo el detalle (el primer render ya lo pidió). Se ajusta durante el render, no en un efecto.
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setReloadKey((k) => k + 1);
  }

  const urlWith = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `?${qs}` : window.location.pathname;
  }, []);
  const openDetail = useCallback((id: string) => window.history.pushState(null, "", urlWith({ llamada: id, tab: null })), [urlWith]);
  const closeDetail = useCallback(() => window.history.replaceState(null, "", urlWith({ llamada: null, tab: null })), [urlWith]);
  const setPanelTab = useCallback((tab: CallDetailTab) => window.history.replaceState(null, "", urlWith({ tab: tab === "resumen" ? null : tab })), [urlWith]);
  const openIndex = openId ? rows.findIndex((r) => r.id === openId) : -1;
  const panelNav: CallPanelNav | null = openId
    ? {
        tab: panelTab,
        onTab: setPanelTab,
        onClose: closeDetail,
        onPrev: openIndex > 0 ? () => openDetail(rows[openIndex - 1].id) : null,
        onNext: openIndex >= 0 && openIndex < rows.length - 1 ? () => openDetail(rows[openIndex + 1].id) : null,
        position: openIndex >= 0 ? { index: openIndex, total: rows.length } : null,
        openHref: `/dashboard/llamadas/${openId}${panelTab === "actividad" ? "?tab=actividad" : ""}`,
        closeHref: (() => {
          const qs = callFiltersToParams(filters).toString();
          return qs ? `${pathname}?${qs}` : pathname;
        })(),
      }
    : null;

  // Servicios A4 (F136): la columna Servicio aparece solo con el módulo prendido; se oculta desde «Columnas».
  const servicesOn = Boolean(props.services?.on);
  const portal = props.portal; // @plantilla-quitar(servicios)
  const columns = useMemo<DataColumn<CallListRow>[]>(() => {
    const render: Record<string, Pick<DataColumn<CallListRow>, "render" | "cellClassName">> = {
      // La fila entera abre la llamada; el contacto es texto (docs/tablas.md).
      lead: {
        render: (r) => (
          <>
            {r.contactName ? <span className="block truncate font-medium">{r.contactName}</span> : <span className="block truncate font-medium text-red-700 dark:text-red-400">Sin vincular</span>}
            <span className="block truncate text-xs text-muted-foreground">{r.title}</span>
          </>
        ),
      },
      participantes: { render: (r) => <CallPeople participants={r.participants} /> },
      fecha: { render: (r) => formatCallDate(r.recordedAt, timeZone) },
      duracion: { render: (r) => formatDuration(r.durationSeconds) },
      grabo: { render: (r) => r.closerName ?? "—" },
      tipo: {
        render: (r) => (
          <RowType row={r} groups={props.categoryGroups} canEdit={canEdit && r.status !== "classifying" && r.status !== "analyzing"} />
        ),
      },
      servicio: { render: (r) => <ServiceCell link={r.serviceLink ?? null} label={r.serviceLabel ?? null} /> },
      resultado: { render: (r) => <OutcomeChip outcome={r.outcome} /> },
      closer: { render: (r) => <ScoreCell score={r.closerScore} label="Puntaje del closer" /> },
      lead_score: {
        render: (r) => (
          <div className="flex items-center gap-1">
            <ScoreCell score={r.leadScore} label="Puntaje del lead" />
            <QualificationChip value={r.leadQualification} />
          </div>
        ),
      },
      estado: { render: (r) => <StatusChip status={r.status} /> },
      alertas: { render: (r) => <AlertsChip open={r.hasOpenAlerts} /> },
    };
    const metas = callListColumns({ servicesOn });
    const out: DataColumn<CallListRow>[] = metas.map((m) => ({ ...m, ...render[m.key] }));
    // @plantilla-desde(servicios)
    if (portal) {
      out.push({
        key: "portal",
        label: "En el portal",
        defaultWidth: 140,
        render: (r) => (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{portal.inPortal.includes(r.id) ? "Sí" : "—"}</span>
            <CallPortalMenu callId={r.id} inPortal={portal.inPortal.includes(r.id)} canAdd={portal.canAdd} />
          </div>
        ),
      });
    }
    // @plantilla-hasta(servicios)
    return out;
  }, [servicesOn, timeZone, portal, canEdit, props.categoryGroups]);
  const tablePrefs = useTablePrefs(CALLS_TABLE_KEY, "base", columns, null);

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const params = callFiltersToParams({ ...filters, pagina: 1 }).toString();
    persistViews([...views.filter((v) => v.name !== name), { id: crypto.randomUUID(), name, params }].slice(-12));
    setNaming(false);
    setViewName("");
  }

  function toggleSelected(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function deleteSelected() {
    const ids = selectedOnPage;
    startQueue(async () => {
      const r = await deleteManyToTrash("call", ids);
      setDeleteOpen(false);
      if (!r.ok) return setSyncMessage({ ok: false, text: r.error });
      const done = r.deleted === 1 ? "Se eliminó 1 grabación" : `Se eliminaron ${r.deleted} grabaciones`;
      const failed = r.failures.length > 0 ? ` ${r.failures.length === 1 ? "1 no se pudo eliminar" : `${r.failures.length} no se pudieron eliminar`}: ${r.failures[0].error}` : "";
      setSyncMessage({ ok: r.failures.length === 0, text: `${done}. Quedan ${TRASH_RETENTION_DAYS} días en la Papelera (Ajustes → Papelera).${failed}` });
      setSelected([]);
      router.refresh();
    });
  }

  function analyzePending() {
    setSyncMessage(null);
    startQueue(async () => {
      const r = await analyzePendingCalls();
      setSyncMessage(r.ok ? { ok: true, text: r.queued === 0 ? "No quedaba ninguna para analizar." : `Se van a analizar ${r.queued} ${r.queued === 1 ? "llamada" : "llamadas"}, una cada 30 segundos.` } : { ok: false, text: r.error });
      router.refresh();
    });
  }

  function syncNow() {
    setSyncMessage(null);
    startSync(async () => {
      const r = await syncFathomNow();
      setSyncMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  }

  const noCallsYet = !props.hasAnyCall && active === 0;

  // Buscar y Filtros van en la barra de arriba (nunca una barra adentro de la pagina). Sin ninguna
  // grabacion todavia no hay nada que filtrar.
  const barFilters = noCallsYet ? undefined : (
    <>
      <ExpandableSearch
        value={filters.q}
        onCommit={(q) => go({ q })}
        label="Buscar llamadas por título o contacto"
        placeholder="Título o contacto…"
      />
      <FilterMenu
        label="Filtros"
        compact
        badge={menuActive}
        active={menuActive > 0}
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[440px]"
      >
        <div className="space-y-3 px-2.5 pb-2 pt-1">
          <p className="text-xs text-muted-foreground">{props.scopeLabel}</p>

          {views.length > 0 && (
            <div>
              <MenuGroupLabel>Vistas guardadas</MenuGroupLabel>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vistas guardadas">
                {views.map((v) => (
                  <span key={v.id} className="inline-flex items-center rounded-full border border-border text-xs">
                    <button type="button" className="rounded-l-full px-2.5 py-1 hover:bg-accent" onClick={() => router.push(v.params ? `${pathname}?${v.params}` : pathname)}>{v.name}</button>
                    <button type="button" aria-label={`Borrar la vista ${v.name}`} className="rounded-r-full px-1.5 py-1 text-muted-foreground hover:text-foreground" onClick={() => persistViews(views.filter((x) => x.id !== v.id))}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quien grabó">
              <select className={selectClass} value={filters.closer} onChange={(e) => go({ closer: e.target.value })}>
                <option value="">Todos</option>
                {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Área">
              <select className={selectClass} value={filters.area} onChange={(e) => go({ area: e.target.value, tipo: "" })}>
                <option value="">Todas</option>
                <option value={UNCLASSIFIED_AREA}>Sin clasificar</option>
                {props.categoryGroups.map((g) => <option key={g.areaId} value={g.areaId}>{g.areaName}</option>)}
              </select>
            </Field>
            <Field label="Tipo">
              <select className={selectClass} value={filters.tipo} onChange={(e) => go({ tipo: e.target.value })}>
                <option value="">Todos</option>
                {props.categoryGroups.filter((g) => !filters.area || g.areaId === filters.area).map((g) => (
                  <optgroup key={g.areaId} label={g.areaName}>
                    {g.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Resultado">
              <select className={selectClass} value={filters.resultado} onChange={(e) => go({ resultado: e.target.value })}>
                <option value="">Todos</option>
                {outcomes.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
              </select>
            </Field>
            <Field label="Estado del análisis">
              <select className={selectClass} value={filters.estado} onChange={(e) => go({ estado: e.target.value as CallFilters["estado"] })}>
                <option value="">Todos</option>
                {ANALYSIS_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </Field>
            {props.services?.on && (
              <Field label="Servicio">
                <select
                  className={selectClass}
                  value={filters.servicio === "review" || filters.servicio === "sin" || filters.servicio === "" ? filters.servicio : "uno"}
                  onChange={(e) => go({ servicio: e.target.value === "uno" ? filters.servicio : e.target.value })}
                >
                  <option value="">Todos</option>
                  <option value="review">Por revisar</option>
                  <option value="sin">Sin servicio (área Servicio)</option>
                  {filters.servicio && filters.servicio !== "review" && filters.servicio !== "sin" && (
                    <option value="uno">{props.services.filterLabel ?? "Un servicio"}</option>
                  )}
                </select>
              </Field>
            )}
            <Field label="Cargadas a mano">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={filters.manual} onChange={(e) => go({ manual: e.target.checked })} className="h-4 w-4" />
                Solo las cargadas a mano
              </label>
            </Field>
            <Field label="Vinculación">
              <select className={selectClass} value={filters.vinculo} onChange={(e) => go({ vinculo: e.target.value as CallFilters["vinculo"] })}>
                <option value="">Todas</option>
                <option value="vinculada">Con contacto</option>
                <option value="sin_vincular">Sin vincular</option>
              </select>
            </Field>
            <Field label="Reuniones internas">
              <select className={selectClass} value={filters.internas} onChange={(e) => go({ internas: e.target.value as CallFilters["internas"] })}>
                <option value="">Todas</option>
                {INTERNAL_FILTERS.map((v) => <option key={v} value={v}>{v === "ocultar" ? "Ocultar las internas (Equipo)" : "Solo las internas (Equipo)"}</option>)}
              </select>
            </Field>
            <Field label="Puntaje del closer">
              <RangeInputs min={filters.closerMin} max={filters.closerMax} onMin={(v) => go({ closerMin: v })} onMax={(v) => go({ closerMax: v })} label="del closer" />
            </Field>
            <Field label="Puntaje del lead">
              <RangeInputs min={filters.leadMin} max={filters.leadMax} onMin={(v) => go({ leadMin: v })} onMax={(v) => go({ leadMax: v })} label="del lead" />
            </Field>
            <Field label="Fechas">
              <div className="flex gap-1">
                <input type="date" aria-label="Desde" className={selectClass} value={filters.desde} onChange={(e) => go({ desde: e.target.value })} />
                <input type="date" aria-label="Hasta" className={selectClass} value={filters.hasta} onChange={(e) => go({ hasta: e.target.value })} />
              </div>
            </Field>
          </div>

          {active > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              {naming ? (
                <form onSubmit={(e) => { e.preventDefault(); saveView(); }} className="flex items-center gap-1">
                  <input autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Nombre de la vista" aria-label="Nombre de la vista" maxLength={40} className="h-8 w-40 rounded-lg border border-input bg-background px-2 text-sm" />
                  <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm text-primary-foreground">Guardar</button>
                </form>
              ) : (
                <button type="button" onClick={() => setNaming(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent">
                  <Star className="h-3.5 w-3.5" aria-hidden /> Guardar vista
                </button>
              )}
              {menuActive > 0 && (
                <button
                  type="button"
                  onClick={() => go({ ...EMPTY_FILTERS, q: filters.q })}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden />
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </div>
      </FilterMenu>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/llamadas"
        filters={barFilters}
        right={
          <div className="flex shrink-0 items-center gap-2">
            <ColumnsMenu state={tablePrefs} />
            {props.hasLiveConnection && (
              <button type="button" onClick={syncNow} disabled={syncing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-50" aria-label="Sincronizar ahora">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                <span className="hidden sm:inline">Sincronizar ahora</span>
              </button>
            )}
            {canEdit && props.pendingCount > 0 && (
              <button type="button" onClick={analyzePending} disabled={queueing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-50" aria-label={`Analizar pendientes (${props.pendingCount})`}>
                {queueing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                <span className="hidden sm:inline">Analizar pendientes ({props.pendingCount})</span>
              </button>
            )}
            {props.aiAgents && props.aiAgents.length > 0 && <CallsAiAgentsButton agents={props.aiAgents} />}
            {canEdit && (
              <button type="button" onClick={() => setImportOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:px-3" aria-label="Importar una llamada">
                <Plus className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Importar</span>
              </button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {props.unclassifiedCount > 0 && filters.area !== UNCLASSIFIED_AREA && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <span>{props.unclassifiedCount === 1 ? "1 grabación sin clasificar" : `${props.unclassifiedCount} grabaciones sin clasificar`}: no se vincularon con una reunión y ninguna regla las clasificó.</span>
            <button type="button" onClick={() => go({ area: UNCLASSIFIED_AREA, tipo: "" })} className="font-medium text-primary-ink underline-offset-2 hover:underline">Ver y clasificar</button>
          </div>
        )}
        {props.services?.on && props.services.reviewCount > 0 && filters.servicio !== "review" && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <span>{props.services.reviewCount === 1 ? "1 reunión por revisar" : `${props.services.reviewCount} reuniones por revisar`}: el cliente tiene más de un servicio posible.</span>
            <button type="button" onClick={() => go({ servicio: "review" })} className="font-medium text-primary-ink underline-offset-2 hover:underline">Ver y elegir el servicio</button>
          </div>
        )}
        {props.services?.on && filters.servicio && filters.servicio !== "review" && filters.servicio !== "sin" && (
          <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm">
            <span>Mostrando solo las reuniones de <strong>{props.services.filterLabel ?? "este servicio"}</strong>.</span>
            <button type="button" onClick={() => go({ servicio: "" })} className="font-medium text-primary-ink underline-offset-2 hover:underline">Ver todas</button>
          </p>
        )}
        {props.nudgeConnect && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
            <span>Si grabás tus llamadas con Fathom, conectalo y entran solas.</span>
            <Link href="/dashboard/llamadas/mi-fathom" className="font-medium text-primary-ink underline-offset-2 hover:underline">Conectá tu Fathom</Link>
          </div>
        )}
        {filters.contacto && (
          <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm">
            <span>Mostrando solo las llamadas de <strong>{props.contactFilterName ?? "este contacto"}</strong>.</span>
            <button type="button" onClick={() => go({ contacto: "" })} className="font-medium text-primary-ink underline-offset-2 hover:underline">Ver todas las llamadas</button>
          </p>
        )}
        {syncMessage && (
          <p role={syncMessage.ok ? "status" : "alert"} className={`mb-4 rounded-lg px-3 py-2 text-sm ${syncMessage.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
            {syncMessage.text}
          </p>
        )}

        {noCallsYet ? (
          <EmptyState {...props} onImport={() => setImportOpen(true)} />
        ) : (
          <>
            {props.loadError ? (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
                <p className="text-red-700 dark:text-red-300">No se pudieron cargar las llamadas.</p>
                <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
                <p>No hay llamadas con estos filtros.</p>
                <button type="button" onClick={() => router.push(pathname)} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>
              </div>
            ) : (
              <>
                <DataTable
                  className="hidden md:block"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  state={tablePrefs}
                  caption="Llamadas"
                  rowHref={(r) => `/dashboard/llamadas/${r.id}`}
                  onRowClick={(r) => openDetail(r.id)}
                  rowClassName={(r) => (isNonSaleRow({ call_type: r.callType, analysis_status: r.status }) ? "opacity-60" : undefined)}
                  selection={canSelect ? { selected: new Set(selectedOnPage), onChange: (next) => setSelected([...next]), rowLabel: (r) => `Elegir ${r.title}` } : undefined}
                />

                <ul className="space-y-2 md:hidden">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/dashboard/llamadas/${r.id}`}
                        onClick={(e) => {
                          // Un clic simple abre el panel; con Cmd/Ctrl o el botón del medio, el link normal.
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                          e.preventDefault();
                          openDetail(r.id);
                        }}
                        className="block rounded-xl border border-border bg-card p-3 hover:bg-muted/30"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-medium ${r.contactName ? "" : "text-red-700 dark:text-red-400"}`}>{r.contactName ?? "Sin vincular"}</p>
                            <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                          </div>
                          <AlertsChip open={r.hasOpenAlerts} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{formatCallDate(r.recordedAt, timeZone)} · {formatDuration(r.durationSeconds)}{r.closerName ? ` · ${r.closerName}` : ""}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <TypeChip type={r.callType} label={r.categoryLabel} needsReview={r.status === "needs_review"} />
                          {servicesOn && (r.serviceLink === "review" || r.serviceLabel) && <ServiceCell link={r.serviceLink ?? null} label={r.serviceLabel ?? null} />}
                          <StatusChip status={r.status} />
                          <OutcomeChip outcome={r.outcome} />
                          {r.closerScore !== null && <span className="inline-flex items-center gap-1 text-xs">Closer <ScoreCell score={r.closerScore} /></span>}
                          {r.leadScore !== null && <span className="inline-flex items-center gap-1 text-xs">Lead <ScoreCell score={r.leadScore} /></span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>

                <nav aria-label="Páginas" className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span className="tabular-nums">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={page <= 1} onClick={() => go({ pagina: page - 1 })} className="inline-flex h-8 items-center rounded-lg border border-border px-2 hover:bg-accent disabled:opacity-40" aria-label="Página anterior"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                    <span className="px-2 tabular-nums">{page} / {pages}</span>
                    <button type="button" disabled={page >= pages} onClick={() => go({ pagina: page + 1 })} className="inline-flex h-8 items-center rounded-lg border border-border px-2 hover:bg-accent disabled:opacity-40" aria-label="Página siguiente"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                  </div>
                </nav>
              </>
            )}
          </>
        )}
      </div>

      {canSelect && selectedOnPage.length > 0 && (
        <CallsBulkBar
          selected={bulkItems}
          groups={props.categoryGroups}
          canEdit={canEdit}
          canDelete={canDelete}
          onClear={() => setSelected([])}
          onResult={(text) => setSyncMessage({ ok: true, text })}
          onDelete={() => {
            setSyncMessage(null);
            setDeleteOpen(true);
          }}
        />
      )}

      {openId && !detail && <CallPanelSkeleton missing={detailMissing} onClose={closeDetail} />}
      {openId && detail && panelNav && <CallPanel detail={detail} nav={panelNav} />}

      {deleteOpen && canDelete && (
        <SaleModal
          title="Eliminar grabaciones"
          label="Eliminar grabaciones seleccionadas"
          onClose={() => !queueing && setDeleteOpen(false)}
          footer={
            <div className="ml-auto flex gap-2">
              <button type="button" disabled={queueing} onClick={() => setDeleteOpen(false)} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Volver</button>
              <button type="button" disabled={queueing || selectedOnPage.length === 0} onClick={deleteSelected} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                {queueing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Eliminar
              </button>
            </div>
          }
        >
          <p className="text-sm">
            {selectedOnPage.length === 1 ? "Se elimina 1 grabación." : `Se eliminan ${selectedOnPage.length} grabaciones.`} Desaparecen de todas las pantallas y números, quedan {TRASH_RETENTION_DAYS} días en la Papelera (desde donde se pueden restaurar) y no vuelven a entrar al sincronizar Fathom.
          </p>
        </SaleModal>
      )}

      {canEdit && importOpen && (
        <ImportCallModal onClose={() => setImportOpen(false)} closers={closers} currentUserId={props.currentUserId} onImported={(id) => { setImportOpen(false); router.push(`/dashboard/llamadas/${id}`); }} />
      )}
    </div>
  );
}

/**
 * El tipo de una grabación en la lista: la etiqueta de siempre (con quién lo decidió al pasar el mouse) y, con
 * `calls.edit`, un lápiz que abre el selector de área y tipo ahí mismo, sin entrar a la ficha.
 */
function RowType({ row, groups, canEdit }: { row: CallListRow; groups: CategoryGroup[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <TypeSelect callId={row.id} current={row.categoryId} groups={groups} compact autoFocus onDone={() => setEditing(false)} label={`Cambiar el área y el tipo de ${row.title}`} />;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={typeDeciderText({ classification_source: row.classificationSource, classification_rule: row.classificationRule, classification_confidence: row.classificationConfidence }) ?? undefined}>
      <TypeChip type={row.callType} label={row.categoryLabel} needsReview={row.status === "needs_review"} />
      {row.manual && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Cargada a mano</span>}
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} aria-label={`Cambiar el área y el tipo de ${row.title}`} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3 w-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function RangeInputs({ min, max, onMin, onMax, label }: { min: number | null; max: number | null; onMin: (v: number | null) => void; onMax: (v: number | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <ScoreInput value={min} onCommit={onMin} placeholder="Desde" label={`Puntaje ${label}, desde`} />
      <ScoreInput value={max} onCommit={onMax} placeholder="Hasta" label={`Puntaje ${label}, hasta`} />
    </div>
  );
}

/**
 * Un puntaje del 0 al 100 que se aplica al apretar Enter, al salir del campo o
 * un rato despues de dejar de escribir. Lo ultimo importa porque esta adentro de
 * un menu: un clic afuera lo cierra y el campo desaparece sin llegar a perder el
 * foco. El temporizador no se cancela al desmontar, asi lo escrito no se pierde.
 */
function ScoreInput({ value, onCommit, placeholder, label }: { value: number | null; onCommit: (v: number | null) => void; placeholder: string; label: string }) {
  const applied = value === null ? "" : String(value);
  const [draft, setDraft] = useState(applied);
  const [seen, setSeen] = useState(applied);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Si lo aplicado cambia desde afuera (limpiar filtros, una vista guardada), el campo lo sigue.
  if (applied !== seen) {
    setSeen(applied);
    setDraft(applied);
  }
  const parse = (v: string) => (v.trim() === "" ? null : Math.min(100, Math.max(0, Number(v))));
  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const parsed = parse(next);
    if (parsed !== value && (parsed === null || Number.isFinite(parsed))) onCommit(parsed);
  }
  return (
    <input
      type="number"
      min={0}
      max={100}
      placeholder={placeholder}
      aria-label={label}
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

function EmptyState(props: Props & { onImport: () => void }) {
  if (!props.workspaceHasConnections) {
    return (
      <div className="mx-auto mt-6 max-w-xl rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary-ink"><Phone className="h-5 w-5" aria-hidden /></span>
          <div>
            <h2 className="text-base font-semibold">Todavía no hay grabaciones de llamadas</h2>
            <p className="text-sm text-muted-foreground">Cada persona conecta su Fathom y las grabaciones entran solas.</p>
          </div>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          <li>Un admin carga la app de Fathom en <Link className="text-primary-ink underline-offset-2 hover:underline" href="/dashboard/settings/integrations">Integraciones</Link>.</li>
          <li>Cada persona conecta su cuenta en <Link className="text-primary-ink underline-offset-2 hover:underline" href="/dashboard/llamadas/mi-fathom">Mi Fathom</Link>. Ahí también puede importar sus llamadas anteriores.</li>
        </ol>
        {props.canEdit && (
          <button type="button" onClick={props.onImport} className="mt-4 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            O importá una llamada que ya tengas (Zoom, Google Meet…)
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-xl border border-border bg-card p-6 text-center">
      <Link2 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
      <h2 className="mt-2 text-base font-semibold">Todavía no entró ninguna grabación</h2>
      <p className="mt-1 text-sm text-muted-foreground">Se consulta Fathom cada 10 minutos.</p>
    </div>
  );
}

/** La celda Servicio (Servicios A4, F136): el servicio, «Por revisar» en ámbar, o un guion. */
function ServiceCell({ link, label }: { link: string | null; label: string | null }) {
  if (link === "review") {
    return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">Por revisar</span>;
  }
  if (!label) return <span className="text-muted-foreground">—</span>;
  return <span className="block truncate text-xs" title={label}>{label}</span>;
}
