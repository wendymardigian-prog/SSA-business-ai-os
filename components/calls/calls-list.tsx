"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronLeft, ChevronRight, Filter, Link2, Loader2, Phone, Plus, RefreshCw, Search, Settings, Sparkles, Star, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { ImportCallModal } from "@/components/calls/import-call-modal";
import { AlertsChip, OutcomeChip, QualificationChip, ScoreCell, StatusChip, TypeChip } from "@/components/calls/call-chips";
import { syncFathomNow } from "@/lib/actions/fathom";
import { analyzePendingCalls } from "@/lib/actions/calls-edit";
import { Popover } from "@/components/ui/popover";
import { formatCallDate, formatDuration, humanize } from "@/lib/calls/format";
import {
  ANALYSIS_STATUSES,
  CALL_TYPE_LABELS,
  callFiltersToParams,
  countActiveCallFilters,
  isNonSaleRow,
  parseSavedViews,
  savedViewsKey,
  typeDeciderText,
  type CallFilters,
  type SavedView,
} from "@/lib/calls/list";
import { statusLabel } from "@/lib/calls/status";
import type { CallAnalysisStatus } from "@/lib/types/database";

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
  callTypeSource: string | null;
  callTypeRule: string | null;
  callTypeConfidence: number | null;
  status: CallAnalysisStatus;
  outcome: string | null;
  closerScore: number | null;
  leadScore: number | null;
  leadQualification: string | null;
  hasOpenAlerts: boolean;
  hasBooking: boolean;
  source: string;
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
  /** Tiene `calls.configure`: ve el atajo a la configuracion de las dos tareas. */
  canConfigure: boolean;
  /** Cuantas llamadas que ve estan pendientes de analisis (para "Analizar pendientes"). */
  pendingCount: number;
  scopeAll: boolean;
  hasAnyCall: boolean;
  workspaceHasConnections: boolean;
  hasApp: boolean;
  hasLiveConnection: boolean;
  nudgeConnect: boolean;
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
  const router = useRouter();
  const pathname = usePathname();
  const timeZone = useViewerTimezone();
  const [panelOpen, setPanelOpen] = useState(countActiveCallFilters(filters) > 0);
  const [search, setSearch] = useState(filters.q);
  const [importOpen, setImportOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, startSync] = useTransition();
  const [queueing, startQueue] = useTransition();
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");

  const active = countActiveCallFilters(filters);
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

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const params = callFiltersToParams({ ...filters, pagina: 1 }).toString();
    persistViews([...views.filter((v) => v.name !== name), { id: crypto.randomUUID(), name, params }].slice(-12));
    setNaming(false);
    setViewName("");
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/llamadas"
        right={
          <div className="flex shrink-0 items-center gap-2">
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
            {props.canConfigure && (
              <Popover label="Configurar clasificación y análisis" trigger={<Settings className="h-4 w-4" aria-hidden />} panelClassName="w-64" triggerClassName="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-accent">
                <p className="mb-2 text-xs font-semibold">Configuración de Llamadas</p>
                <ul className="space-y-1 text-sm">
                  <li><Link href="/dashboard/agents/tareas/call_classification?tab=config" className="block rounded-md px-2 py-1.5 hover:bg-accent">Clasificación de llamadas</Link></li>
                  <li><Link href="/dashboard/agents/tareas/call_analysis?tab=config" className="block rounded-md px-2 py-1.5 hover:bg-accent">Análisis de llamadas</Link></li>
                </ul>
              </Popover>
            )}
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
        {props.nudgeConnect && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <span>Todavía no conectaste tu Fathom: tus llamadas no entran solas.</span>
            <Link href="/dashboard/llamadas/mi-fathom" className="font-medium text-primary underline-offset-2 hover:underline">Conectá tu Fathom</Link>
          </div>
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
            <div className="flex flex-wrap items-center gap-2">
              <form
                className="relative min-w-[200px] flex-1 sm:max-w-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  go({ q: search.trim() });
                }}
                role="search"
              >
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por título o contacto"
                  aria-label="Buscar llamadas por título o contacto"
                  className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm"
                />
              </form>
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent"
              >
                <Filter className="h-4 w-4" aria-hidden /> Filtros{active > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{active}</span>}
              </button>
              {active > 0 && (
                <>
                  <button type="button" onClick={() => router.push(pathname)} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" aria-hidden /> Limpiar
                  </button>
                  {naming ? (
                    <form onSubmit={(e) => { e.preventDefault(); saveView(); }} className="flex items-center gap-1">
                      <input autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Nombre de la vista" aria-label="Nombre de la vista" maxLength={40} className="h-9 w-40 rounded-lg border border-input bg-background px-2 text-sm" />
                      <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground">Guardar</button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setNaming(true)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-sm hover:bg-accent">
                      <Star className="h-4 w-4" aria-hidden /> Guardar vista
                    </button>
                  )}
                </>
              )}
              <span className="ml-auto rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {props.scopeAll ? "Todas las del equipo" : "Las tuyas y las de tus contactos"}
              </span>
            </div>

            {views.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Vistas guardadas">
                {views.map((v) => (
                  <span key={v.id} className="inline-flex items-center rounded-full border border-border text-xs">
                    <button type="button" className="rounded-l-full px-2.5 py-1 hover:bg-accent" onClick={() => router.push(v.params ? `${pathname}?${v.params}` : pathname)}>{v.name}</button>
                    <button type="button" aria-label={`Borrar la vista ${v.name}`} className="rounded-r-full px-1.5 py-1 text-muted-foreground hover:text-foreground" onClick={() => persistViews(views.filter((x) => x.id !== v.id))}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {panelOpen && (
              <div className="mt-3 grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Closer">
                  <select className={selectClass} value={filters.closer} onChange={(e) => go({ closer: e.target.value })}>
                    <option value="">Todos</option>
                    {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Tipo">
                  <select className={selectClass} value={filters.tipo} onChange={(e) => go({ tipo: e.target.value })}>
                    <option value="">Todos</option>
                    {Object.entries(CALL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
                <Field label="Vinculación">
                  <select className={selectClass} value={filters.vinculo} onChange={(e) => go({ vinculo: e.target.value as CallFilters["vinculo"] })}>
                    <option value="">Todas</option>
                    <option value="vinculada">Con contacto</option>
                    <option value="sin_vincular">Sin vincular</option>
                  </select>
                </Field>
                <Field label="Puntaje del closer">
                  <RangeInputs min={filters.closerMin} max={filters.closerMax} onChange={(min, max) => go({ closerMin: min, closerMax: max })} label="del closer" />
                </Field>
                <Field label="Puntaje del lead">
                  <RangeInputs min={filters.leadMin} max={filters.leadMax} onChange={(min, max) => go({ leadMin: min, leadMax: max })} label="del lead" />
                </Field>
                <Field label="Fechas">
                  <div className="flex gap-1">
                    <input type="date" aria-label="Desde" className={selectClass} value={filters.desde} onChange={(e) => go({ desde: e.target.value })} />
                    <input type="date" aria-label="Hasta" className={selectClass} value={filters.hasta} onChange={(e) => go({ hasta: e.target.value })} />
                  </div>
                </Field>
              </div>
            )}

            {props.loadError ? (
              <div role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
                <p className="text-red-700 dark:text-red-300">No se pudieron cargar las llamadas.</p>
                <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="mt-6 rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
                <p>No hay llamadas con estos filtros.</p>
                <button type="button" onClick={() => router.push(pathname)} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>
              </div>
            ) : (
              <>
                <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        {["Lead / llamada", "Fecha", "Duración", "Closer", "Tipo", "Resultado", "Closer", "Lead", "Estado", ""].map((h, i) => (
                          <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{i === 6 ? "Puntaje closer" : i === 7 ? "Puntaje lead" : h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => {
                        const gray = isNonSaleRow({ call_type: r.callType, analysis_status: r.status });
                        return (
                          <tr key={r.id} className={`hover:bg-muted/30 ${gray ? "opacity-60" : ""}`}>
                            <td className="max-w-[260px] px-3 py-2">
                              <Link href={`/dashboard/llamadas/${r.id}`} className="block rounded outline-offset-2 focus-visible:outline">
                                <span className="block truncate font-medium">{r.contactName ?? "Sin vincular"}</span>
                                <span className="block truncate text-xs text-muted-foreground">{r.title}</span>
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">{formatCallDate(r.recordedAt, timeZone)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{formatDuration(r.durationSeconds)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{r.closerName ?? "—"}</td>
                            <td className="px-3 py-2" title={typeDeciderText({ call_type_source: r.callTypeSource, call_type_rule: r.callTypeRule, call_type_confidence: r.callTypeConfidence }) ?? undefined}>
                              <TypeChip type={r.callType} needsReview={r.status === "needs_review"} />
                            </td>
                            <td className="px-3 py-2"><OutcomeChip outcome={r.outcome} /></td>
                            <td className="px-3 py-2"><ScoreCell score={r.closerScore} label="Puntaje del closer" /></td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-1">
                                <ScoreCell score={r.leadScore} label="Puntaje del lead" />
                                <QualificationChip value={r.leadQualification} />
                              </div>
                            </td>
                            <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                            <td className="px-3 py-2"><AlertsChip open={r.hasOpenAlerts} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="mt-4 space-y-2 md:hidden">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/dashboard/llamadas/${r.id}`} className="block rounded-xl border border-border bg-card p-3 hover:bg-muted/30">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{r.contactName ?? "Sin vincular"}</p>
                            <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                          </div>
                          <AlertsChip open={r.hasOpenAlerts} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{formatCallDate(r.recordedAt, timeZone)} · {formatDuration(r.durationSeconds)}{r.closerName ? ` · ${r.closerName}` : ""}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <TypeChip type={r.callType} needsReview={r.status === "needs_review"} />
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

      {canEdit && importOpen && (
        <ImportCallModal onClose={() => setImportOpen(false)} closers={closers} currentUserId={props.currentUserId} onImported={(id) => { setImportOpen(false); router.push(`/dashboard/llamadas/${id}`); }} />
      )}
    </div>
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

function RangeInputs({ min, max, onChange, label }: { min: number | null; max: number | null; onChange: (min: number | null, max: number | null) => void; label: string }) {
  const parse = (v: string) => (v === "" ? null : Math.min(100, Math.max(0, Number(v))));
  return (
    <div className="flex items-center gap-1">
      <input type="number" min={0} max={100} placeholder="Desde" aria-label={`Puntaje ${label}, desde`} className={selectClass} defaultValue={min ?? ""} onBlur={(e) => onChange(parse(e.target.value), max)} />
      <input type="number" min={0} max={100} placeholder="Hasta" aria-label={`Puntaje ${label}, hasta`} className={selectClass} defaultValue={max ?? ""} onBlur={(e) => onChange(min, parse(e.target.value))} />
    </div>
  );
}

function EmptyState(props: Props & { onImport: () => void }) {
  if (!props.workspaceHasConnections) {
    return (
      <div className="mx-auto mt-6 max-w-xl rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Phone className="h-5 w-5" aria-hidden /></span>
          <div>
            <h2 className="text-base font-semibold">Todavía no hay llamadas</h2>
            <p className="text-sm text-muted-foreground">Tus closers conectan Fathom y las llamadas entran solas.</p>
          </div>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          <li>Un admin carga la app de Fathom en <Link className="text-primary underline-offset-2 hover:underline" href="/dashboard/settings/integrations">Integraciones</Link>.</li>
          <li>Un admin marca a los closers en <Link className="text-primary underline-offset-2 hover:underline" href="/dashboard/settings/team">Equipo</Link>.</li>
          <li>Cada closer conecta su cuenta en <Link className="text-primary underline-offset-2 hover:underline" href="/dashboard/llamadas/mi-fathom">Mi Fathom</Link>.</li>
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
      <h2 className="mt-2 text-base font-semibold">Todavía no entró ninguna llamada</h2>
      <p className="mt-1 text-sm text-muted-foreground">Se consulta Fathom cada 10 minutos.</p>
    </div>
  );
}
