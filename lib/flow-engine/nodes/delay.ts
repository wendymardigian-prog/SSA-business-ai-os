import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import type { DelayNodeData, SmartDelayNodeData } from "../types";
import type { Json } from "@/lib/types/database";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";
import { isValidTimeZone } from "@/lib/timezone";
import { parseLocalDateTime, SKIP_NEXT_STEP } from "../wait-until";

const MULTIPLIERS: Record<string, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/** El job que despierta un "Esperar respuesta" cuando vence su tiempo (o la espera maxima). */
export const FLOW_WAIT_TIMEOUT_JOB = "flow_wait_timeout";

/**
 * Cuanto puede quedar un "Esperar respuesta" SIN tiempo maximo configurado. Antes era para siempre: un lead que
 * escribia semanas despues tenia su mensaje tragado por una sesion vieja, en vez de llegarle a un disparador o al
 * agente. Pasado este plazo la sesion se cierra sin seguir.
 */
export const MAX_WAIT_FOR_REPLY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Que hace un "Esperar":
 *   - `wait`: dormir hasta `at`. La fecha de "Esperar hasta" gana sobre la duracion; `waitUntilLocal` es hora de pared en
 *     la zona `tz` (la del negocio) y gana sobre `waitUntil`, el ISO de los nodos viejos, que sigue valiendo.
 *   - `date_passed`: la fecha ya paso cuando el contacto llego. El motor saltea el paso siguiente: lo que iba a salir "el
 *     sabado a las 10" no sale el domingo.
 *   - `none`: sin duracion, o una fecha que no es una fecha: el flujo sigue de largo, sin saltear nada. Antes una duracion
 *     vacia daba `NaN` y `toISOString` lanzaba.
 */
export type DelayPlan = { kind: "wait"; at: Date } | { kind: "date_passed" } | { kind: "none" };

export function delayPlan(data: Partial<DelayNodeData>, now: number = Date.now(), tz: string = "UTC"): DelayPlan {
  const local = typeof data.waitUntilLocal === "string" ? data.waitUntilLocal.trim() : "";
  if (local) {
    const parsed = parseLocalDateTime(local);
    if (!parsed) return { kind: "none" };
    return untilPlan(wallClockToUtc(parsed.date, parsed.time, tz), now);
  }
  if (typeof data.waitUntil === "string" && data.waitUntil.trim()) {
    const until = new Date(data.waitUntil);
    if (Number.isNaN(until.getTime())) return { kind: "none" };
    return untilPlan(until, now);
  }
  const duration = Number(data.duration);
  if (!Number.isFinite(duration) || duration <= 0) return { kind: "none" };
  return { kind: "wait", at: new Date(now + duration * (MULTIPLIERS[data.unit ?? "minutes"] ?? MULTIPLIERS.minutes)) };
}

function untilPlan(until: Date, now: number): DelayPlan {
  return until.getTime() > now ? { kind: "wait", at: until } : { kind: "date_passed" };
}

/** Cuando sigue un "Esperar", o null si no hay nada que esperar (sin duracion, o una fecha que ya paso). */
export function delayRunAt(data: Partial<DelayNodeData>, now: number = Date.now(), tz: string = "UTC"): Date | null {
  const plan = delayPlan(data, now, tz);
  return plan.kind === "wait" ? plan.at : null;
}

/** El tiempo maximo de un "Esperar respuesta", en ms; null si no tiene. */
export function waitTimeoutMs(data: Partial<SmartDelayNodeData> | null | undefined): number | null {
  const amount = Number(data?.timeout);
  // Los nodos de antes no tenian el interruptor: si guardaron un tiempo, la persona lo eligio (el panel prometia
  // "si no responde en ese tiempo, sigue"). Solo un `false` explicito lo apaga.
  const enabled = data?.timeoutEnabled ?? (data?.timeout !== undefined && data?.timeout !== null);
  if (!enabled || !Number.isFinite(amount) || amount <= 0) return null;
  return amount * (MULTIPLIERS[data?.timeoutUnit ?? "minutes"] ?? MULTIPLIERS.minutes);
}

/** La zona del negocio. Sin poder leerla se lanza (el motor lo anota): adivinar mandaria un recordatorio a otra hora. */
async function businessTimeZone(supabase: NodeExecutionArgs<DelayNodeData, FlowExecutionContext>["supabase"], workspaceId: string): Promise<string> {
  const { data, error } = await supabase.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();
  if (error) throw new Error(`no pude leer la zona horaria del negocio: ${error.message}`);
  const tz = data?.timezone;
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

/**
 * Espera un tiempo fijo (o hasta una fecha) y sigue.
 *
 * El flow no se queda esperando en memoria: se agenda un job y la sesion queda
 * dormida. Quien la despierta es /api/cron/jobs, que corre por pg_cron. Sin ese cron andando, un Delay para el flow para siempre.
 */
export const delayNode: NodeDefinition<DelayNodeData> = {
  needsContact: false,
  type: "delay",
  label: "Esperar",
  async execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<DelayNodeData, FlowExecutionContext>) {
    // La zona se pregunta solo si hace falta: un "Esperar" por duracion no hace ninguna consulta de mas.
    const tz = data.waitUntilLocal ? await businessTimeZone(supabase, context.workspaceId) : "UTC";
    const plan = delayPlan(data, Date.now(), tz);
    if (plan.kind === "date_passed") return SKIP_NEXT_STEP;
    if (plan.kind === "none") {
      console.warn(`[flow-engine] el "Esperar" ${node.id} no tiene duracion ni una fecha valida: el flujo sigue sin esperar`);
      return;
    }
    const runAt = plan.at.toISOString();

    const { error } = await supabase.from("scheduled_jobs").insert({
      type: "resume_flow",
      payload: {
        sessionId,
        nodeId: node.id,
        flowId: context.flowId,
        channelId: context.channelId,
        contactId: context.contactId,
        // Un flujo sin contacto (E15) retoma con la misma persona del equipo.
        ...(context.contactId ? {} : { memberUserId: context.memberUserId ?? null }),
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        lateConversationId: context.lateConversationId || null,
        lateAccountId: context.lateAccountId || null,
        variables: context.variables ?? {},
      } as unknown as Json,
      run_at: runAt,
    });
    // Sin el job nadie despierta la sesion: que falle a la vista (el motor cancela la sesion y lo anota).
    if (error) throw new Error(`no pude agendar el "Esperar" ${node.id}: ${error.message}`);

    await supabase
      .from("flow_sessions")
      .update({ waiting_until: runAt, current_node_id: node.id })
      .eq("id", sessionId);

    return "pause";
  },
};

/**
 * Espera a que el contacto conteste algo.
 *
 * La sesion queda marcada esperando input y la despierta el proximo mensaje entrante, via resumeSession. Con tiempo
 * maximo, un job la despierta al vencer y el flujo sigue por "Si no responde a tiempo" (o por la salida de siempre,
 * si esa no esta conectada: es lo que el panel prometia). Sin tiempo maximo, la espera vence a los 7 dias y la sesion
 * se cierra.
 */
export const smartDelayNode: NodeDefinition<SmartDelayNodeData> = {
  needsContact: true,
  type: "smartDelay",
  label: "Esperar respuesta",
  aliases: [{ nodeType: "action", actionType: "smartDelay" }],
  async execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<SmartDelayNodeData>) {
    const timeout = waitTimeoutMs(data);
    const runAt = new Date(Date.now() + (timeout ?? MAX_WAIT_FOR_REPLY_MS)).toISOString();

    const { error } = await supabase.from("scheduled_jobs").insert({
      type: FLOW_WAIT_TIMEOUT_JOB,
      payload: {
        sessionId,
        nodeId: node.id,
        exit: timeout ? "timeout" : "expire",
        flowId: context.flowId,
        channelId: context.channelId,
        contactId: context.contactId,
        conversationId: context.conversationId,
        workspaceId: context.workspaceId,
        lateConversationId: context.lateConversationId || null,
        lateAccountId: context.lateAccountId || null,
      } as unknown as Json,
      run_at: runAt,
    });
    if (error) throw new Error(`no pude agendar el vencimiento del "Esperar respuesta" ${node.id}: ${error.message}`);

    await supabase
      .from("flow_sessions")
      .update({ waiting_for_input: true, current_node_id: node.id, variables: (context.variables ?? {}) as Json })
      .eq("id", sessionId);

    return "pause";
  },
};
