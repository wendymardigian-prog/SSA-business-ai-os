/**
 * Operadores y campos del nodo Condition.
 *
 * Estaban escritos adentro del motor como dos switch. Ahora son entradas del
 * registro: el Bloque 2 va a sumar aca el campo "¿esta en la secuencia X?"
 * (F14) sin abrir engine.ts ni el nodo.
 */

import { registerConditionField, registerConditionOperator } from "./registry";

// ------------------------------------------------------------
// Operadores
// ------------------------------------------------------------

registerConditionOperator({
  operator: "equals",
  label: "es igual a",
  evaluate: (actual, expected) => actual === expected,
});

registerConditionOperator({
  operator: "not_equals",
  label: "no es igual a",
  evaluate: (actual, expected) => actual !== expected,
});

registerConditionOperator({
  operator: "contains",
  label: "contiene",
  evaluate: (actual, expected) => actual?.includes(expected) || false,
});

registerConditionOperator({
  operator: "exists",
  label: "tiene algun valor",
  evaluate: (actual) => actual !== undefined && actual !== null && actual !== "",
});

registerConditionOperator({
  operator: "gt",
  label: "es mayor que",
  evaluate: (actual, expected) => Number(actual) > Number(expected),
});

registerConditionOperator({
  operator: "lt",
  label: "es menor que",
  evaluate: (actual, expected) => Number(actual) < Number(expected),
});

// ------------------------------------------------------------
// Campos
// ------------------------------------------------------------

registerConditionField({
  prefix: "platform",
  label: "Canal",
  resolve: ({ context }) => context.platform,
});

registerConditionField({
  prefix: "is_subscribed",
  label: "Esta suscripto",
  resolve: ({ contact }) => String(contact.is_subscribed),
});

registerConditionField({
  prefix: "tag:",
  label: "Tiene el tag",
  resolve: ({ contact, argument }) => {
    const tags = contact.contact_tags;
    const hasTag =
      Array.isArray(tags) &&
      (tags as Array<{ tags: { name: string } | null }>).some(
        (ct) => ct.tags?.name === argument
      );
    return String(hasTag);
  },
});

registerConditionField({
  prefix: "variable:",
  label: "Variable del flow",
  resolve: ({ context, argument }) => context.variables?.[argument],
});

/**
 * ¿Esta en la secuencia X? (F14)
 *
 * Una inscripcion pausada sigue contando: el contacto sigue adentro, solo que
 * frenado porque respondio o porque se pauso la secuencia. Deja de contar
 * cuando termino o cuando lo sacaron.
 *
 * El argumento es el ID de la secuencia, no el nombre: los nombres se editan, y
 * un flow no puede romperse porque alguien renombro algo.
 */
registerConditionField({
  prefix: "sequence:",
  label: "Esta en la secuencia",
  resolve: async ({ supabase, argument, context }) => {
    if (!argument) return undefined;
    const { data } = await supabase
      .from("sequence_enrollments")
      .select("id, sequences!inner(workspace_id)")
      .eq("contact_id", context.contactId)
      .eq("sequence_id", argument)
      .eq("sequences.workspace_id", context.workspaceId)
      .in("status", ["active", "paused"])
      .limit(1);
    return String((data?.length ?? 0) > 0);
  },
});

/**
 * ¿Estuvo alguna vez en la secuencia X? (F14)
 *
 * Es exacto sin llevar un historial aparte: la fila de la inscripcion nunca se
 * borra, se marca como completada o cancelada.
 */
registerConditionField({
  prefix: "sequence_ever:",
  label: "Estuvo alguna vez en la secuencia",
  resolve: async ({ supabase, argument, context }) => {
    if (!argument) return undefined;
    const { data } = await supabase
      .from("sequence_enrollments")
      .select("id, sequences!inner(workspace_id)")
      .eq("contact_id", context.contactId)
      .eq("sequence_id", argument)
      .eq("sequences.workspace_id", context.workspaceId)
      .limit(1);
    return String((data?.length ?? 0) > 0);
  },
});
