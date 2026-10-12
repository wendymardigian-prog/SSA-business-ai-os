/**
 * Operadores y campos del nodo Condition.
 *
 * Estaban escritos adentro del motor como dos switch. Ahora son entradas del
 * registro: el Bloque 2 va a sumar aca el campo "¿esta en la secuencia X?"
 * (F14) sin abrir engine.ts ni el nodo.
 */

import { registerConditionField, registerConditionOperator } from "./registry";
import { agentStateForConversation } from "@/lib/agent/state";
import { LEGACY_OPERATORS } from "../legacy-operators";

// ------------------------------------------------------------
// Operadores
// ------------------------------------------------------------

// Los seis de siempre viven en un modulo puro (`legacy-operators.ts`): el
// evaluador tipado de los caminos condicionales usa las MISMAS funciones.
for (const operator of LEGACY_OPERATORS) {
  registerConditionOperator(operator);
}

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
  // Las variables pasaron a admitir objetos (las de agenda son anidadas): una
  // condición compara texto, así que lo que no es texto se vuelve texto.
  resolve: ({ context, argument }) => {
    const value = context.variables?.[argument];
    if (value === undefined || value === null) return undefined;
    return typeof value === "string" ? value : String(value);
  },
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

/**
 * ¿El agente de IA esta activo en esta conversacion? (Fase 3, F32)
 *
 * "true" si esta encendido, atiende el canal, tiene el toggle prendido y no
 * esta pausado. Es el guard dentro de un flow: "seguir solo si el agente esta
 * apagado" es una Condition con agent_active igual a false.
 */
registerConditionField({
  prefix: "agent_active",
  label: "El agente de IA esta activo",
  resolve: async ({ supabase, context }) => {
    if (!context.conversationId) return "false";
    const state = await agentStateForConversation(supabase, {
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
    });
    return String(state.state === "active");
  },
});
