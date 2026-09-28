import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { BackgroundTask } from "./settings";
import type { PlannedDispatch } from "./plan";

type Db = SupabaseClient<Database>;

export const BG_TASK_JOB = "bg_task";

/** Lo que lleva un job de tarea en segundo plano. */
export interface BgTaskPayload {
  workspaceId: string;
  task: BackgroundTask;
  window: string;
  /** Número de continuación: 0 (ausente) es la corrida de la ventana. */
  part?: number;
}

/**
 * Clave de una continuación: el mismo trabajo, otra tanda de lotes.
 *
 * Tiene que ser distinta de la de la ventana, porque el índice único de
 * `bg_task` (00101) es sobre toda la vida del job y la ventana ya está tomada.
 */
export function continuationDedupeKey(baseKey: string, part: number): string {
  return `${baseKey}:cont:${part}`;
}

export interface EnqueueResult {
  /** Encolados de verdad. */
  created: number;
  /** La ventana ya se había despachado: no es un error. */
  skipped: number;
  /** El insert falló por otra cosa. */
  failed: number;
}

/**
 * Encola un `bg_task`. Devuelve `false` si la clave ya estaba tomada.
 *
 * Quién garantiza la unicidad es el índice `uq_scheduled_jobs_bg_task_dedupe`
 * (00101), no una consulta previa: dos corridas del cron pueden solaparse, y
 * un chequeo del lado de la app no es atómico. Acá el 23505 se lee como "ya
 * estaba", que es lo que significa.
 */
export async function enqueueBgTask(
  client: Db,
  args: { dedupeKey: string; payload: BgTaskPayload; runAt?: Date },
): Promise<"created" | "skipped" | "failed"> {
  const { error } = await client.from("scheduled_jobs").insert({
    type: BG_TASK_JOB,
    dedupe_key: args.dedupeKey,
    payload: args.payload as unknown as Database["public"]["Tables"]["scheduled_jobs"]["Insert"]["payload"],
    run_at: (args.runAt ?? new Date()).toISOString(),
    status: "pending",
  });
  if (!error) return "created";
  if (error.code === "23505") return "skipped";
  console.error("[bg-dispatch] no pude encolar la tarea:", error.message);
  return "failed";
}

/** Encola lo que planificó `planDispatch` para un workspace. */
export async function enqueuePlanned(
  client: Db,
  workspaceId: string,
  planned: PlannedDispatch[],
  now: Date = new Date(),
): Promise<EnqueueResult> {
  const out: EnqueueResult = { created: 0, skipped: 0, failed: 0 };
  for (const p of planned) {
    const outcome = await enqueueBgTask(client, {
      dedupeKey: p.dedupeKey,
      payload: { workspaceId, task: p.task, window: p.window },
      runAt: now,
    });
    out[outcome] += 1;
  }
  return out;
}
