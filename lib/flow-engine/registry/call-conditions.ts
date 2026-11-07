/**
 * Las condiciones de Llamadas (F32). Tres campos que un nodo Condition puede
 * comparar, todos sobre la ULTIMA LLAMADA ANALIZADA del contacto:
 *
 *   last_call_outcome:    el resultado ("venta", "seguimiento_con_fecha"…)
 *   last_call_lead_score: el puntaje del lead, como numero
 *   last_call_type:       la clave vieja del tipo ("cierre", "seguimiento"…), para los flujos que ya la usan
 *
 * Sin llamada analizada devuelven vacio: "resultado de la ultima llamada es
 * venta" no puede decir que si por no haber ninguna.
 */
import { derivedCallType } from "@/lib/calls/legacy-type";
import { registerConditionField } from "./registry";
import { readCategorySnapshot } from "@/lib/calls/catalog";
import type { ConditionFieldArgs } from "./types";
import { requireContactId } from "../types";

interface LastCall {
  category_snapshot?: unknown;
  outcome: string | null;
  lead_score: number | null;
  no_show?: boolean | null;
}

async function lastAnalyzedCall(args: ConditionFieldArgs): Promise<LastCall | null> {
  const { data } = await args.supabase
    .from("calls")
    .select("outcome, lead_score, no_show, category_snapshot")
    .eq("workspace_id", args.context.workspaceId)
    .eq("contact_id", requireContactId(args.context))
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
  prefix: "last_call_area:",
  label: "Área de la última llamada",
  resolve: async (args) => readCategorySnapshot((await lastAnalyzedCall(args))?.category_snapshot)?.area_name ?? "",
});

registerConditionField({
  prefix: "last_call_meeting_type:",
  label: "Tipo de reunión de la última llamada",
  resolve: async (args) => readCategorySnapshot((await lastAnalyzedCall(args))?.category_snapshot)?.type_name ?? "",
});

registerConditionField({
  prefix: "last_call_type:",
  label: "Tipo de la última llamada",
  resolve: async (args) => {
    const call = await lastAnalyzedCall(args);
    if (!call) return "";
    // Un campo que no se puede leer es "no se cumple", nunca un error que frene el flujo.
    return (await derivedCallType(args.supabase, args.context.workspaceId, call).catch(() => null)) ?? "";
  },
});
