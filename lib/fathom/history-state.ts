/**
 * El estado de la importacion del historial de Fathom (00295). Puro: decide que
 * hacer despues de cada vuelta o de cada fallo, sin tocar la base ni Fathom.
 *
 * Trae lo ANTERIOR a lo que ya cubre la consulta de cada 10 minutos, por partes y
 * en segundo plano: cada transcripcion es un pedido aparte y Fathom limita cuantos
 * se le pueden hacer por minuto. Si algo falla, lo importado queda y se retoma desde
 * la misma pagina (la llamada es unica por `external_id`: repetir no duplica).
 */

export type HistoryStatus = "running" | "done" | "partial" | "stopped";

export interface FathomHistoryState {
  /** Identifica la corrida: una vuelta de una corrida vieja se reconoce y no sigue. */
  run_id: string;
  status: HistoryStatus;
  /** Desde cuando se trae (ISO). null = todo lo que Fathom tenga. */
  from: string | null;
  /** Hasta cuando se trae (ISO): de ahi en adelante lo cubre la consulta de cada 10 minutos. */
  before: string;
  /** La pagina por la que va. null = la primera. */
  cursor: string | null;
  /** Numero de vuelta: dos trabajos con el mismo paso no avanzan los dos. */
  step: number;
  /** Paginas terminadas (para cortar una vuelta infinita). */
  pages: number;
  /** Llamadas nuevas que importo. */
  imported: number;
  /** Reintentos seguidos sin avanzar. */
  retries: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  /** El motivo en simple si quedo incompleta. Nunca lleva claves ni datos de personas. */
  last_error: string | null;
}

/** Cuanto mira hacia atras la primera consulta al conectar. */
export const INITIAL_WINDOW_MS = 14 * 24 * 3600_000;
/** Esperas ante un fallo temporal. Despues de la ultima, queda incompleta. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
/** Una corrida "running" sin novedades hace mas que esto se considera muerta. */
export const STALE_RUNNING_MS = 30 * 60_000;
/** Tope de paginas. Pasarlo es una vuelta infinita, no una cuenta real. */
export const MAX_PAGES = 5000;

/**
 * Hasta donde llega la importacion. Lo que sigue lo cubre la consulta de cada 10
 * minutos: si la importacion lo trajera primero, una llamada nueva quedaria marcada
 * como historia y no dispararia sus automatizaciones. Sin marca de agua (la primera
 * consulta todavia no termino), se corta donde empieza su ventana.
 */
export function historyUpperBound(watermark: string | null | undefined, now: Date): string {
  return watermark || new Date(now.getTime() - INITIAL_WINDOW_MS).toISOString();
}

export function newHistoryState(input: { runId: string; from: string | null; before: string; now: Date }): FathomHistoryState {
  const at = input.now.toISOString();
  return {
    run_id: input.runId,
    status: "running",
    from: input.from,
    before: input.before,
    cursor: null,
    step: 0,
    pages: 0,
    imported: 0,
    retries: 0,
    started_at: at,
    updated_at: at,
    finished_at: null,
    last_error: null,
  };
}

/** Lo que no tiene la forma esperada se toma como "nunca se importo": la pantalla no se rompe. */
export function parseHistoryState(raw: unknown): FathomHistoryState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<FathomHistoryState>;
  if (typeof s.run_id !== "string" || !s.run_id) return null;
  if (!["running", "done", "partial", "stopped"].includes(s.status as string)) return null;
  if (typeof s.before !== "string" || !s.before) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    run_id: s.run_id,
    status: s.status as HistoryStatus,
    from: str(s.from),
    before: s.before,
    cursor: str(s.cursor),
    step: n(s.step),
    pages: n(s.pages),
    imported: n(s.imported),
    retries: n(s.retries),
    started_at: str(s.started_at) ?? new Date(0).toISOString(),
    updated_at: str(s.updated_at) ?? new Date(0).toISOString(),
    finished_at: str(s.finished_at),
    last_error: str(s.last_error),
  };
}

/** Corre de verdad: tuvo novedades en la ultima media hora, que cubre la espera mas larga. */
export function isHistoryRunning(state: FathomHistoryState | null, now: Date): boolean {
  return !!state && state.status === "running" && now.getTime() - new Date(state.updated_at).getTime() <= STALE_RUNNING_MS;
}

/** Sigue la misma corrida desde donde quedo. */
export function resumeHistoryState(state: FathomHistoryState, now: Date): FathomHistoryState {
  return { ...state, status: "running", step: state.step + 1, retries: 0, updated_at: now.toISOString(), finished_at: null, last_error: null };
}

/** La frena una persona. Sube el paso: una vuelta en curso ya no puede pisar esto. */
export function stopHistoryState(state: FathomHistoryState, now: Date): FathomHistoryState {
  const at = now.toISOString();
  return { ...state, status: "stopped", step: state.step + 1, updated_at: at, finished_at: at, last_error: null };
}

export type HistoryNext = { kind: "continue"; runAt: Date } | { kind: "finished" };

/** Se termino una pagina. Con otra pagina, sigue enseguida; sin mas, termino. */
export function afterHistoryPage(
  state: FathomHistoryState,
  page: { imported: number; nextCursor: string | null },
  now: Date,
): { state: FathomHistoryState; finished: boolean } {
  const at = now.toISOString();
  const base: FathomHistoryState = { ...state, pages: state.pages + 1, imported: state.imported + page.imported, retries: 0, updated_at: at, last_error: null };
  if (!page.nextCursor) return { state: { ...base, cursor: null, status: "done", finished_at: at }, finished: true };
  if (page.nextCursor === state.cursor || base.pages >= MAX_PAGES) {
    return { state: { ...base, status: "partial", finished_at: at, last_error: "Fathom devolvió la misma página otra vez. Probá de nuevo más tarde." }, finished: true };
  }
  return { state: { ...base, cursor: page.nextCursor }, finished: false };
}

/**
 * Se acabo el presupuesto de pedidos de esta vuelta en el medio de una pagina: se
 * guarda lo importado y se vuelve a pedir la MISMA pagina (lo que ya entro se saltea).
 */
export function afterHistoryBudget(state: FathomHistoryState, imported: number, runAt: Date, now: Date): { state: FathomHistoryState; next: HistoryNext } {
  return {
    state: { ...state, imported: state.imported + imported, retries: imported > 0 ? 0 : state.retries, updated_at: now.toISOString(), last_error: null },
    next: { kind: "continue", runAt },
  };
}

/**
 * Un fallo. Uno temporal espera y vuelve a la misma pagina: lo que pidio Fathom si
 * mando un `Retry-After` y es mas largo, y si no 1, 5 y 15 minutos. Agotados los
 * reintentos, o con un fallo que no se arregla esperando, queda incompleta con el
 * motivo. Lo importado hasta ahi queda.
 */
export function afterHistoryFailure(
  state: FathomHistoryState,
  failure: { temporary: boolean; message: string; imported?: number; retryAfterMs?: number | null },
  now: Date,
): { state: FathomHistoryState; next: HistoryNext } {
  const at = now.toISOString();
  const imported = state.imported + (failure.imported ?? 0);
  if (failure.temporary && state.retries < RETRY_DELAYS_MS.length) {
    const delay = Math.max(RETRY_DELAYS_MS[state.retries], failure.retryAfterMs ?? 0);
    return {
      state: { ...state, imported, retries: state.retries + 1, updated_at: at, last_error: failure.message },
      next: { kind: "continue", runAt: new Date(now.getTime() + delay) },
    };
  }
  return { state: { ...state, imported, status: "partial", updated_at: at, finished_at: at, last_error: failure.message }, next: { kind: "finished" } };
}

// ── Lo que muestra la pantalla ────────────────────────────────────────────

export interface HistoryView {
  phase: "idle" | "running" | "done" | "partial" | "stopped";
  title: string;
  message: string;
  imported: number;
  /** Elegir desde cuando y arrancar una importacion nueva. */
  canStart: boolean;
  canResume: boolean;
  canStop: boolean;
}

const importedText = (n: number) => (n === 1 ? "1 llamada" : `${n} llamadas`);

export function historyView(state: FathomHistoryState | null, now: Date): HistoryView {
  if (!state) {
    return {
      phase: "idle",
      title: "Importar historial",
      message: "Trae tus llamadas anteriores de Fathom. Corre en segundo plano: podés cerrar esta pantalla.",
      imported: 0,
      canStart: true,
      canResume: false,
      canStop: false,
    };
  }
  const imported = state.imported;
  if (isHistoryRunning(state, now)) {
    return {
      phase: "running",
      title: "Importando tu historial",
      message: `Ya entraron ${importedText(imported)}. ${state.last_error ? "Fathom pidió esperar: sigue solo en unos minutos." : "Sigue en segundo plano: podés cerrar esta pantalla."}`,
      imported,
      canStart: false,
      canResume: false,
      canStop: true,
    };
  }
  if (state.status === "done") {
    return {
      phase: "done",
      title: "Historial importado",
      message: imported > 0 ? `Entraron ${importedText(imported)} anteriores.` : "No había llamadas anteriores para traer.",
      imported,
      canStart: true,
      canResume: false,
      canStop: false,
    };
  }
  if (state.status === "stopped") {
    return {
      phase: "stopped",
      title: "Importación frenada",
      message: `Entraron ${importedText(imported)} antes de frenarla. Podés seguir desde donde quedó.`,
      imported,
      canStart: true,
      canResume: true,
      canStop: false,
    };
  }
  return {
    phase: "partial",
    title: "La importación quedó incompleta",
    message: `Entraron ${importedText(imported)}. ${state.last_error ?? "Se cortó antes de terminar."}`,
    imported,
    canStart: true,
    canResume: true,
    canStop: false,
  };
}
