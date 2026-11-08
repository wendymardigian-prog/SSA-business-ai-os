/**
 * La pestaña Generaciones de una plantilla (F53): filtros con contadores, búsqueda, páginas de 50 y lo que muestra cada
 * fila. Todo lo que decide la pantalla vive acá, puro y con su test; el componente solo lo dibuja.
 *
 * Una generación es una fila de `designs` con `template_id`. La fila trae el motivo de por qué se hizo («Cómo se
 * generó»), el estado con su motivo y qué se puede hacer con ella según su estado y los permisos. Lo que el permiso no da
 * NO se devuelve (se oculta, nunca se deshabilita).
 *
 * Módulo puro.
 */

import { whenLabel } from "./list";

export const GENERATIONS_PAGE_SIZE = 50;
/** Cada cuánto se vuelve a leer la lista mientras haya piezas «En proceso». */
export const GENERATIONS_POLL_MS = 5_000;

export const GENERATION_FILTERS = ["todas", "generadas", "fallidas", "en_proceso", "anuladas"] as const;
export type GenerationFilter = (typeof GENERATION_FILTERS)[number];

export const GENERATION_FILTER_LABELS: Record<GenerationFilter, string> = {
  todas: "Todas",
  generadas: "Generadas",
  fallidas: "Fallidas",
  en_proceso: "En proceso",
  anuladas: "Anuladas",
};

export type GenerationStatus = "draft" | "queued" | "rendering" | "ready" | "failed" | "void";

/** Qué estados de la base entran en cada filtro (`null` = todos). */
export const FILTER_STATUSES: Record<GenerationFilter, readonly GenerationStatus[] | null> = {
  todas: null,
  generadas: ["ready"],
  fallidas: ["failed"],
  en_proceso: ["queued", "rendering"],
  anuladas: ["void"],
};

export type GenerationCounts = Record<GenerationFilter, number>;

export const EMPTY_COUNTS: GenerationCounts = { todas: 0, generadas: 0, fallidas: 0, en_proceso: 0, anuladas: 0 };

/** Los contadores de los cinco filtros a partir de cuántas piezas hay en cada estado. */
export function countsFromStatuses(byStatus: Partial<Record<GenerationStatus, number>>): GenerationCounts {
  const n = (s: GenerationStatus) => byStatus[s] ?? 0;
  return {
    todas: n("queued") + n("rendering") + n("ready") + n("failed") + n("void") + n("draft"),
    generadas: n("ready"),
    fallidas: n("failed"),
    en_proceso: n("queued") + n("rendering"),
    anuladas: n("void"),
  };
}

// ─── La URL: ?tab=generaciones&estado=…&q=…&pagina=… ────────────────────────

export interface GenerationFilters {
  estado: GenerationFilter;
  q: string;
  page: number;
}

export const DEFAULT_GENERATION_FILTERS: GenerationFilters = { estado: "todas", q: "", page: 1 };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function pick(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Lee la URL. Todo valor se valida: uno que no existe es el de siempre. */
export function parseGenerationFilters(params: Params): GenerationFilters {
  const estado = pick(params, "estado");
  const page = Number.parseInt(pick(params, "pagina") ?? "1", 10);
  return {
    estado: (GENERATION_FILTERS as readonly string[]).includes(estado ?? "") ? (estado as GenerationFilter) : "todas",
    q: (pick(params, "q") ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Los filtros como parámetros de la URL (sin el «?»). Lo que es el valor de siempre no se escribe; `tab` va siempre. */
export function generationFiltersToQuery(filters: GenerationFilters): string {
  const params = new URLSearchParams({ tab: "generaciones" });
  if (filters.estado !== "todas") params.set("estado", filters.estado);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.page > 1) params.set("pagina", String(filters.page));
  return params.toString();
}

/** Cambiar el filtro o la búsqueda vuelve a la página 1 (la 3 de otra búsqueda no existe). */
export function withGenerationFilter(filters: GenerationFilters, patch: Partial<Omit<GenerationFilters, "page">>): GenerationFilters {
  return { ...filters, ...patch, page: 1 };
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / GENERATIONS_PAGE_SIZE));
}

/** Las filas de la página `page` (desde 1) para `.range(from, to)`. */
export function generationsRange(page: number): { from: number; to: number } {
  const from = (Math.max(page, 1) - 1) * GENERATIONS_PAGE_SIZE;
  return { from, to: from + GENERATIONS_PAGE_SIZE - 1 };
}

/**
 * La búsqueda por nombre o código para el `or` de PostgREST. El código se busca con o sin guiones. Los caracteres que
 * rompen la sintaxis del `or` (coma, paréntesis) o son comodines no entran.
 */
export function searchOrFilter(raw: string): string | null {
  const q = raw.replace(/[,()*%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) return null;
  const parts = [`name.ilike.%${q}%`, `code.ilike.%${q}%`];
  // Un código escrito sin guiones («k8f2wq4m») también se encuentra: se busca con los guiones de siempre.
  const compact = q.replace(/[\s-]+/g, "").toUpperCase().slice(0, 12);
  const hyphenated = compact.match(/.{1,4}/g)?.join("-") ?? compact;
  if (compact.length >= 4 && /^[0-9A-Z]+$/.test(compact) && hyphenated.toLowerCase() !== q.toLowerCase()) parts.push(`code.ilike.%${hyphenated}%`);
  return parts.join(",");
}

// ─── Una fila ───────────────────────────────────────────────────────────────

export type SourceRef = Record<string, unknown> | null;

/** Lo que trae cada generación de la base, ya con los nombres resueltos por quien la leyó. */
export interface GenerationRecord {
  id: string;
  name: string;
  code: string;
  status: GenerationStatus;
  error: string | null;
  voidReason: string | null;
  createdAt: string;
  source: "manual" | "bulk" | "automation" | "module" | null;
  sourceRef: SourceRef;
  /** Para quién: nombre y dato secundario (el email) ya congelados en los valores, o el rótulo de un módulo. */
  subjectName: string | null;
  subjectDetail: string | null;
  published: boolean;
  attempts: number;
  emailStatus: "sent" | "failed" | "skipped" | null;
  /** Si pidió un email al emitirla (`source_ref.email_request`). */
  emailRequested: boolean;
  /** Si tiene un contacto con email para mandarle (lo sabe quien arma la lista). */
  canEmail: boolean;
}

/** Lo que hace falta saber para escribir «Cómo se generó» y las acciones. */
export interface RowContext {
  /** user_id → nombre (el equipo). */
  people: Readonly<Record<string, string>>;
  /** flow_id → nombre de la automatización. */
  flows: Readonly<Record<string, string>>;
  /** módulo → cómo se llama en pantalla. */
  modules: Readonly<Record<string, string>>;
  can: { generate: boolean };
  template: { verify: boolean };
  now: Date;
  timeZone: string;
}

export type StateTone = "ok" | "bad" | "act" | "off";

export interface RowState {
  key: "ready" | "failed" | "processing" | "void";
  label: string;
  tone: StateTone;
  /** En rojo si falló; el motivo de la anulación si está anulada. */
  reason: string | null;
}

export type RowAction = "view" | "copy_link" | "void" | "regenerate" | "retry" | "detail";

export interface GenerationRowView {
  id: string;
  when: string;
  para: { name: string; detail: string | null };
  origin: { text: string; href: string | null };
  state: RowState;
  /** Las acciones que se dibujan, en orden. Lo que el permiso no da no está. */
  actions: RowAction[];
  /** Si se está armando (se vuelve a leer sola). */
  processing: boolean;
  code: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * «Cómo se generó» (F53): A mano · <persona> / Automatización «<nombre>» (con link a la corrida) / Para varios /
 * <módulo>. Un dato que ya no se puede resolver (una persona o una automatización borradas) deja el texto genérico.
 */
export function originOf(g: Pick<GenerationRecord, "source" | "sourceRef">, ctx: Pick<RowContext, "people" | "flows" | "modules">): { text: string; href: string | null } {
  const ref = g.sourceRef ?? {};
  switch (g.source) {
    case "manual": {
      const person = str(ref.user_id) ? ctx.people[ref.user_id as string] : null;
      return { text: person ? `A mano · ${person}` : "A mano", href: null };
    }
    case "automation": {
      const flowId = str(ref.flow_id);
      const name = flowId ? ctx.flows[flowId] : null;
      const session = str(ref.session_id);
      const href = flowId ? `/dashboard/flows/${flowId}/ejecuciones${session ? `?ejecucion=${encodeURIComponent(session)}` : ""}` : null;
      return { text: name ? `Automatización «${name}»` : "Automatización", href };
    }
    case "bulk": {
      const person = str(ref.user_id) ? ctx.people[ref.user_id as string] : null;
      return { text: person ? `Para varios · ${person}` : "Para varios", href: null };
    }
    case "module": {
      const key = str(ref.module);
      return { text: key ? (ctx.modules[key] ?? capitalize(key)) : "Otro módulo", href: null };
    }
    default:
      return { text: "—", href: null };
  }
}

/** El estado con su motivo: «Falló» + el error en rojo; «Anulado» + el motivo; «En proceso» mientras se arma. */
export function stateOf(g: Pick<GenerationRecord, "status" | "error" | "voidReason">): RowState {
  switch (g.status) {
    case "ready":
      return { key: "ready", label: "Generado", tone: "ok", reason: null };
    case "failed":
      return { key: "failed", label: "Falló", tone: "bad", reason: g.error?.trim() || "No se pudo generar la pieza." };
    case "void":
      return { key: "void", label: "Anulado", tone: "off", reason: g.voidReason?.trim() ? `Motivo: ${g.voidReason.trim()}` : null };
    default:
      return { key: "processing", label: "En proceso", tone: "act", reason: null };
  }
}

/** El link público de la pieza funciona si está publicada o si la plantilla verifica (la verificación se ve sin publicar). */
export function linkWorks(g: Pick<GenerationRecord, "published">, template: { verify: boolean }): boolean {
  return g.published || template.verify;
}

/** Las acciones de una fila, según su estado y el permiso. Ver y Detalle las ve quien ve la plantilla; el resto, quien genera. */
export function actionsOf(g: Pick<GenerationRecord, "status" | "published">, ctx: Pick<RowContext, "can" | "template">): RowAction[] {
  const out: RowAction[] = [];
  const link = linkWorks(g, ctx.template);
  if (g.status === "ready") {
    if (link) out.push("view", "copy_link");
    if (ctx.can.generate) {
      if (ctx.template.verify) out.push("void");
      out.push("regenerate");
    }
  } else if (g.status === "void") {
    if (link) out.push("view");
  } else if (g.status === "failed") {
    if (ctx.can.generate) out.push("retry");
  }
  out.push("detail");
  return out;
}

/** Todo lo que dibuja una fila de la tabla (o una tarjeta en el celular). */
export function generationRow(g: GenerationRecord, ctx: RowContext): GenerationRowView {
  const state = stateOf(g);
  return {
    id: g.id,
    when: whenLabel(g.createdAt, ctx.now, ctx.timeZone),
    para: { name: g.subjectName?.trim() || "Sin nombre", detail: g.subjectDetail },
    origin: originOf(g, ctx),
    state,
    actions: actionsOf(g, ctx),
    processing: state.key === "processing",
    code: g.code,
  };
}

/** Si hay algo «En proceso»: la pestaña vuelve a leer sola cada 5 s hasta que no quede nada. */
export function needsPolling(rows: readonly Pick<GenerationRecord, "status">[]): boolean {
  return rows.some((g) => g.status === "queued" || g.status === "rendering");
}

/** Cuántas fallidas se pueden reintentar de una (el botón «Reintentar las fallidas (N)»). */
export function retryAllLabel(failed: number): string | null {
  return failed > 0 ? `Reintentar las fallidas (${failed})` : null;
}

/** Qué se le dice a quien ve una lista vacía. */
export function emptyMessage(filters: GenerationFilters, total: number, issueLabel: string): string {
  if (filters.q) return "No encontramos piezas con esa búsqueda.";
  if (total === 0) return `Todavía no se generó nada con esta plantilla. Tocá «${issueLabel}» para generar la primera.`;
  return "Nada con este filtro.";
}

/** La línea de resumen del detalle: lo que se usó, ya con los nombres. */
export interface DetailValueRow {
  key: string;
  label: string;
  value: string;
}

/** Las variables que la plantilla usa, con el valor que tuvo la pieza (vacío = «—»). Nunca muestra `design.code` dos veces. */
export function detailValues(values: Readonly<Record<string, string>>, labels: Readonly<Record<string, string>>): DetailValueRow[] {
  return Object.entries(labels).map(([key, label]) => ({ key, label, value: values[key]?.trim() || "—" }));
}

export const EMAIL_STATUS_LABELS: Record<"sent" | "failed" | "skipped", string> = {
  sent: "Email enviado",
  failed: "El email no salió",
  skipped: "El email se salteó (no había a quién o no podía recibirlo)",
};

/** El estado del email para el detalle. */
export function emailStatusText(g: Pick<GenerationRecord, "emailStatus" | "emailRequested">): string {
  if (g.emailStatus) return EMAIL_STATUS_LABELS[g.emailStatus];
  return g.emailRequested ? "Se manda cuando la pieza esté lista" : "No se pidió mandar email";
}

/** «Mandar el email ahora» (F54): si la pieza está lista y el email todavía no salió. */
export function canSendEmailNow(g: Pick<GenerationRecord, "status" | "emailStatus" | "canEmail">, ctx: Pick<RowContext, "can">): boolean {
  return ctx.can.generate && g.status === "ready" && g.canEmail && g.emailStatus !== "sent";
}
