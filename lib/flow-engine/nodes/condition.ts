import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { ConditionNodeData } from "../types";
import { getConditionOperator, matchConditionField } from "../registry/registry";

/**
 * Ramifica el flow segun el estado del contacto.
 *
 * Ni los campos ni los operadores estan escritos aca: los dos salen del
 * registro. Sumar "¿el contacto esta en la secuencia X?" (F14, Bloque 2) es
 * registrar un campo nuevo, sin tocar este nodo ni el motor.
 *
 * El contacto se carga una sola vez y se le pasa a cada campo, para no hacer
 * una consulta por condicion.
 */
export const conditionNode: NodeDefinition<ConditionNodeData> = {
  type: "condition",
  label: "Condicion",
  async execute({ supabase, data, context }: NodeExecutionArgs<ConditionNodeData>) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "*, contact_tags(tag_id, tags(name)), contact_custom_fields(field_id, value, custom_field_definitions(slug))"
      )
      .eq("id", context.contactId)
      .single();

    if (!contact) return "handle:false";

    const results: boolean[] = [];
    for (const condition of data.conditions) {
      const match = matchConditionField(condition.field);

      // Sin resolver registrado se asume campo personalizado, que es el caso
      // por defecto: el operador escribe el slug del campo tal cual.
      const fieldValue = match
        ? await match.definition.resolve({
            supabase,
            argument: match.argument,
            context,
            contact: contact as unknown as Record<string, unknown>,
          })
        : resolveCustomField(contact as unknown as Record<string, unknown>, condition.field);

      const operator = getConditionOperator(condition.operator);
      results.push(operator ? operator.evaluate(fieldValue, condition.value) : false);
    }

    const passed = data.logic === "and" ? results.every(Boolean) : results.some(Boolean);
    return passed ? "handle:true" : "handle:false";
  },
};

function resolveCustomField(
  contact: Record<string, unknown>,
  slug: string
): string | undefined {
  const customFields = contact.contact_custom_fields as Array<{
    value: string;
    custom_field_definitions: { slug: string } | null;
  }> | null;
  return customFields?.find((f) => f.custom_field_definitions?.slug === slug)?.value;
}
