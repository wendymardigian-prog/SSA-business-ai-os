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
