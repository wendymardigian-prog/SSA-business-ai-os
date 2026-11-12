/**
 * Logica pura de la lista de Llamadas (F12): tipos de venta y sus etiquetas,
 * filtros que viven en la URL, la consulta que los aplica EN LA BASE, orden,
 * agrupacion y la estimacion de costo de "Analizar pendientes".
 *
 * Portado de prevxcrm (`meetings-table.ts`). Cambios al portar: filtros por URL
 * al estilo de SSA (`lib/url-params.ts`), estados de la base en ingles,
 * `cliente` en vez de `cliente_cx`, y el filtro por defecto sale de la URL (no
 * de un estado del navegador).
 */

import { endOfDay, startOfDay } from "@/lib/dates";
import { firstParam, pickEnum, pickPage, sanitizeSearch, type SearchParams } from "@/lib/url-params";
import type { CallAnalysisStatus } from "@/lib/types/database";

export const SALE_CALL_TYPES = ["cierre", "seguimiento", "triaje"] as const;
export const PAGE_SIZE = 50;
/** Lo que cuesta analizar una llamada, para avisar antes (plano F12; claude-sonnet-5 ≈ USD 0,04). */
export const ESTIMATED_ANALYSIS_USD = 0.04;
/** Cuantas se analizan por vez con "Analizar pendientes". */
export const MAX_BATCH_ANALYSIS = 20;

export const CALL_TYPE_LABELS: Record<string, string> = {
  cierre: "Cierre", seguimiento: "Seguimiento", triaje: "Triaje", equipo: "Equipo",
  cliente: "Cliente", clase: "Clase", no_show: "No show", otra: "Otra",
};

export function callTypeLabel(t: string | null | undefined, custom?: Array<{ clave: string; nombre: string }>): string {
  if (!t) return "Sin clasificar";
  if (t === "venta") return "Cierre";
  return CALL_TYPE_LABELS[t] ?? custom?.find((c) => c.clave === t)?.nombre ?? t.replace(/_/g, " ");
}

/** Solo los tipos base de venta son de venta; los tipos propios nunca lo son. */
export function isSaleCallType(t: string | null | undefined): boolean {
  return t === "venta" || (!!t && (SALE_CALL_TYPES as readonly string[]).includes(t));
}

/** Una fila "no es de venta" si ya tiene tipo y no es de venta, o si su analisis no aplica. */
export function isNonSaleRow(r: { call_type: string | null; analysis_status: string }): boolean {
  if (r.analysis_status === "needs_review") return false;
  if (r.analysis_status === "not_applicable") return true;
  return !!r.call_type && !isSaleCallType(r.call_type);
}

/** Quien decidio el tipo, en texto chico: «regla: …», «IA 91%» o «persona». */
export function typeDeciderText(r: {
  classification_source: string | null; classification_rule: string | null; classification_confidence: number | null;
}): string | null {
  if (r.classification_source === "human") return "persona";
  if (r.classification_source === "booking") return "reunión vinculada";
  if (r.classification_source === "connection") return "área de la conexión";
  if (r.classification_source === "ai") return `IA ${Math.round((Number(r.classification_confidence) || 0) * 100)}%`;
  if (r.classification_source === "rule" || r.classification_rule) return `regla: ${r.classification_rule || "sin nombre"}`;
  return null;
}

export function durationMinutes(seconds: number | null | undefined): number | null {
  if (!seconds) return null;
  return Math.round((Number(seconds) || 0) / 60);
}

/** Semana (lunes) de una fecha, como yyyy-MM-dd en UTC. */
export function weekStartKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

// ── Orden y agrupacion ────────────────────────────────────────────────────

export interface SortConfig { key: string; direction: "asc" | "desc" }
export const DEFAULT_CALL_SORT: SortConfig[] = [{ key: "recorded_at", direction: "desc" }];

/** Orden multi-criterio. Los vacios siempre van al final. */
export function sortRows<T>(rows: T[], sorts: SortConfig[], get: (r: T, key: string) => unknown): T[] {
  if (sorts.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const va = get(a, s.key);
      const vb = get(b, s.key);
      const ea = va === null || va === undefined || va === "";
      const eb = vb === null || vb === undefined || vb === "";
      if (ea && eb) continue;
      if (ea) return 1;
      if (eb) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

export interface RowGroup<T> { key: string; label: string; rows: T[] }

/** Agrupa preservando el orden de aparicion. */
export function groupRows<T>(rows: T[], keyOf: (r: T) => { key: string; label: string }): RowGroup<T>[] {
  const map = new Map<string, RowGroup<T>>();
  for (const r of rows) {
    const { key, label } = keyOf(r);
    const g = map.get(key);
    if (g) g.rows.push(r);
    else map.set(key, { key, label, rows: [r] });
  }
  return [...map.values()];
}

// ── Costo de "Analizar pendientes" ────────────────────────────────────────

export interface BudgetEstimate {
  costUsd: number;
  projectedUsd: number;
  budgetUsd: number | null;
  /** Cuantas entran en el tope; null si no hay tope. */
  affordable: number | null;
  overBudget: boolean;
}

/** Costo estimado del lote y como queda el gasto. Cuentas en micro-dolares. */
export function estimateBatch(count: number, perCallUsd: number, spentUsd: number, budgetUsd: number | null): BudgetEstimate {
  const per = Math.round((Number(perCallUsd) || 0) * 1_000_000);
  const spent = Math.round((Number(spentUsd) || 0) * 1_000_000);
  const cost = per * Math.max(0, count);
  const projected = spent + cost;
  const budget = budgetUsd === null ? null : Math.round((Number(budgetUsd) || 0) * 1_000_000);
  const affordable = budget === null ? null : per > 0 ? Math.max(0, Math.floor((budget - spent) / per)) : count;
  return {
    costUsd: cost / 1_000_000,
    projectedUsd: projected / 1_000_000,
    budgetUsd: budget === null ? null : budget / 1_000_000,
    affordable,
    overBudget: budget !== null && projected > budget,
  };
}

// ── Filtros en la URL ─────────────────────────────────────────────────────

export const LINK_FILTERS = ["vinculada", "sin_vincular"] as const;
export const ANALYSIS_STATUSES: readonly CallAnalysisStatus[] = [
  "classifying", "needs_review", "pending", "analyzing", "analyzed", "not_applicable", "error",
];

/** Que grabaciones ve esta persona, en una frase. */
export function callScopeLabel(scope: string, role: string): string {
  if (scope === "all" || role === "owner" || role === "admin") return "Todas las del equipo";
  if (scope === "areas") return "Las de tus áreas, las tuyas y las de tus contactos";
  return "Las tuyas y las de tus contactos";
}

/** El valor del filtro de area que trae lo que todavia no se clasifico. */
export const UNCLASSIFIED_AREA = "sin";

export interface CallFilters {
  closer: string;
  /** Solo las llamadas de este contacto (el "Ver todas" de la ficha del contacto). */
  contacto: string;
  /** Un area, o "sin" para las que todavia no tienen. */
  area: string;
  /** Un tipo de la lista. Una clave vieja en un link de antes se ignora. */
  tipo: string;
  resultado: string;
  estado: CallAnalysisStatus | "";
  vinculo: (typeof LINK_FILTERS)[number] | "";
  /** Rangos de puntaje, 0..100. null = sin limite. */
  closerMin: number | null;
  closerMax: number | null;
  leadMin: number | null;
  leadMax: number | null;
  /** yyyy-MM-dd en la zona de quien mira. */
  desde: string;
  hasta: string;
  q: string;
  /**
   * Servicios A4 (F136): un servicio (uuid), «Por revisar» (`review`) o «Sin servicio» (`sin`: solo del área Servicio,
   * sin tipo Clase). Solo se usa con el módulo prendido.
   */
  servicio: string;
  /** Servicios A4 (F141): solo las cargadas a mano. */
  manual: boolean;
  pagina: number;
}

export const EMPTY_FILTERS: CallFilters = {
  closer: "", contacto: "", area: "", tipo: "", resultado: "", estado: "", vinculo: "",
  closerMin: null, closerMax: null, leadMin: null, leadMax: null,
  desde: "", hasta: "", q: "", servicio: "", manual: false, pagina: 1,
};

/** Los valores especiales del filtro Servicio (F136). */
export const SERVICE_FILTER_REVIEW = "review";
export const SERVICE_FILTER_NONE = "sin";

export interface FilterContext {
  /** Los closers que existen: un id inventado en la URL se ignora. */
  closerIds: Iterable<string>;
  /** Servicios A4: con el módulo apagado, el filtro de servicio se ignora. */
  servicesOn?: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function score(value: string | string[] | undefined): number | null {
  const raw = firstParam(value);
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function dateParam(value: string | string[] | undefined): string {
  const raw = firstParam(value);
  if (!DATE_ONLY.test(raw)) return "";
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? raw : "";
}

/** Lee los filtros de la URL. Un valor desconocido se ignora: nunca lanza. */
export function parseCallFilters(sp: SearchParams, ctx: FilterContext): CallFilters {
  const closers = new Set(ctx.closerIds);
  const closer = firstParam(sp.closer);
  const tipo = firstParam(sp.tipo);
  const area = firstParam(sp.area);
  const resultado = firstParam(sp.resultado);
  return {
    closer: closers.has(closer) ? closer : "",
    contacto: UUID_PARAM.test(firstParam(sp.contacto)) ? firstParam(sp.contacto) : "",
    area: area === UNCLASSIFIED_AREA || UUID_PARAM.test(area) ? area : "",
    tipo: UUID_PARAM.test(tipo) ? tipo : "",
    resultado: /^[a-z0-9_]{1,60}$/.test(resultado) ? resultado : "",
    estado: pickEnum<CallAnalysisStatus, "">(sp.estado, ANALYSIS_STATUSES, ""),
    vinculo: pickEnum<(typeof LINK_FILTERS)[number], "">(sp.vinculo, LINK_FILTERS, ""),
    closerMin: score(sp.cmin),
    closerMax: score(sp.cmax),
    leadMin: score(sp.lmin),
    leadMax: score(sp.lmax),
    desde: dateParam(sp.desde),
    hasta: dateParam(sp.hasta),
    q: sanitizeSearch(firstParam(sp.q), 80),
    servicio: ctx.servicesOn ? serviceParam(firstParam(sp.servicio)) : "",
    manual: firstParam(sp.manual) === "1",
    pagina: pickPage(sp.pagina),
  };
}

function serviceParam(raw: string): string {
  if (raw === SERVICE_FILTER_REVIEW || raw === SERVICE_FILTER_NONE) return raw;
  return UUID_PARAM.test(raw) ? raw : "";
}

/** Los filtros activos (sin contar la pagina), para el contador del boton. */
export function countActiveCallFilters(f: CallFilters): number {
  return [
    f.closer, f.contacto, f.area, f.tipo, f.resultado, f.estado, f.vinculo, f.desde, f.hasta, f.q,
    f.closerMin, f.closerMax, f.leadMin, f.leadMax, f.servicio, f.manual ? "1" : "",
  ].filter((v) => v !== "" && v !== null).length;
}

/** Los filtros como parametros de URL (para los links y las vistas guardadas). */
export function callFiltersToParams(f: CallFilters): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | null) => { if (v !== "" && v !== null) p.set(k, String(v)); };
  put("closer", f.closer); put("contacto", f.contacto); put("area", f.area); put("tipo", f.tipo); put("resultado", f.resultado); put("estado", f.estado);
  put("vinculo", f.vinculo); put("cmin", f.closerMin); put("cmax", f.closerMax);
  put("lmin", f.leadMin); put("lmax", f.leadMax); put("desde", f.desde); put("hasta", f.hasta); put("q", f.q);
  put("servicio", f.servicio); if (f.manual) p.set("manual", "1");
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  return p;
}

/** Lo minimo del constructor de consultas de Supabase que se necesita aca. */
export interface FilterableQuery<Q> {
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  or(filters: string): Q;
}

export interface ApplyOptions {
  timeZone: string;
  /** Contactos cuyo nombre coincide con la busqueda (los resuelve el servidor con la RLS). */
  searchContactIds?: string[];
  /**
   * Para «Sin servicio» (F136): el área Servicio y el tipo Clase (ids de `booking_categories`). Sin el área, el filtro
   * no trae nada (no hay reuniones de servicio que mostrar).
   */
  serviceAreaId?: string | null;
  classTypeId?: string | null;
}

/**
 * Aplica los filtros A LA CONSULTA (no en memoria). Siempre excluye las
 * archivadas. La visibilidad NO se arma aca: la decide la RLS.
 */
export function applyCallFilters<Q extends FilterableQuery<Q>>(query: Q, f: CallFilters, opts: ApplyOptions): Q {
  let q = query.is("archived_at", null);
  if (f.closer) q = q.eq("recorded_by_user_id", f.closer);
  if (f.contacto) q = q.eq("contact_id", f.contacto);
  if (f.area === UNCLASSIFIED_AREA) q = q.is("area_id", null).eq("no_show", false);
  else if (f.area) q = q.eq("area_id", f.area);
  if (f.tipo) q = q.eq("category_id", f.tipo);
  if (f.resultado) q = q.eq("outcome", f.resultado);
  if (f.estado) q = q.eq("analysis_status", f.estado);
  if (f.vinculo === "sin_vincular") q = q.is("contact_id", null);
  if (f.vinculo === "vinculada") q = q.not("contact_id", "is", null);
  if (f.closerMin !== null) q = q.gte("closer_score", f.closerMin);
  if (f.closerMax !== null) q = q.lte("closer_score", f.closerMax);
  if (f.leadMin !== null) q = q.gte("lead_score", f.leadMin);
  if (f.leadMax !== null) q = q.lte("lead_score", f.leadMax);
  if (f.desde) {
    const [y, m, d] = f.desde.split("-").map(Number);
    q = q.gte("recorded_at", startOfDay(y, m, d, opts.timeZone).toISOString());
  }
  if (f.hasta) {
    const [y, m, d] = f.hasta.split("-").map(Number);
    q = q.lte("recorded_at", endOfDay(y, m, d, opts.timeZone).toISOString());
  }
  if (f.servicio === SERVICE_FILTER_REVIEW) q = q.eq("service_link", "review");
  else if (f.servicio === SERVICE_FILTER_NONE) {
    // Las del área Servicio sin servicio, que no son de tipo Clase.
    q = q.eq("area_id", opts.serviceAreaId ?? "00000000-0000-0000-0000-000000000000").is("service_id", null);
    if (opts.classTypeId) q = q.or(`category_id.is.null,category_id.neq.${opts.classTypeId}`);
  } else if (f.servicio) q = q.eq("service_id", f.servicio);
  if (f.manual) q = q.not("summary->manual", "is", null);
  if (f.q) {
    const parts = [`title.ilike.%${f.q}%`];
    const ids = (opts.searchContactIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length > 0) parts.push(`contact_id.in.(${ids.join(",")})`);
    q = q.or(parts.join(","));
  }
  return q;
}

/** Las columnas que lee la lista (nunca la transcripcion ni el analisis entero). */
export const CALL_LIST_COLUMNS =
  "id, title, recorded_at, duration_seconds, recorded_by_user_id, recorded_by_email, contact_id, booking_id, area_id, category_id, category_snapshot, no_show, classification_source, classification_rule, classification_confidence, analysis_status, analysis_status_reason, closer_score, lead_score, lead_qualification, outcome, has_open_alerts, source, link_method";

/** Con el módulo de Servicios prendido (Servicios A4, F136): suma el servicio y su vínculo. */
export const CALL_LIST_SERVICE_COLUMNS = ", service_id, service_link";

/**
 * Las columnas de la tabla de Grabaciones, en orden. Servicio aparece solo con el módulo prendido y se puede ocultar.
 * `hideable` = la persona la puede ocultar desde «Columnas».
 */
export type CallListColumn = { key: string; label: string; hideable: boolean };

export function callListColumns(opts: { servicesOn: boolean }): CallListColumn[] {
  const base: CallListColumn[] = [
    { key: "lead", label: "Lead / llamada", hideable: false },
    { key: "fecha", label: "Fecha", hideable: false },
    { key: "duracion", label: "Duración", hideable: false },
    { key: "grabo", label: "Quien grabó", hideable: false },
    { key: "tipo", label: "Tipo", hideable: false },
  ];
  if (opts.servicesOn) base.push({ key: "servicio", label: "Servicio", hideable: true });
  base.push(
    { key: "resultado", label: "Resultado", hideable: false },
    { key: "closer", label: "Puntaje closer", hideable: false },
    { key: "lead_score", label: "Puntaje lead", hideable: false },
    { key: "estado", label: "Estado", hideable: false },
    { key: "alertas", label: "", hideable: false },
  );
  return base;
}

/** Lo que muestra la celda Servicio: el servicio (producto · variante), «Por revisar» o vacío. */
export function serviceCellLabel(link: string | null, serviceLabel: string | null): { text: string; review: boolean } {
  if (link === "review") return { text: "Por revisar", review: true };
  return { text: serviceLabel ?? "", review: false };
}

// ── Columnas visibles (vistas guardadas por persona) ──────────────────────

export interface ColumnConfig { key: string; label: string; visible: boolean }

/** Fusiona columnas guardadas con las por defecto: respeta orden y visibilidad guardados, suma nuevas, quita desconocidas. */
export function mergeColumns(saved: ColumnConfig[] | null | undefined, defaults: ColumnConfig[]): ColumnConfig[] {
  if (!saved || saved.length === 0) return defaults;
  const byKey = new Map(defaults.map((c) => [c.key, c]));
  const out: ColumnConfig[] = [];
  for (const s of saved) {
    const d = byKey.get(s.key);
    if (!d) continue;
    out.push({ ...d, visible: !!s.visible });
    byKey.delete(s.key);
  }
  for (const d of defaults) if (byKey.has(d.key)) out.push(d);
  return out;
}

/** Vistas guardadas: viven en el navegador, por persona y workspace (plano §21). */
export interface SavedView { id: string; name: string; params: string }

export function savedViewsKey(workspaceId: string, userId: string): string {
  return `calls:views:${workspaceId}:${userId}`;
}

/** Lee las vistas guardadas de un texto; lo que no se entiende se ignora. */
export function parseSavedViews(raw: string | null | undefined): SavedView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is SavedView => !!v && typeof v === "object" && typeof (v as SavedView).id === "string" && typeof (v as SavedView).name === "string" && typeof (v as SavedView).params === "string")
      .slice(0, 12);
  } catch {
    return [];
  }
}
