import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { BG_TASK_JOB, type BgTaskPayload } from "@/lib/background/enqueue";
import { dispatchDedupeKey } from "@/lib/background/dispatch";
import { BACKGROUND_TASKS, type BackgroundTask } from "@/lib/background/settings";
import { runMessageClassification } from "@/lib/patterns/classify-run";

/**
 * El handler de las tareas de IA en segundo plano (F24).
 *
 * Despacha por `payload.task` con un mapa explícito. Una tarea sin
 * implementación **lanza** y el job queda fallido, con el motivo en
 * `last_error`. No completa en silencio: el silencio es lo que dejó este
 * handler vacío durante semanas mientras el cron encolaba 229 jobs que no
 * hacían nada, y nadie se enteró.
 */

interface BgTaskRun {
  (context: JobContext, payload: BgTaskPayload): Promise<void>;
}

const HANDLERS: Record<BackgroundTask, BgTaskRun | null> = {
  message_classification: async (context, payload) => {
    const result = await runMessageClassification(context.supabase, {
      workspaceId: payload.workspaceId,
      window: payload.window,
      dedupeKey: dispatchDedupeKey(payload.workspaceId, payload.task, payload.window),
      part: payload.part,
      backgroundSettings: await backgroundSettingsOf(context, payload.workspaceId),
    });
    // Sin texto de mensajes: solo números y el estado de la corrida.
    console.log(
      `[bg_task] clasificación ${payload.window}${payload.part ? `#${payload.part}` : ""}:`,
      JSON.stringify({
        ok: result.ok,
        reason: result.reason,
        lotes: result.batches,
        clasificados: result.classified,
        porRegla: result.byRule,
        categoriasNuevas: result.newCategories,
        invalidos: result.invalid,
        diferidos: result.deferred,
        continua: result.continued,
        costoUsd: result.costUsd,
      }),
    );
  },
  // Sin implementar. Declaradas para que agregar una tarea sea llenar un hueco
  // que el tipo ya exige, y no descubrir en producción que nadie la ejecuta.
  conversation_summary: null,
  close_classification: null,
  knowledge_indexing: null,
};

async function backgroundSettingsOf(context: JobContext, workspaceId: string): Promise<unknown> {
  const { data } = await context.supabase
    .from("workspaces")
    .select("ai_background_settings")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.ai_background_settings ?? {};
}

export async function handleBgTask(context: JobContext): Promise<void> {
  const payload = context.job.payload as Partial<BgTaskPayload> | null;
  const task = payload?.task;
  const workspaceId = payload?.workspaceId;

  if (!workspaceId || !task || !payload?.window) {
    throw new Error(`[bg_task] payload incompleto (workspaceId, task y window son obligatorios)`);
  }
  if (!(BACKGROUND_TASKS as readonly string[]).includes(task)) {
    throw new Error(`[bg_task] tarea desconocida: "${task}"`);
  }

  // El workspace pudo borrarse entre que el job se encoló y llegó su turno: 20
  // de los 229 jobs viejos eran de usuarios de prueba que ya no existen.
  const { data: workspace, error } = await context.supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`[bg_task] no pude verificar el workspace: ${error.message}`);
  if (!workspace) {
    console.warn(`[bg_task] el workspace ya no existe; no hay nada que hacer.`);
    return;
  }

  const run = HANDLERS[task as BackgroundTask];
  if (!run) {
    throw new Error(
      `[bg_task] la tarea "${task}" está configurada en modo Económico pero todavía no tiene implementación por lote. Ponela en Inmediato en Ajustes → Tareas en segundo plano.`,
    );
  }

  await run(context, payload as BgTaskPayload);
}

export function registerBgTaskHandler(): void {
  registerJobHandler(BG_TASK_JOB, handleBgTask);
}
