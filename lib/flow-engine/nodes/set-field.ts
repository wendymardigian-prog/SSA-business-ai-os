import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { SetFieldNodeData } from "../types";
import { interpolateVariables } from "../interpolate";
import { normalizeCustomValue } from "@/lib/custom-fields";

/** Un `{{token}}` que quedó sin resolver: el dato no estaba en el flujo. */
const UNRESOLVED_TOKEN = /\{\{[\w-]+(?:\.[\w-]+)*\}\}/;

export type SetFieldDecision =
  | { kind: "write"; value: string }
  | { kind: "clear" }
  | { kind: "skip"; reason: "unresolved_variable" | "invalid_value" };

/**
 * Qué hace el paso con el valor ya interpolado. Puro, para probarlo.
 *   - vacío: borra el valor (la tabla no guarda strings vacíos).
 *   - con una variable sin resolver: no escribe nada (guardaría "{{x}}").
 *   - que no corresponde al tipo: no escribe nada.
 *   - si no, el valor normalizado por tipo (la misma regla que la ficha).
 */
export function decideSetField(type: string, interpolated: string): SetFieldDecision {
  const text = interpolated.trim();
  if (text === "") return { kind: "clear" };
  if (UNRESOLVED_TOKEN.test(text)) return { kind: "skip", reason: "unresolved_variable" };
  const normalized = normalizeCustomValue(type, text);
  if (!normalized.ok) return { kind: "skip", reason: "invalid_value" };
  return { kind: "write", value: normalized.value };
}

/** Escribe un campo personalizado del contacto. El valor admite {{variables}}. */
export const setCustomFieldNode: NodeDefinition<SetFieldNodeData> = {
  needsContact: true,
  type: "setCustomField",
  label: "Definir campo",
  aliases: [{ nodeType: "action", actionType: "setCustomField" }],
  async execute({ supabase, data, context }: NodeExecutionArgs<SetFieldNodeData>) {
    const { data: fieldDef } = await supabase
      .from("custom_field_definitions")
      .select("id, type")
      .eq("workspace_id", context.workspaceId)
      .eq("slug", data.fieldSlug)
      .is("deleted_at", null)
      .maybeSingle();

    if (!fieldDef) return;

    const decision = decideSetField(fieldDef.type, interpolateVariables(data.value ?? "", context.variables || {}));

    if (decision.kind === "skip") {
      // Sin el valor: el campo queda como estaba (no se loguea el valor, puede ser un dato personal).
      console.warn(`[flow-engine] "Definir campo" (${data.fieldSlug}) no escribió nada: ${decision.reason}`);
      return;
    }
    if (decision.kind === "clear") {
      await supabase.from("contact_custom_fields").delete().eq("contact_id", context.contactId).eq("field_id", fieldDef.id);
      return;
    }
    await supabase.from("contact_custom_fields").upsert(
      { contact_id: context.contactId, field_id: fieldDef.id, value: decision.value, updated_at: new Date().toISOString() },
      { onConflict: "contact_id,field_id" }
    );
  },
};
