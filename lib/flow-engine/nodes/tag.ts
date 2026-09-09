import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { TagNodeData } from "../types";

/**
 * Agrega o saca un tag del contacto.
 *
 * El tag se crea si no existia: el operador escribe el nombre en el nodo y no
 * tiene por que haberlo dado de alta antes en el CRM.
 */
async function execute({ supabase, data, context }: NodeExecutionArgs<TagNodeData>) {
  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      { workspace_id: context.workspaceId, name: data.tagName },
      { onConflict: "workspace_id,name" }
    )
    .select("id")
    .single();

  if (!tag) return;

  if (data.action === "add") {
    await supabase
      .from("contact_tags")
      .upsert({ contact_id: context.contactId, tag_id: tag.id })
      .select();
  } else {
    await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", context.contactId)
      .eq("tag_id", tag.id);
  }
}

export const addTagNode: NodeDefinition<TagNodeData> = {
  type: "addTag",
  label: "Agregar tag",
  aliases: [{ nodeType: "action", actionType: "addTag" }],
  execute,
};

export const removeTagNode: NodeDefinition<TagNodeData> = {
  type: "removeTag",
  label: "Quitar tag",
  aliases: [{ nodeType: "action", actionType: "removeTag" }],
  execute,
};
