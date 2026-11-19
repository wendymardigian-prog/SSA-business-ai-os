/**
 * El aviso ANTES del tope de gasto de IA.
 *
 * Los topes del workspace cortan (o avisan) cuando se ALCANZAN. Este aviso es
 * anterior: al pasar el porcentaje que elige el usuario
 * (`workspaces.ai_spend_alert_pct`) de cualquiera de los dos topes, una
 * notificacion dice que se esta por llegar, para poder subir el tope o
 * frenar algo antes de que corte.
 *
 * Una por tope y por periodo: el diario se rearma a la medianoche local y el
 * mensual el dia 1, asi que la clave es el INICIO del periodo, no una ventana
 * de horas (una ventana de 12 h suprimiria el aviso de hoy si el de ayer
 * salto a las 23:50).
 *
 * Se evalua donde ya se suma el gasto (`checkSpendLimits`), sin otra consulta.
 * Nunca lanza: un aviso que falla no puede frenar una llamada al modelo.
 *
 * La decision de "esta por llegar" es pura (`approachingThresholds`) y es lo
 * que se testea; `notifySpendApproaching` solo escribe.
 *
 * Cuando exista un centro de notificaciones por usuario, este tipo
 * (`ai_spend_threshold`) tiene que aparecer ahi enlazado a la tarjeta de topes
 * de Agentes: el dato (el porcentaje) tiene una sola fuente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/**
 * Los topes con aviso previo: los del negocio, los del agente y, desde el
 * bloque 24, el mensual de cada tarea.
 */
export type ApproachScope = "workspace_daily" | "workspace_monthly" | "agent_daily" | "agent_monthly" | "task_monthly";

/**
 * P-79 (respuesta prevista): sin porcentaje guardado, los topes del agente y
 * de las tareas avisan al 80 %. Los del negocio siguen como estaban (sin valor
 * guardado, sin aviso): es lo que eligió quien los configuró.
 */
export const DEFAULT_CAP_ALERT_PCT = 80;

export interface SpendApproach {
  scope: ApproachScope;
  limitUsd: number;
  spentUsd: number;
  pct: number;
  /** Cuando empezo el periodo del tope (medianoche local o dia 1): la clave de "una vez por periodo". */
  periodStart: Date;
  /** El agente del tope (solo agent_*). */
  agentId?: string | null;
  /** La tarea del tope (solo task_monthly). */
  task?: string | null;
  /** El nombre de la tarea o del agente, para el aviso. */
  label?: string | null;
}

const SCOPE_LABEL: Record<ApproachScope, string> = {
  workspace_daily: "diario del negocio",
  workspace_monthly: "mensual del negocio",
  agent_daily: "diario del agente",
  agent_monthly: "mensual del agente",
  task_monthly: "mensual de la tarea",
};

function isApproachScope(scope: string): scope is ApproachScope {
  return scope in SCOPE_LABEL;
}

/** El porcentaje con el que avisa un tope: el guardado, o el 80 % en agentes y tareas. */
export function alertPctFor(scope: ApproachScope, saved: number | null | undefined): number | null {
  const pct = validAlertPct(saved);
  if (pct !== null) return pct;
  return scope.startsWith("workspace_") ? null : DEFAULT_CAP_ALERT_PCT;
}

/** La clave de "una vez por tope y periodo" en `notifications.metadata`. */
export function approachKey(item: Pick<SpendApproach, "scope" | "periodStart" | "agentId" | "task">): Record<string, string> {
  const key: Record<string, string> = { scope: item.scope, period_start: item.periodStart.toISOString() };
  if (item.agentId) key.agent_id = item.agentId;
  if (item.task) key.task = item.task;
  return key;
}

/** El titulo del aviso, con el nombre de la tarea o del agente cuando lo hay. */
export function approachTitle(item: Pick<SpendApproach, "scope" | "pct" | "label">): string {
  const who = item.label ? ` «${item.label}»` : "";
  return `El gasto de IA va por el ${item.pct} % del tope ${SCOPE_LABEL[item.scope]}${who}`;
}

/** Un porcentaje valido es un entero de 1 a 99: con 100 ya es el tope, y sin valor no hay aviso. */
export function validAlertPct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 99 ? value : null;
}

/**
 * Los topes del workspace que ya pasaron el porcentaje de aviso pero todavia
 * no llegaron al tope (llegar es otra cosa: ahi corta o avisa, segun elija).
 */
export function approachingThresholds(
  entries: Array<{ scope: string; limitUsd: number | null; spentUsd: number; since: Date; agentId?: string | null; task?: string | null; label?: string | null }>,
  alertPct: number | null | undefined,
): SpendApproach[] {
  const out: SpendApproach[] = [];
  for (const e of entries) {
    if (!isApproachScope(e.scope)) continue;
    const pct = alertPctFor(e.scope, alertPct);
    if (pct === null) continue;
    if (e.limitUsd === null || e.limitUsd <= 0) continue;
    const threshold = (e.limitUsd * pct) / 100;
    if (e.spentUsd >= threshold && e.spentUsd < e.limitUsd) {
      out.push({
        scope: e.scope,
        limitUsd: e.limitUsd,
        spentUsd: e.spentUsd,
        pct,
        periodStart: e.since,
        agentId: e.scope.startsWith("agent_") ? (e.agentId ?? null) : null,
        task: e.scope === "task_monthly" ? (e.task ?? null) : null,
        label: e.label ?? null,
      });
    }
  }
  return out;
}

/** Crea el aviso de cada tope que se esta por alcanzar, una vez por periodo. Nunca lanza. */
export async function notifySpendApproaching(
  supabase: Db,
  args: { workspaceId: string; approaching: SpendApproach[] },
): Promise<void> {
  for (const item of args.approaching) {
    try {
      const key = approachKey(item);
      const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("workspace_id", args.workspaceId)
        .eq("type", "ai_spend_threshold")
        .contains("metadata", key)
        .limit(1);

      // Si no se puede revisar, se avisa igual: un aviso repetido molesta
      // menos que uno que falta.
      if (!error && data && data.length > 0) continue;

      await createNotification({
        supabase,
        workspaceId: args.workspaceId,
        type: "ai_spend_threshold",
        title: approachTitle(item),
        body: `Gastado: USD ${item.spentUsd.toFixed(2)} de USD ${item.limitUsd.toFixed(2)} (estimado según los precios cargados). Podés ajustar los topes en Agentes.`,
        metadata: { ...key, pct: item.pct },
      });
    } catch (err) {
      console.error("[ai-spend] no pude registrar el aviso previo:", err instanceof Error ? err.message : String(err));
    }
  }
}
