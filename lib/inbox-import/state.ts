/**
 * El estado de la importacion de conversaciones de un canal de Zernio (00267).
 *
 * Es PURO: decide que hacer despues de cada pagina o de cada fallo, sin tocar la
 * base ni Zernio. Lo usan el trabajo de la cola (`lib/jobs/handlers/inbox-import.ts`),
 * el arranque (`lib/inbox-import/start.ts`) y la pantalla de Canales.
 *
 * Por que existe: la importacion vieja se cortaba en 200 conversaciones, corria una
 * sola vez dentro de la peticion y volvia a mirar siempre las mismas 200. Zernio
 * trae el historial viejo de Instagram (hasta 500 por cuenta) EN SEGUNDO PLANO y
 * sin avisar, asi que lo que llegaba tarde no entraba nunca.
 */

/** 1 = al conectar, 2 = a las 24 horas, 3 = a los 7 dias, manual = "Sincronizar canales" despues. */
export type ImportPass = 1 | 2 | 3 | "manual";

/** Zernio separa las conversaciones activas de las archivadas: se piden las dos. */
export type ImportPhase = "active" | "archived";

export type ImportStatus = "running" | "done" | "partial" | "error";

export interface InboxImportState {
  /** Identifica la corrida: una vuelta de una corrida vieja se reconoce y no sigue. */
  run_id: string;
  status: ImportStatus;
  pass: ImportPass;
  phase: ImportPhase;
  /** Por donde va en la fase actual. null = desde el principio. */
  cursor: string | null;
  /** Numero de vuelta: dos trabajos con el mismo paso no avanzan los dos. */
  step: number;
  /** Paginas leidas en la fase actual (para cortar una vuelta infinita). */
  pages: number;
  /** Conversaciones que miro, en las dos fases. */
  scanned: number;
  /** Conversaciones nuevas que importo. */
  imported: number;
  /** Reintentos seguidos de la pagina actual. */
  retries: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  /** Cuando corre la pasada siguiente, si hay. */
  next_pass_at: string | null;
  /** El motivo en simple si quedo incompleta. Nunca lleva claves ni datos de personas. */
  last_error: string | null;
}

/** Conversaciones por pagina que se le piden a Zernio. */
export const PAGE_SIZE = 50;
/** Paginas por vuelta del trabajo: 100 conversaciones, que tardan segundos y no minutos. */
export const PAGES_PER_STEP = 2;
/** Tope por fase: 10.000 conversaciones. Pasarlo es una vuelta infinita, no una cuenta real. */
export const MAX_PAGES_PER_PHASE = 200;
/** Esperas ante un 429 o un 5xx de Zernio. Despues del ultimo, la importacion queda incompleta. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
/** Una corrida "running" sin novedades hace mas que esto se considera muerta y se puede reemplazar. */
export const STALE_RUNNING_MS = 30 * 60_000;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Una corrida nueva, desde el principio. */
export function newImportState(pass: ImportPass, runId: string, now: Date): InboxImportState {
  const at = now.toISOString();
  return {
    run_id: runId,
    status: "running",
    pass,
    phase: "active",
    cursor: null,
    step: 0,
    pages: 0,
    scanned: 0,
    imported: 0,
    retries: 0,
    started_at: at,
    updated_at: at,
    finished_at: null,
    next_pass_at: null,
    last_error: null,
  };
}

/**
 * Lee lo que hay en `channels.inbox_import`. Cualquier cosa que no tenga la forma
 * esperada se toma como "nunca se importo": la pantalla no se rompe y la proxima
 * sincronizacion arranca de cero.
 */
export function parseImportState(raw: unknown): InboxImportState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<InboxImportState>;
  if (typeof s.run_id !== "string" || !s.run_id) return null;
  if (!["running", "done", "partial", "error"].includes(s.status as string)) return null;
  if (![1, 2, 3, "manual"].includes(s.pass as ImportPass)) return null;
  if (s.phase !== "active" && s.phase !== "archived") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    run_id: s.run_id,
    status: s.status as ImportStatus,
    pass: s.pass as ImportPass,
    phase: s.phase,
    cursor: str(s.cursor),
    step: n(s.step),
    pages: n(s.pages),
    scanned: n(s.scanned),
    imported: n(s.imported),
    retries: n(s.retries),
    started_at: str(s.started_at) ?? new Date(0).toISOString(),
    updated_at: str(s.updated_at) ?? new Date(0).toISOString(),
    finished_at: str(s.finished_at),
    next_pass_at: str(s.next_pass_at),
    last_error: str(s.last_error),
  };
}

/**
 * Si se puede arrancar una corrida nueva. No, mientras otra esta corriendo de
 * verdad (tuvo novedades en la ultima media hora, que cubre la espera mas larga
 * de un reintento): si no, "Sincronizar" dos veces armaria dos importaciones.
 */
export function canStartImport(state: InboxImportState | null, now: Date): boolean {
  if (!state || state.status !== "running") return true;
  return now.getTime() - new Date(state.updated_at).getTime() > STALE_RUNNING_MS;
}

/**
 * La pasada de "Sincronizar canales": la primera si el canal nunca se importo (y
 * entonces vienen tambien la de 24 horas y la de 7 dias); si ya se importo, una
 * pasada suelta, sin repeticiones.
 */
export function passForManualStart(state: InboxImportState | null): ImportPass {
  return state ? "manual" : 1;
}

/** La pasada que sigue y cuando, contada desde que termina esta. */
export function followUpPass(pass: ImportPass): { pass: ImportPass; delayMs: number } | null {
  if (pass === 1) return { pass: 2, delayMs: DAY };
  // La 3 cae a los 7 dias de conectar: 1 dia hasta la 2, y 6 mas.
  if (pass === 2) return { pass: 3, delayMs: 6 * DAY };
  return null;
}

export interface PageResult {
  /** Conversaciones que vinieron en la pagina. */
  received: number;
  /** De esas, cuantas eran nuevas. */
  imported: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** Lo que tiene que pasar despues: otra pagina enseguida, una espera, o nada. */
export type NextAction =
  | { kind: "page" }
  | { kind: "wait"; runAt: Date }
  | { kind: "finished"; followUp: { pass: ImportPass; runAt: Date } | null };

/**
 * Despues de una pagina leida bien.
 *
 * - Hay mas: sigue con el cursor nuevo, salvo que el cursor se repita o se pase el
 *   tope (una vuelta infinita), y entonces queda incompleta.
 * - No hay mas y estaba en las activas: pasa a las archivadas, desde el principio.
 * - No hay mas y estaba en las archivadas: termino.
 */
export function afterPage(
  state: InboxImportState,
  page: PageResult,
  now: Date,
): { state: InboxImportState; next: NextAction } {
  const at = now.toISOString();
  const base: InboxImportState = {
    ...state,
    pages: state.pages + 1,
    scanned: state.scanned + page.received,
    imported: state.imported + page.imported,
    retries: 0,
    updated_at: at,
    last_error: null,
  };

  if (page.hasMore && page.nextCursor) {
    if (page.nextCursor === state.cursor || base.pages >= MAX_PAGES_PER_PHASE) {
      return finish(
        { ...base, status: "partial", last_error: "Zernio devolvió la misma página otra vez. Probá de nuevo más tarde." },
        now,
      );
    }
    return { state: { ...base, cursor: page.nextCursor }, next: { kind: "page" } };
  }

  if (state.phase === "active") {
    return { state: { ...base, phase: "archived", cursor: null, pages: 0 }, next: { kind: "page" } };
  }

  return finish({ ...base, status: "done" }, now);
}

/**
 * Despues de un fallo leyendo una pagina.
 *
 * Uno temporal (429, 5xx, red) espera y vuelve a pedir la MISMA pagina: 1, 5 y 15
 * minutos. El trabajo no lanza: si lanzara, la cola reintentaria a los 10 segundos
 * encima de esta espera. Agotados los reintentos, o con un fallo que no se arregla
 * esperando, queda incompleta con el motivo. Lo importado hasta ahi queda.
 */
export function afterFailure(
  state: InboxImportState,
  failure: { temporary: boolean; message: string },
  now: Date,
): { state: InboxImportState; next: NextAction } {
  const at = now.toISOString();
  if (failure.temporary && state.retries < RETRY_DELAYS_MS.length) {
    const delay = RETRY_DELAYS_MS[state.retries];
    return {
      state: { ...state, retries: state.retries + 1, updated_at: at, last_error: failure.message },
      next: { kind: "wait", runAt: new Date(now.getTime() + delay) },
    };
  }
  return finish({ ...state, status: "partial", updated_at: at, last_error: failure.message }, now);
}

/** Cierra la corrida y, si corresponde, agenda la pasada siguiente (tambien si quedo incompleta). */
function finish(state: InboxImportState, now: Date): { state: InboxImportState; next: NextAction } {
  const follow = followUpPass(state.pass);
  const runAt = follow ? new Date(now.getTime() + follow.delayMs) : null;
  return {
    state: { ...state, finished_at: now.toISOString(), next_pass_at: runAt ? runAt.toISOString() : null },
    next: { kind: "finished", followUp: follow && runAt ? { pass: follow.pass, runAt } : null },
  };
}
