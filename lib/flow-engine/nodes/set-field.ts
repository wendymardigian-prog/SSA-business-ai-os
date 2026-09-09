import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { SetFieldNodeData } from "../types";
import { interpolateVariables } from "../interpolate";

/** Escribe un campo personalizado del contacto. El valor admite {{variables}}. */
export const setCustomFieldNode: NodeDefinition<SetFieldNodeData> = {
  type: "setCustomField",
  label: "Definir campo",
  aliases: [{ nodeType: "action", actionType: "setCustomField" }],
  async execute({ supabase, data, context }: NodeExecutionArgs<SetFieldNodeData>) {
    const { data: fieldDef } = await supabase
      .from("custom_field_definitions")
      .select("id")
      .eq("workspace_id", context.workspaceId)
      .eq("slug", data.fieldSlug)
      .is("deleted_at", null)
      .single();

    if (!fieldDef) return;

    const value = interpolateVariables(data.value, context.variables || {});

    await supabase.from("contact_custom_fields").upsert(
      { contact_id: context.contactId, field_id: fieldDef.id, value },
      { onConflict: "contact_id,field_id" }
    );
  },
};
