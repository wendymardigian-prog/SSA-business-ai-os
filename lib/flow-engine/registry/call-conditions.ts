/**
 * Las condiciones de Llamadas (F32). Tres campos que un nodo Condition puede
 * comparar, todos sobre la ULTIMA LLAMADA ANALIZADA del contacto:
 *
 *   last_call_outcome:    el resultado ("venta", "seguimiento_con_fecha"…)
 *   last_call_lead_score: el puntaje del lead, como numero
 *   last_call_type:       el tipo ("cierre", "seguimiento"…)
 *
 * Sin llamada analizada devuelven vacio: "resultado de la ultima llamada es
 * venta" no puede decir que si por no haber ninguna.
 */
import { registerConditionField } from "./registry";
import type { ConditionFieldArgs } from "./types";

interface LastCall {
  outcome: string | null;
  lead_score: number | null;
  call_type: string | null;
}

async function lastAnalyzedCall(args: ConditionFieldArgs): Promise<LastCall | null> {
  const { data } = await args.supabase
    .from("calls")
    .select("outcome, lead_score, call_type")
    .eq("workspace_id", args.context.workspaceId)
    .eq("contact_id", args.context.contactId)
    .eq("analysis_status", "analyzed")
    .is("archived_at", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LastCall | null) ?? null;
}

registerConditionField({
  prefix: "last_call_outcome:",
  label: "Resultado de la última llamada",
  resolve: async (args) => (await lastAnalyzedCall(args))?.outcome ?? "",
});

registerConditionField({
  prefix: "last_call_lead_score:",
  label: "Puntaje del lead en la última llamada",
  resolve: async (args) => {
    const call = await lastAnalyzedCall(args);
    return call?.lead_score === null || call?.lead_score === undefined ? "" : String(call.lead_score);
  },
});

registerConditionField({
  prefix: "last_call_type:",
  label: "Tipo de la última llamada",
  resolve: async (args) => (await lastAnalyzedCall(args))?.call_type ?? "",
});
