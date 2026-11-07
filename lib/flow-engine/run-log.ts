import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * El historial de ejecuciones de una automatizacion (00292).
 *
 * Una regla por encima de todo: **anotar nunca frena un flujo**. Todo lo que escribe a la base esta en try/catch y no
 * lanza, y va en una escritura aparte de los cambios de `status`: una instalacion que despliegue sin la migracion sigue
 * corriendo sus flujos, solo que sin historial.
 *
 * Lo puro (el saneador, las etiquetas, el reparto de lo que avisa un paso) vive aca mismo porque solo lo usa el motor.
 */

type Db = SupabaseClient<Database>;

export type StepStatus = "ok" | "failed" | "skipped" | "waiting" | "deferred";

/** Lo que un paso le cuenta al historial mientras corre. Quien no avisa nada termina como `ok` (o `waiting` si pausa). */
export interface StepNote {
  status: StepStatus;
  /** Se sanea antes de guardar (`sanitizeRunText`): puede ser un texto o un error. */
  reason?: unknown;
  resumesAt?: string | null;
  /**
   * Una clave corta del motivo de un fallo (por ejemplo `already_replied`, de `describeSendError`). Sirve para decidir si
   * se puede reintentar y para agrupar los fallos en las metricas del lienzo. Nunca un texto libre.
   */
  kind?: string | null;
}

/** Por que termino una ejecucion. `lib/flows/runs.ts` lo traduce. */
export type SessionEndReason =
  | "step_failed"
  | "flow_deleted"
  | "flow_unpublished"
  | "node_removed"
  | "depth_limit"
  | "wait_expired"
  | "ai_failed"
  | "job_failed"
  | "reprocessed";

const MAX_TEXT = 300;
const MAX_LABEL = 120;

/**
 * Lo que se guarda de un motivo o de un error. Los textos salen de los proveedores y de la base: pueden traer una
 * direccion de email, una URL con su token o un telefono, y este historial lo lee todo el que ve la automatizacion.
 */
export function sanitizeRunText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = value instanceof Error ? value.message : String(value);
  const clean = raw
    .replace(/https?:\/\/[^\s"'<>)]+/gi, (url) => url.replace(/[?#].*$/, "").replace(/(https?:\/\/[^/]+).*$/i, "$1"))
    .replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [oculto]")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

const SEVERITY: Record<StepStatus, number> = { ok: 0, waiting: 1, skipped: 2, deferred: 3, failed: 4 };

/**
 * Junta lo que avisa un paso. Un paso puede avisar varias veces (un email a tres personas): gana lo mas grave y, entre
 * dos iguales, el primer motivo.
 */
export function mergeStepNote(current: StepNote | null, next: StepNote): StepNote {
  if (!current) return next;
  if (SEVERITY[next.status] > SEVERITY[current.status]) {
    return {
      status: next.status,
      reason: next.reason ?? current.reason ?? null,
      resumesAt: next.resumesAt ?? current.resumesAt ?? null,
      kind: next.kind ?? current.kind ?? null,
    };
  }
  return {
    ...current,
    reason: current.reason ?? next.reason ?? null,
    resumesAt: current.resumesAt ?? next.resumesAt ?? null,
    kind: current.kind ?? next.kind ?? null,
  };
}

/** El estado con el que queda un paso: lo que aviso o, si no aviso nada, lo que se deduce de como termino. */
export function finalStepStatus(note: StepNote | null, result: unknown): StepStatus {
  if (note) return note.status;
  return result === "pause" ? "waiting" : "ok";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** El nombre con el que se ve el paso en el historial. Congelado: sobrevive a que despues editen el flujo. */
export function stepLabel(nodeData: unknown, typeLabel: string): string {
  const data = (nodeData ?? {}) as { label?: unknown; subject?: unknown };
  const custom = text(data.label);
  const detail = custom && custom !== typeLabel ? custom : text(data.subject);
  const label = detail && detail !== typeLabel ? `${typeLabel} · ${detail}` : typeLabel;
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/** Las claves de motivo que se guardan: cortas y sin datos (`a-z`, `_`). Cualquier otra cosa queda en null. */
export function sanitizeErrorKind(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null;
}

/**
 * El handle crudo por el que siguio el paso (`true`, `else`, `p_ab12cd`, `split-1`...), para contar por camino en las
 * metricas del lienzo. La etiqueta se congela aparte; el handle es lo que coincide con las flechas del lienzo.
 */
export function stepExitHandle(result: unknown): string | null {
  if (typeof result !== "string" || !result.startsWith("handle:")) return null;
  const handle = result.slice("handle:".length).trim();
  return handle && handle.length <= 64 ? handle : null;
}

/** Por donde siguio el paso: la etiqueta del camino. Nunca los valores comparados. */
export function stepExitLabel(nodeData: unknown, result: unknown): string | null {
  if (typeof result !== "string" || !result.startsWith("handle:")) return null;
  const handle = result.slice("handle:".length);
  if (handle === "true" || handle === "yes") return "Sí";
  if (handle === "false" || handle === "no") return "No";
  if (handle === "else") return "Si no";
  const paths = (nodeData as { paths?: unknown } | null | undefined)?.paths;
  if (Array.isArray(paths)) {
    const split = /^split-(\d+)$/.exec(handle);
    const path = split
      ? (paths[Number(split[1])] as { label?: unknown; name?: unknown } | undefined)
      : (paths.find((p) => (p as { id?: unknown } | null)?.id === handle) as { label?: unknown; name?: unknown } | undefined);
    const label = text(path?.label) ?? text(path?.name);
    if (label) return label.slice(0, MAX_LABEL);
  }
  return null;
}

export interface RecordStepArgs {
  sessionId: string;
  flowId: string;
  nodeId: string;
  nodeType: string;
  label: string;
  status: StepStatus;
  exitLabel?: string | null;
  /** El handle crudo (`stepExitHandle`). Columna de la 00317. */
  exitHandle?: string | null;
  reason?: unknown;
  /** La clave del motivo (`sanitizeErrorKind`). Columna de la 00317. */
  errorKind?: string | null;
  resumesAt?: string | null;
  startedAt: string;
}

/** Si la base todavia no tiene una columna nueva (la migracion no se aplico): se vuelve a intentar sin ellas. */
function isMissingColumn(error: { code?: string | null } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** Anota un paso. Si fallo, marca tambien la sesion. Nunca lanza. */
export async function recordStep(supabase: Db, args: RecordStepArgs): Promise<void> {
  try {
    const row = {
      session_id: args.sessionId,
      flow_id: args.flowId,
      node_id: args.nodeId,
      node_type: args.nodeType,
      node_label: args.label,
      status: args.status,
      exit_label: args.exitLabel ?? null,
      reason: sanitizeRunText(args.reason),
      resumes_at: args.resumesAt ?? null,
      started_at: args.startedAt,
    };
    const extra = { exit_handle: args.exitHandle ?? null, error_kind: sanitizeErrorKind(args.errorKind) };
    let { error } = await supabase.from("flow_session_steps").insert({ ...row, ...extra });
    // Sin la 00317 la fila se anota igual, sin las dos columnas nuevas: el historial no se pierde por un deploy adelantado.
    if (isMissingColumn(error)) ({ error } = await supabase.from("flow_session_steps").insert(row));
    if (error) console.error(`[flow-engine] no pude anotar el paso (code=${error.code ?? "?"})`);
    if (args.status === "failed") {
      const { error: markError } = await supabase.from("flow_sessions").update({ has_failed_step: true }).eq("id", args.sessionId);
      if (markError) console.error(`[flow-engine] no pude marcar el paso fallido (code=${markError.code ?? "?"})`);
    }
  } catch (err) {
    console.error("[flow-engine] no pude anotar el paso:", err instanceof Error ? err.name : "error");
  }
}

/**
 * Anota por que salida siguio un «Esperar respuesta» al retomarse: respondio o vencio el tiempo. El paso ya quedo anotado
 * como `waiting` al pausar; aca se le completa la salida (la ultima fila de ese paso en la sesion). Nunca lanza.
 */
export async function noteWaitExit(supabase: Db, sessionId: string, nodeId: string, exit: "reply" | "timeout"): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("flow_session_steps")
      .select("id")
      .eq("session_id", sessionId)
      .eq("node_id", nodeId)
      .eq("status", "waiting")
      .order("seq", { ascending: false })
      .limit(1);
    if (error || !data?.[0]) return;
    const { error: writeError } = await supabase
      .from("flow_session_steps")
      .update({ exit_handle: exit, exit_label: exit === "reply" ? "Respondió" : "No respondió a tiempo" } as never)
      .eq("id", data[0].id);
    if (writeError && !isMissingColumn(writeError)) {
      console.error(`[flow-engine] no pude anotar la salida de la espera (code=${writeError.code ?? "?"})`);
    }
  } catch (err) {
    console.error("[flow-engine] no pude anotar la salida de la espera:", err instanceof Error ? err.name : "error");
  }
}

/**
 * Anota por que termino una ejecucion. Gana el primero (`end_reason` todavia null): cuando un paso revienta, el motor lo
 * anota y despues el cron cancela la misma sesion, y lo que importa es la causa original. Nunca lanza.
 */
export async function noteSessionEnd(supabase: Db, sessionId: string, reason: SessionEndReason, error?: unknown): Promise<void> {
  try {
    const { error: writeError } = await supabase
      .from("flow_sessions")
      .update({ end_reason: reason, error_message: sanitizeRunText(error) })
      .eq("id", sessionId)
      .is("end_reason", null);
    if (writeError) console.error(`[flow-engine] no pude anotar el fin de la sesion (code=${writeError.code ?? "?"})`);
  } catch (err) {
    console.error("[flow-engine] no pude anotar el fin de la sesion:", err instanceof Error ? err.name : "error");
  }
}

/** Anota con que version del flujo arranco la ejecucion. Nunca lanza. */
export async function noteSessionVersion(supabase: Db, sessionId: string, version: unknown): Promise<void> {
  if (typeof version !== "number") return;
  try {
    const { error } = await supabase.from("flow_sessions").update({ flow_version: version }).eq("id", sessionId);
    if (error) console.error(`[flow-engine] no pude anotar la version de la sesion (code=${error.code ?? "?"})`);
  } catch (err) {
    console.error("[flow-engine] no pude anotar la version de la sesion:", err instanceof Error ? err.name : "error");
  }
}
