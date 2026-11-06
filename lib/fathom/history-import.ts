/**
 * Importar el historial de Fathom de UNA conexion.
 *
 * Corre en la cola por partes (`fathom_history_import`): cada vuelta gasta el
 * presupuesto de pedidos, guarda el avance y se reencola. Las reglas estan en
 * `./history-state.ts`, que es puro. Aca se habla con la base y con Fathom.
 *
 * Lo importado es historia (`calls.imported_from_history`): no dispara
 * automatizaciones y no se analiza sola. Volver a importar no duplica nada (unico
 * por `external_id`).
 *
 * No lanza por un fallo de Fathom: la cola reintentaria a los 10 segundos encima de
 * la espera propia. Un error de la base guardando el avance si lanza, y la cola lo
 * reintenta.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { BudgetExhausted, listMeetings } from "./api";
import { markFathomConnectionError } from "./auth";
import { FathomError } from "./errors";
import {
  afterHistoryBudget,
  afterHistoryFailure,
  afterHistoryPage,
  historyUpperBound,
  isHistoryRunning,
  newHistoryState,
  parseHistoryState,
  resumeHistoryState,
  stopHistoryState,
  type FathomHistoryState,
  type HistoryNext,
} from "./history-state";
import { ingestItems, openFathomRun, type IngestDeps, type IngestTally } from "./ingest";
import { CONTINUATION_DELAY_MS } from "./rate-budget";

type Db = SupabaseClient<Database>;

export const FATHOM_HISTORY_IMPORT_JOB = "fathom_history_import";

export interface FathomHistoryPayload {
  connectionId: string;
  runId: string;
  step: number;
}

export interface HistoryDeps extends IngestDeps {
  schedule?: typeof scheduleJob;
}

const RECONNECT_MESSAGE = "Fathom cortó el acceso: reconectá tu cuenta y seguí desde donde quedó.";

// ── La base ───────────────────────────────────────────────────────────────

async function loadHistoryRow(db: Db, connectionId: string) {
  const { data, error } = await db
    .from("oauth_connections")
    .select("history_import, sync_watermark")
    .eq("id", connectionId)
    .eq("provider", "fathom")
    .maybeSingle();
  if (error) throw new Error(`no pude leer la importacion: ${error.message}`);
  return data ? { state: parseHistoryState(data.history_import), watermark: data.sync_watermark ?? null } : null;
}

/** Guarda el avance solo si nadie lo cambio: dos vueltas no arman dos cadenas para la misma conexion. */
async function writeIfCurrent(db: Db, connectionId: string, state: FathomHistoryState, expected: FathomHistoryState | null): Promise<boolean> {
  let query = db.from("oauth_connections").update({ history_import: state as unknown as Json }).eq("id", connectionId);
  query = expected
    ? query.eq("history_import->>run_id", expected.run_id).eq("history_import->>step", String(expected.step))
    : query.is("history_import", null);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`no pude guardar el avance de la importacion: ${error.message}`);
  return (data ?? []).length > 0;
}

function enqueue(deps: Pick<HistoryDeps, "schedule">, db: Db, connectionId: string, state: FathomHistoryState, runAt: Date) {
  const payload: FathomHistoryPayload = { connectionId, runId: state.run_id, step: state.step };
  return (deps.schedule ?? scheduleJob)(db, FATHOM_HISTORY_IMPORT_JOB, payload as unknown as Record<string, unknown>, runAt, `${FATHOM_HISTORY_IMPORT_JOB}:${connectionId}:${state.run_id}:${state.step}`);
}

// ── Arrancar, seguir, frenar ──────────────────────────────────────────────

export type HistoryControlResult = { ok: true } | { ok: false; error: string };

/** Una importacion nueva, de `from` (o de todo) hasta donde empieza lo que ya cubre la consulta de cada 10 minutos. */
export async function startHistoryImport(
  deps: Pick<HistoryDeps, "supabase" | "schedule" | "now">,
  connectionId: string,
  from: string | null,
): Promise<HistoryControlResult> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();
  const row = await loadHistoryRow(db, connectionId);
  if (!row) return { ok: false, error: "No encontré tu conexión de Fathom" };
  if (isHistoryRunning(row.state, now)) return { ok: false, error: "Ya hay una importación en curso" };

  const before = historyUpperBound(row.watermark, now);
  if (from && new Date(from).getTime() >= new Date(before).getTime()) {
    return { ok: false, error: "Esas llamadas son recientes y entran solas. Elegí una fecha anterior." };
  }

  const state = newHistoryState({ runId: randomUUID(), from, before, now });
  if (!(await writeIfCurrent(db, connectionId, state, row.state))) return { ok: false, error: "Ya hay una importación en curso" };
  await enqueue(deps, db, connectionId, state, now);
  return { ok: true };
}

/** Sigue una importacion incompleta o frenada desde la pagina donde quedo. */
export async function resumeHistoryImport(deps: Pick<HistoryDeps, "supabase" | "schedule" | "now">, connectionId: string): Promise<HistoryControlResult> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();
  const row = await loadHistoryRow(db, connectionId);
  if (!row?.state) return { ok: false, error: "No hay ninguna importación para seguir" };
  if (isHistoryRunning(row.state, now)) return { ok: false, error: "La importación ya está en curso" };
  if (row.state.status === "done") return { ok: false, error: "Esa importación ya terminó" };

  const state = resumeHistoryState(row.state, now);
  if (!(await writeIfCurrent(db, connectionId, state, row.state))) return { ok: false, error: "La importación cambió recién. Probá de nuevo." };
  await enqueue(deps, db, connectionId, state, now);
  return { ok: true };
}

/** Frena la importacion. Lo que ya entro queda; la vuelta en curso ya no puede pisar esto. */
export async function stopHistoryImport(deps: Pick<HistoryDeps, "supabase" | "now">, connectionId: string): Promise<HistoryControlResult> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();
  const row = await loadHistoryRow(db, connectionId);
  if (!row?.state || row.state.status !== "running") return { ok: false, error: "No hay ninguna importación en curso" };
  if (!(await writeIfCurrent(db, connectionId, stopHistoryState(row.state, now), row.state))) return { ok: false, error: "La importación cambió recién. Probá de nuevo." };
  return { ok: true };
}

// ── Una vuelta ────────────────────────────────────────────────────────────

const NOT_RUNNABLE: Record<"inactive" | "no_permission" | "no_emails", string> = {
  inactive: "Tu Fathom no está conectado. Reconectalo y seguí desde donde quedó.",
  no_permission: "Tu rol ya no tiene permiso para ver grabaciones.",
  no_emails: "No hay ningún correo con el que buscar tus grabaciones.",
};

export type HistoryRunOutcome = "superseded" | "continued" | "finished";

export async function runFathomHistoryImport(deps: HistoryDeps, payload: FathomHistoryPayload): Promise<HistoryRunOutcome> {
  const db = deps.supabase;
  const now = (deps.now ?? (() => new Date()))();

  const row = await loadHistoryRow(db, payload.connectionId);
  const loaded = row?.state ?? null;
  // Una vuelta de una corrida vieja, repetida por la cola o de una importacion frenada: no sigue.
  if (!loaded || loaded.status !== "running" || loaded.run_id !== payload.runId || loaded.step !== payload.step) return "superseded";

  const { state, next } = await advance(deps, payload.connectionId, loaded, now);

  const advanced: FathomHistoryState = { ...state, step: loaded.step + 1 };
  if (!(await writeIfCurrent(db, payload.connectionId, advanced, loaded))) return "superseded";
  if (next.kind === "finished") return "finished";

  await enqueue(deps, db, payload.connectionId, advanced, next.runAt);
  return "continued";
}

async function advance(deps: HistoryDeps, connectionId: string, loaded: FathomHistoryState, now: Date): Promise<{ state: FathomHistoryState; next: HistoryNext }> {
  const opened = await openFathomRun(deps, connectionId);
  if (!opened.ok) {
    if (opened.outcome !== "token_error") return afterHistoryFailure(loaded, { temporary: false, message: NOT_RUNNABLE[opened.outcome] }, now);
    const temporary = !(opened.error instanceof FathomError && opened.error.kind === "permanent");
    return afterHistoryFailure(loaded, { temporary, message: temporary ? "Fathom no respondió." : RECONNECT_MESSAGE }, now);
  }
  const { run } = opened;

  const tally: IngestTally = { ingested: 0, skippedExisting: 0, skippedOtherRecorder: 0 };
  let state = loaded;
  /** Lo que ya se conto en `state`: el resto se suma si la vuelta se corta a mitad de una pagina. */
  let counted = 0;

  try {
    for (;;) {
      const page = await run.withAuth(() =>
        listMeetings(run.api(), { createdAfter: state.from, createdBefore: state.before, recordedBy: run.emails, cursor: state.cursor }),
      );
      await ingestItems(deps, run, page.items, tally, { history: true });
      const after = afterHistoryPage(state, { imported: tally.ingested - counted, nextCursor: page.nextCursor }, now);
      counted = tally.ingested;
      state = after.state;
      if (after.finished) return { state, next: { kind: "finished" } };
    }
  } catch (err) {
    const imported = tally.ingested - counted;
    if (err instanceof BudgetExhausted) {
      return afterHistoryBudget(state, imported, new Date(now.getTime() + CONTINUATION_DELAY_MS), now);
    }
    if (err instanceof FathomError) {
      if (err.status === 401) {
        await markFathomConnectionError(deps.supabase, run.connection, "Fathom cortó el acceso (el permiso se revocó o venció): hay que reconectar");
        return afterHistoryFailure(state, { temporary: false, message: RECONNECT_MESSAGE, imported }, now);
      }
      return afterHistoryFailure(state, { temporary: err.kind === "temporary", message: err.message, imported, retryAfterMs: err.retryAfterMs }, now);
    }
    console.error("[fathom_history_import] fallo inesperado:", err instanceof Error ? err.message : "error");
    return afterHistoryFailure(state, { temporary: true, message: "Falló la consulta a Fathom.", imported }, now);
  }
}
