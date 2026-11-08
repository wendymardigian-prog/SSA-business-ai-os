/**
 * `flow_scheduled_run`: corre una vez de una automatización «En una fecha y hora» y agenda la siguiente.
 *
 *   1. Descarta lo viejo: la automatización ya no está publicada, se volvió a publicar (otra versión) o esa vez ya no es
 *      de la config. Ahí no corre ni agenda nada: lo nuevo ya tiene su trabajo (o no tiene que tener ninguno).
 *   2. Reclama el disparo en `trigger_fires` (`schedule:<vez>`): una misma vez corre UNA sola vez aunque el trabajo se
 *      repita.
 *   3. Agenda la siguiente ANTES de correr el flujo: si el flujo se cuelga o revienta, la repetición no se corta.
 *   4. Corre el flujo SIN contacto ni persona (`source: system`), con `{{schedule.*}}` en las variables. Si llegó más de
 *      dos horas tarde (la app estuvo caída), esa vez se saltea.
 *
 * No lanza por lo que hace el flujo (sus pasos anotan sus propios errores). Lanza solo si no pudo agendar la siguiente:
 * la cola reintenta, el reclamo ya tomado impide repetir el flujo, y el reintento vuelve a agendar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { executeFlow } from "@/lib/flow-engine/engine";
import "@/lib/flow-engine/registry";
import type { FlowExecutionContext } from "@/lib/flow-engine/types";
import {
  isOccurrenceOf,
  isTooLate,
  parseScheduledRunPayload,
  scheduledFireKey,
  scheduleVariables,
  SCHEDULED_RUN_JOB,
  SCHEDULED_TRIGGER_TYPE,
} from "@/lib/scheduled-flows/schedule";
import { businessTimeZone, scheduleNextRun } from "@/lib/scheduled-flows/jobs";

type Db = SupabaseClient<Database>;

export type ScheduledRunOutcome =
  | "invalid_payload"
  | "flow_gone"
  | "not_published"
  | "stale_version"
  | "no_trigger"
  | "stale_schedule"
  | "already_ran"
  | "too_late"
  | "ran"
  | "failed";

export async function handleFlowScheduledRun(
  { supabase, job }: JobContext,
  deps: { execute?: typeof executeFlow; now?: () => Date } = {},
): Promise<ScheduledRunOutcome> {
  const db = supabase as Db;
  const execute = deps.execute ?? executeFlow;
  const now = deps.now ?? (() => new Date());

  const payload = parseScheduledRunPayload(job.payload);
  if (!payload) {
    console.error(`[programadas] el trabajo ${job.id} no trae lo mínimo; no hago nada`);
    return "invalid_payload";
  }
  const occurrence = new Date(payload.occurrence);

  const { data: flowRow, error: flowError } = await db
    .from("flows")
    .select("id, workspace_id, status, version")
    .eq("id", payload.flowId)
    .eq("workspace_id", payload.workspaceId)
    .maybeSingle();
  if (flowError) throw new Error(`no pude leer la automatización: ${flowError.message}`);
  const flow = flowRow as { id: string; workspace_id: string; status: string; version: number } | null;
  if (!flow) return "flow_gone";
  if (flow.status !== "published") return "not_published";
  if (flow.version !== payload.version) return "stale_version";

  const { data: triggerRow, error: triggerError } = await db
    .from("triggers")
    .select("id, config")
    .eq("flow_id", flow.id)
    .eq("type", SCHEDULED_TRIGGER_TYPE as never)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (triggerError) throw new Error(`no pude leer el disparador: ${triggerError.message}`);
  const trigger = triggerRow as { id: string; config: unknown } | null;
  if (!trigger) {
    console.error(`[programadas] la automatización ${flow.id} está publicada sin su disparador programado; no corre`);
    return "no_trigger";
  }

  const timeZone = await businessTimeZone(db, flow.workspace_id);
  if (!isOccurrenceOf(trigger.config, occurrence, timeZone)) return "stale_schedule";

  // El reclamo: el índice único de trigger_fires decide. 23505 = esa vez ya corrió (un reintento del trabajo).
  const { error: claimError } = await db.from("trigger_fires").insert({
    trigger_id: trigger.id,
    workspace_id: flow.workspace_id,
    dedupe_key: scheduledFireKey(occurrence),
    contact_id: null,
  } as never);
  const alreadyRan = claimError?.code === "23505";
  if (claimError && !alreadyRan) throw new Error(`no pude reclamar el disparo: ${claimError.message}`);

  // La siguiente, antes de correr: desde ahora (si la app estuvo caída no se recuperan las veces perdidas).
  let scheduleError: string | null = null;
  try {
    const after = new Date(Math.max(occurrence.getTime(), now().getTime()));
    await scheduleNextRun(db, { workspaceId: flow.workspace_id, flowId: flow.id, version: flow.version, config: trigger.config, timeZone, after });
  } catch (err) {
    scheduleError = err instanceof Error ? err.message : String(err);
  }

  let outcome: ScheduledRunOutcome;
  if (alreadyRan) {
    outcome = "already_ran";
  } else if (isTooLate(occurrence, now())) {
    console.warn(`[programadas] la vez ${occurrence.toISOString()} de la automatización ${flow.id} llegó más de dos horas tarde; se saltea`);
    outcome = "too_late";
  } else {
    outcome = await runFlow(db, execute, { flowId: flow.id, workspaceId: flow.workspace_id, triggerId: trigger.id, occurrence, timeZone });
  }

  if (scheduleError) throw new Error(`corrí la vez pero no pude agendar la siguiente: ${scheduleError}`);
  return outcome;
}

async function runFlow(
  db: Db,
  execute: typeof executeFlow,
  args: { flowId: string; workspaceId: string; triggerId: string; occurrence: Date; timeZone: string },
): Promise<ScheduledRunOutcome> {
  const sourceId = scheduledFireKey(args.occurrence);
  const context: FlowExecutionContext = {
    triggerId: args.triggerId,
    flowId: args.flowId,
    channelId: "",
    contactId: null,
    source: { type: "system", id: sourceId },
    conversationId: "",
    workspaceId: args.workspaceId,
    incomingMessage: {},
    variables: scheduleVariables(args.occurrence, args.timeZone),
  };
  try {
    await execute(db, context);
    return "ran";
  } catch (err) {
    console.error(`[programadas] la automatización ${args.flowId} falló:`, err instanceof Error ? err.message : String(err));
    // Un paso reventó (un fallo de base): la sesión no puede quedar «activa» para siempre.
    try {
      await db
        .from("flow_sessions")
        .update({ status: "cancelled" })
        .eq("flow_id", args.flowId)
        .eq("source_type" as never, "system")
        .eq("source_id" as never, sourceId)
        .eq("status", "active");
    } catch (cancelErr) {
      console.error("[programadas] no pude cerrar la sesión fallada:", cancelErr instanceof Error ? cancelErr.message : String(cancelErr));
    }
    return "failed";
  }
}

export function registerFlowScheduledRunHandler(): void {
  registerJobHandler(SCHEDULED_RUN_JOB, async (ctx) => {
    await handleFlowScheduledRun(ctx);
  });
}
