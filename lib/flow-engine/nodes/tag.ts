import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { TagNodeData } from "../types";
import { interpolateVariables } from "../interpolate";

/**
 * Agrega o saca un tag del contacto.
 *
 * El tag se crea si no existia: el operador escribe el nombre en el nodo y no
 * tiene por que haberlo dado de alta antes en el CRM.
 */
async function execute({ supabase, data, context, node }: NodeExecutionArgs<TagNodeData>) {
  // El nombre admite variables (`{{answer.interes}}`) y se recorta. Vacio no hace nada: antes creaba una etiqueta "".
  const name = interpolateVariables(String(data.tagName ?? ""), context.variables ?? {}).trim().slice(0, 100);
  if (!name || /\{\{[^}]*\}\}/.test(name)) {
    console.warn(`[flow-engine] el paso ${node.id} no tiene una etiqueta valida: se saltea`);
    return;
  }
  // Agregar o quitar sale del TIPO del paso. El lienzo guarda `{ actionType: "addTag" }` sin `action`, y antes se miraba
  // solo `action === "add"`: un «Agregar etiqueta» armado en el lienzo QUITABA la etiqueta. `action` queda para los
  // pasos viejos que lo traen.
  const actionType = (node.data as { actionType?: string } | undefined)?.actionType;
  const removing = node.type === "removeTag" || actionType === "removeTag" || (!actionType && node.type !== "addTag" && data.action === "remove");
  const adding = !removing;

  if (adding) {
    const { data: tag } = await supabase
      .from("tags")
      .upsert({ workspace_id: context.workspaceId, name }, { onConflict: "workspace_id,name" })
      .select("id")
      .single();
    if (!tag) return;
    await supabase.from("contact_tags").upsert({ contact_id: context.contactId, tag_id: tag.id }).select();
    return;
  }

  // Quitar no crea la etiqueta: si no existe, no hay nada que sacar.
  const { data: tag } = await supabase.from("tags").select("id").eq("workspace_id", context.workspaceId).eq("name", name).maybeSingle();
  if (!tag) return;
  await supabase.from("contact_tags").delete().eq("contact_id", context.contactId).eq("tag_id", tag.id);
}

export const addTagNode: NodeDefinition<TagNodeData> = {
  needsContact: true,
  type: "addTag",
  label: "Agregar tag",
  aliases: [{ nodeType: "action", actionType: "addTag" }],
  execute,
};

export const removeTagNode: NodeDefinition<TagNodeData> = {
  needsContact: true,
  type: "removeTag",
  label: "Quitar tag",
  aliases: [{ nodeType: "action", actionType: "removeTag" }],
  execute,
};
