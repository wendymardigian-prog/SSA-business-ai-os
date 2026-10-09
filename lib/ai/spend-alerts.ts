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

/** Los topes del workspace. Los del agente no llevan aviso previo: tienen su propia pantalla. */
type WorkspaceScope = "workspace_daily" | "workspace_monthly";

export interface SpendApproach {
  scope: WorkspaceScope;
  limitUsd: number;
  spentUsd: number;
  pct: number;
  /** Cuando empezo el periodo del tope (medianoche local o dia 1): la clave de "una vez por periodo". */
  periodStart: Date;
}

const SCOPE_LABEL: Record<WorkspaceScope, string> = {
  workspace_daily: "diario",
  workspace_monthly: "mensual",
};

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
  entries: Array<{ scope: string; limitUsd: number | null; spentUsd: number; since: Date }>,
  alertPct: number | null | undefined,
): SpendApproach[] {
  const pct = validAlertPct(alertPct);
  if (pct === null) return [];

  const out: SpendApproach[] = [];
  for (const e of entries) {
    if (e.scope !== "workspace_daily" && e.scope !== "workspace_monthly") continue;
    if (e.limitUsd === null || e.limitUsd <= 0) continue;
    const threshold = (e.limitUsd * pct) / 100;
    if (e.spentUsd >= threshold && e.spentUsd < e.limitUsd) {
      out.push({ scope: e.scope, limitUsd: e.limitUsd, spentUsd: e.spentUsd, pct, periodStart: e.since });
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
      const periodStart = item.periodStart.toISOString();
      const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("workspace_id", args.workspaceId)
        .eq("type", "ai_spend_threshold")
        .contains("metadata", { scope: item.scope, period_start: periodStart })
        .limit(1);

      // Si no se puede revisar, se avisa igual: un aviso repetido molesta
      // menos que uno que falta.
      if (!error && data && data.length > 0) continue;

      await createNotification({
        supabase,
        workspaceId: args.workspaceId,
        type: "ai_spend_threshold",
        title: `El gasto de IA va por el ${item.pct} % del tope ${SCOPE_LABEL[item.scope]}`,
        body: `Gastado: USD ${item.spentUsd.toFixed(2)} de USD ${item.limitUsd.toFixed(2)} (estimado según los precios cargados). Podés ajustar los topes en Agentes.`,
        metadata: { scope: item.scope, period_start: periodStart, pct: item.pct },
      });
    } catch (err) {
      console.error("[ai-spend] no pude registrar el aviso previo:", err instanceof Error ? err.message : String(err));
    }
  }
}
