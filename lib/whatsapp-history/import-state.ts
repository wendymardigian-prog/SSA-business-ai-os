/**
 * El estado de la importacion del historial de WhatsApp (`channels.inbox_import`).
 *
 * Es PURO: decide que hacer despues de cada tanda o de cada fallo, sin tocar la
 * base ni Evolution. Lleva su propia forma (`kind`) porque no pagina como Zernio:
 * recorre los chats ordenados por su id, asi un chat que recibe un mensaje nuevo
 * no cambia de lugar y no se saltea ninguno.
 */

export type WhatsappImportStatus = "running" | "done" | "partial";

export interface WhatsappImportState {
  kind: "whatsapp_history";
  run_id: string;
  status: WhatsappImportStatus;
  /** El ultimo chat (`remoteJid`) ya importado. null = desde el principio. */
  cursor: string | null;
  /** Numero de vuelta: dos trabajos con el mismo paso no avanzan los dos. */
  step: number;
  /** Chats con personas que hay para mirar y cuantos se miraron. */
  total: number;
  scanned: number;
  /** Conversaciones creadas y mensajes guardados. */
  conversations: number;
  messages: number;
  /** Chats que no se pudieron importar, o que se cortaron en el tope. */
  failed: number;
  /** Reintentos seguidos de la tanda actual. */
  retries: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  /** El motivo en simple. Nunca lleva claves ni datos de personas. */
  last_error: string | null;
}

/** Lo que devuelven las acciones de la tarjeta. Vive aca: un archivo "use server" solo exporta funciones. */
export type WhatsappImportActionResult = { ok: true; state: WhatsappImportState | null } | { ok: false; error: string };

/** Esperas ante un fallo pasajero de Evolution. Despues del ultimo, queda incompleta. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
/** Una corrida sin novedades hace mas que esto se considera muerta y se puede reemplazar. */
export const STALE_RUNNING_MS = 30 * 60_000;

export function newWhatsappImportState(runId: string, now: Date): WhatsappImportState {
  const at = now.toISOString();
  return {
    kind: "whatsapp_history",
    run_id: runId,
    status: "running",
    cursor: null,
    step: 0,
    total: 0,
    scanned: 0,
    conversations: 0,
    messages: 0,
    failed: 0,
    retries: 0,
    started_at: at,
    updated_at: at,
    finished_at: null,
    last_error: null,
  };
}

/** Lo guardado en la columna. Cualquier otra forma (la de Zernio, por ejemplo) es null. */
export function parseWhatsappImportState(raw: unknown): WhatsappImportState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<WhatsappImportState>;
  if (s.kind !== "whatsapp_history" || typeof s.run_id !== "string" || !s.run_id) return null;
  if (!["running", "done", "partial"].includes(s.status as string)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    kind: "whatsapp_history",
    run_id: s.run_id,
    status: s.status as WhatsappImportStatus,
    cursor: str(s.cursor),
    step: n(s.step),
    total: n(s.total),
    scanned: n(s.scanned),
    conversations: n(s.conversations),
    messages: n(s.messages),
    failed: n(s.failed),
    retries: n(s.retries),
    started_at: str(s.started_at) ?? new Date(0).toISOString(),
    updated_at: str(s.updated_at) ?? new Date(0).toISOString(),
    finished_at: str(s.finished_at),
    last_error: str(s.last_error),
  };
}

/** No se arma otra mientras una corre de verdad: dos clics darian dos importaciones. */
export function canStartWhatsappImport(state: WhatsappImportState | null, now: Date): boolean {
  if (!state || state.status !== "running") return true;
  return now.getTime() - new Date(state.updated_at).getTime() > STALE_RUNNING_MS;
}

export interface BatchResult {
  /** El ultimo chat que se termino en esta tanda. null si no se termino ninguno. */
  lastChat: string | null;
  total: number;
  scanned: number;
  conversations: number;
  messages: number;
  failed: number;
  /** Si quedan chats por mirar. */
  hasMore: boolean;
  /** Si habia mas chats que el tope que se lee. */
  truncated: boolean;
}

export type NextStep = { kind: "continue" } | { kind: "wait"; runAt: Date } | { kind: "finished" };

/** Lo que se avanzo, aplicado sobre el estado (tambien sirve antes de un fallo). */
function withProgress(state: WhatsappImportState, batch: BatchResult): WhatsappImportState {
  return {
    ...state,
    cursor: batch.lastChat ?? state.cursor,
    total: batch.total,
    scanned: state.scanned + batch.scanned,
    conversations: state.conversations + batch.conversations,
    messages: state.messages + batch.messages,
    failed: state.failed + batch.failed,
  };
}

/** Despues de una tanda sin fallos de Evolution. */
export function afterBatch(
  state: WhatsappImportState,
  batch: BatchResult,
  now: Date,
): { state: WhatsappImportState; next: NextStep } {
  const at = now.toISOString();
  const base = { ...withProgress(state, batch), retries: 0, updated_at: at, last_error: null };
  if (batch.hasMore) return { state: base, next: { kind: "continue" } };

  const problem = batch.truncated
    ? "Hay más conversaciones que el máximo que se lee de una vez."
    : base.failed > 0
      ? `${base.failed.toLocaleString("es-AR")} no se pudieron traer completas. Podés volver a importar: lo que ya está no se duplica.`
      : null;
  return {
    state: { ...base, status: problem ? "partial" : "done", finished_at: at, last_error: problem },
    next: { kind: "finished" },
  };
}

/**
 * Despues de un fallo de Evolution. Lo terminado antes del fallo queda contado. Uno
 * pasajero espera y sigue desde ahi (1, 5 y 15 minutos); agotados los reintentos, o
 * con uno que no se arregla esperando, queda incompleta con el motivo.
 */
export function afterImportFailure(
  state: WhatsappImportState,
  batch: BatchResult,
  failure: { temporary: boolean; message: string },
  now: Date,
): { state: WhatsappImportState; next: NextStep } {
  const at = now.toISOString();
  const base = { ...withProgress(state, batch), updated_at: at, last_error: failure.message };
  // Si avanzo algo, el fallo no viene de seguido: se vuelve a contar desde cero.
  const retries = batch.scanned > 0 ? 0 : state.retries;
  if (failure.temporary && retries < RETRY_DELAYS_MS.length) {
    return {
      state: { ...base, retries: retries + 1 },
      next: { kind: "wait", runAt: new Date(now.getTime() + RETRY_DELAYS_MS[retries]) },
    };
  }
  return { state: { ...base, status: "partial", finished_at: at }, next: { kind: "finished" } };
}

/** El texto en simple de un fallo de Evolution, y si se arregla esperando. */
export function describeEvolutionFailure(status: number | undefined): { temporary: boolean; message: string } {
  if (status === 401 || status === 403) {
    return { temporary: false, message: "Evolution rechazó la clave. Revisala en Integraciones y volvé a importar." };
  }
  if (status === 404) {
    return { temporary: false, message: "Evolution no encontró este número. Revisá que siga conectado." };
  }
  return { temporary: true, message: "Evolution no respondió. Se reintenta sola." };
}

export interface WhatsappImportView {
  tone: "progress" | "ok" | "warning";
  text: string;
  detail: string | null;
  running: boolean;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? uno : varios}`;
}

/** Que mostrar en la tarjeta del numero. */
export function whatsappImportView(state: WhatsappImportState | null): WhatsappImportView | null {
  if (!state) return null;
  const saved = `${plural(state.conversations, "conversación nueva", "conversaciones nuevas")} y ${plural(state.messages, "mensaje", "mensajes")}`;

  if (state.status === "running") {
    const of = state.total > 0 ? ` ${state.scanned.toLocaleString("es-AR")} de ${state.total.toLocaleString("es-AR")} revisadas.` : "";
    return {
      tone: "progress",
      text: state.retries > 0 ? `Importando: Evolution no respondió, sigue sola.${of}` : `Importando…${of} ${saved} hasta ahora.`,
      detail: null,
      running: true,
    };
  }
  if (state.status === "done") {
    return { tone: "ok", text: `Importación lista: ${saved}.`, detail: null, running: false };
  }
  return { tone: "warning", text: `La importación quedó incompleta: ${saved}.`, detail: state.last_error, running: false };
}
