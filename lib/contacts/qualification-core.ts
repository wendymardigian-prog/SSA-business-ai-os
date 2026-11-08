/**
 * El núcleo que cambia el nivel de calificación: llama a
 * `set_contact_qualification` (00329) y traduce su respuesta. Lo usan la ficha y
 * la bandeja (`lib/actions/contact-qualification.ts`), el paso «Calificar lead»
 * de las automatizaciones, el agente de IA y la importación.
 *
 * Recibe SIEMPRE el cliente de servicio: la función solo la ejecuta
 * `service_role`. Quien llama ya chequeó el permiso y que el contacto es del
 * workspace de la sesión (o del flujo, o del agente).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseQualificationLevel, type QualificationLevel, type QualificationMode, type QualificationSource } from "./qualification";

type Db = SupabaseClient<Database>;

export interface ApplyQualificationInput {
  workspaceId: string;
  contactId: string;
  mode: QualificationMode;
  /** `set`: el nivel (1-5). `add`: cuánto sumar (negativo resta). `clear`: no se usa. */
  value?: number | null;
  source: Exclude<QualificationSource, "merge" | "seed">;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  flowId?: string | null;
  reason?: string | null;
  /** El agente: no pisa un nivel que puso una persona o una automatización. */
  respectHuman?: boolean;
  /** El agente sin «puede bajar»: un nivel más bajo (o quitarlo) no se aplica. */
  onlyRaise?: boolean;
}

export type ApplyQualificationResult =
  | { kind: "changed" | "unchanged"; oldLevel: QualificationLevel | null; newLevel: QualificationLevel | null; changeId: string | null }
  | { kind: "not_found" | "invalid" | "protected" | "not_raised" | "error"; oldLevel: QualificationLevel | null; message: string };

export async function applyContactQualification(service: Db, input: ApplyQualificationInput): Promise<ApplyQualificationResult> {
  const { data, error } = await service.rpc("set_contact_qualification", {
    p_workspace_id: input.workspaceId,
    p_contact_id: input.contactId,
    p_mode: input.mode,
    p_value: input.mode === "clear" ? null : (input.value ?? null),
    p_actor_user: input.actorUserId ?? null,
    p_actor_agent: input.actorAgentId ?? null,
    p_source: input.source,
    p_flow_id: input.flowId ?? null,
    p_reason: input.reason ?? null,
    p_respect_human: input.respectHuman ?? false,
    p_only_raise: input.onlyRaise ?? false,
  });
  if (error) {
    console.error("[qualification] set_contact_qualification falló:", error.message);
    return { kind: "error", oldLevel: null, message: "No pude guardar la calificación" };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const result = typeof r.result === "string" ? r.result : null;
  const oldLevel = parseQualificationLevel(r.old_level);
  if (result === "changed" || result === "unchanged") {
    return {
      kind: result,
      oldLevel,
      newLevel: parseQualificationLevel(r.new_level),
      changeId: typeof r.change_id === "string" ? r.change_id : null,
    };
  }
  if (result === "not_found") return { kind: "not_found", oldLevel, message: "No encontré ese contacto" };
  if (result === "invalid") return { kind: "invalid", oldLevel, message: "Ese nivel no es válido (va de 1 a 5)" };
  if (result === "protected") {
    return { kind: "protected", oldLevel, message: "La calificación la puso una persona o una automatización: no se pisa" };
  }
  if (result === "not_raised") return { kind: "not_raised", oldLevel, message: "Solo se puede subir la calificación" };
  return { kind: "error", oldLevel, message: "No pude guardar la calificación" };
}
