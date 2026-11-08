/**
 * «Calificar lead» (00329): fija, suma, resta o quita el nivel de calificación
 * del contacto, o lo calcula con reglas (ver `../qualify-lead.ts`).
 *
 * Pasa por `set_contact_qualification` (la misma función que la ficha): la base
 * recorta entre 1 y 5, anota el cambio en el historial con la automatización
 * como origen y emite `qualification_changed` (que puede disparar otro flujo).
 *
 * Nunca lanza: un paso mal armado o un fallo de la base se anota y el flujo sigue.
 * Necesita contacto.
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { evaluateGroupDetailed } from "../condition-eval";
import { resolveBranchFields } from "./branch";
import {
  QUALIFY_LEAD_TYPE,
  checkQualifyStep,
  qualifyOutcome,
  ruleConditions,
  rulesReason,
  type QualifyLeadStepData,
} from "../qualify-lead";
import { applyContactQualification } from "@/lib/contacts/qualification-core";

async function execute({ supabase, data, context, node }: NodeExecutionArgs<QualifyLeadStepData>): Promise<void> {
  const skip = (reason: string) => {
    console.warn(`[flow-engine] el nodo ${node.id} (${QUALIFY_LEAD_TYPE}) no cambió nada: ${reason}`);
    context.noteStep?.({ status: "skipped", reason });
  };

  const invalid = checkQualifyStep(data);
  if (invalid) return skip(invalid);

  try {
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("qualification_level")
      .eq("id", context.contactId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (error) {
      context.noteStep?.({ status: "failed", reason: "No pude leer el contacto." });
      return;
    }
    if (!contact) return skip("El contacto ya no existe.");
    const current = typeof contact.qualification_level === "number" ? contact.qualification_level : null;

    let matched: number[] = [];
    let reason: string | null = null;
    if (data.mode === "rules") {
      const rules = data.rules ?? [];
      const resolve = await resolveBranchFields(supabase, context, ruleConditions(data));
      const hit = new Set<string>();
      for (const rule of rules) {
        if (evaluateGroupDetailed(rule, resolve).passed) hit.add(rule.id);
      }
      matched = rules.filter((r) => hit.has(r.id)).map((r) => r.points);
      reason = rulesReason(rules, hit);
    }

    const outcome = qualifyOutcome(data, current, matched);
    if (outcome.kind === "none") return skip(outcome.reason);

    const result = await applyContactQualification(supabase, {
      workspaceId: context.workspaceId,
      contactId: context.contactId,
      mode: outcome.mode,
      value: outcome.value,
      source: "automation",
      flowId: context.flowId ?? null,
      reason: reason ?? (data.label?.trim() || null),
    });
    if (result.kind === "unchanged") return skip(reason ? `${reason}: el nivel quedó igual.` : "El nivel quedó igual.");
    if (result.kind !== "changed") {
      context.noteStep?.({ status: "failed", reason: "message" in result ? result.message : "No pude cambiar la calificación." });
    }
  } catch (err) {
    console.error(`[flow-engine] «Calificar lead» falló:`, err instanceof Error ? err.message : err);
    context.noteStep?.({ status: "failed", reason: "No pude cambiar la calificación." });
  }
}

export const qualifyLeadNode: NodeDefinition<QualifyLeadStepData> = {
  needsContact: true,
  type: QUALIFY_LEAD_TYPE,
  label: "Calificar lead",
  aliases: [{ nodeType: "action", actionType: QUALIFY_LEAD_TYPE }],
  execute,
};
