/**
 * Operadores y campos del nodo Condition.
 *
 * Estaban escritos adentro del motor como dos switch. Ahora son entradas del
 * registro: el Bloque 2 va a sumar aca el campo "¿esta en la secuencia X?"
 * (F14) sin abrir engine.ts ni el nodo.
 */

import { registerConditionField, registerConditionOperator } from "./registry";
import type { ConditionField, ConditionFieldArgs } from "./types";
import { agentStateForConversation } from "@/lib/agent/state";
import { LEGACY_OPERATORS } from "../legacy-operators";
import { MissingFieldError, type FieldValue } from "../condition-eval";
import { answerValueOf, type AnswerSource } from "@/lib/forms/automation/variable-schema"; // @plantilla-quitar(formularios)
import { requireContactId } from "../types";

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
      .eq("contact_id", requireContactId(context))
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
      .eq("contact_id", requireContactId(context))
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

// ------------------------------------------------------------
// Campos de los caminos condicionales ("Condiciones")
// ------------------------------------------------------------
//
// Los resuelve el nodo `branch` con su valor REAL (una lista de tags, un
// numero). El nodo `condition` viejo no los ofrece, pero si alguien escribiera
// uno de estos nombres igual funcionaria: `resolve` es la version en texto.

/** Del valor con tipo al texto que compara el nodo viejo. */
function asText(value: FieldValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function registerTypedField(definition: {
  prefix: string;
  label: string;
  value(args: ConditionFieldArgs): Promise<FieldValue> | FieldValue;
}) {
  const field: ConditionField = {
    prefix: definition.prefix,
    label: definition.label,
    resolveTyped: definition.value,
    resolve: async (args) => {
      try {
        return asText(await definition.value(args));
      } catch (error) {
        // Para el nodo viejo, un campo que ya no existe es "sin valor".
        if (error instanceof MissingFieldError) return undefined;
        throw error;
      }
    },
  };
  registerConditionField(field);
}

/** `a.b.c` dentro de las variables del flow: primero la clave entera, despues anidada. */
export function variablePathValue(variables: Record<string, unknown> | undefined, path: string): FieldValue {
  if (!variables) return undefined;
  let value: unknown = path in variables ? variables[path] : undefined;
  if (value === undefined) {
    value = variables;
    for (const key of path.split(".")) {
      if (typeof value !== "object" || value === null) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  return undefined;
}

// Lo que el disparador deja en las variables del flow: se lee por su ruta.
// Reporte de fin de día (E16): quién, el día, las respuestas por canal y las métricas.  @plantilla-quitar(formularios)
const FLOW_VARIABLE_PREFIXES = [
  "form.", // @plantilla-quitar(formularios)
  "submission.", // @plantilla-quitar(formularios)
  "booking.",
  "sale.", // @plantilla-quitar(ventas)
  "payment.", // @plantilla-quitar(ventas)
  "eod.", // @plantilla-quitar(formularios)
  "member.",
  "metrics.", // @plantilla-quitar(formularios)
  "channel.", // @plantilla-quitar(formularios)
  "report.", // @plantilla-quitar(formularios)
];
for (const prefix of FLOW_VARIABLE_PREFIXES) {
  registerTypedField({
    prefix,
    label: `Dato del flujo (${prefix}*)`,
    value: ({ context, argument }) => variablePathValue(context.variables, `${prefix}${argument}`),
  });
}

registerTypedField({
  prefix: "contact.tags",
  label: "Tags del contacto",
  value: ({ contact }) => {
    const tags = contact.contact_tags;
    if (!Array.isArray(tags)) return [];
    return (tags as Array<{ tags: { name: string } | null }>).map((ct) => ct.tags?.name).filter((name): name is string => !!name);
  },
});

registerTypedField({
  prefix: "contact.sequences",
  label: "Secuencias del contacto",
  // Una inscripcion pausada sigue contando (igual que `sequence:`). Valor = id de la secuencia.
  value: async ({ supabase, context }) => {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("sequence_id, sequences!inner(workspace_id)")
      .eq("contact_id", requireContactId(context))
      .eq("sequences.workspace_id", context.workspaceId)
      .in("status", ["active", "paused"])
      .limit(200);
    if (error) throw new Error(`no pude leer las secuencias del contacto: ${error.message}`);
    return (data ?? []).map((row) => String((row as { sequence_id: string }).sequence_id));
  },
});

registerTypedField({
  prefix: "contact.lead_temperature",
  label: "Temperatura del lead",
  value: ({ contact }) => (typeof contact.lead_temperature === "string" ? contact.lead_temperature : undefined),
});

// Pipeline de contactos (00245). Sin estado = sin valor (el "esta vacio" del evaluador lo atrapa).
const textColumn = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

registerTypedField({
  prefix: "contact.setter_status",
  label: "Estado de setter",
  value: ({ contact }) => textColumn(contact.setter_status),
});

registerTypedField({
  prefix: "contact.closer_status",
  label: "Estado de vendedor",
  value: ({ contact }) => textColumn(contact.closer_status),
});

// El ultimo de los dos, como "rol:clave" (los dos roles pueden tener una clave igual, p. ej. "perdido").
registerTypedField({
  prefix: "contact.last_status",
  label: "Último estado",
  value: ({ contact }) => {
    const role = textColumn(contact.last_status_role);
    const status = textColumn(contact.last_status);
    return role && status ? `${role}:${status}` : undefined;
  },
});

// Producto de interes (00246): el id del producto.
registerTypedField({
  prefix: "contact.interest_product",
  label: "Producto de interés",
  value: ({ contact }) => textColumn(contact.interest_product_id),
});

// @plantilla-desde(formularios)
/**
 * La respuesta del formulario que disparo el flujo, junto con las preguntas de
 * la version con la que se respondio. Se carga UNA vez por corrida del nodo.
 * `null` = no hay con que leerla (sin id de respuesta, o ya no esta): se cae al
 * texto de la variable.
 */
async function loadAnswerSource(args: ConditionFieldArgs): Promise<AnswerSource | null> {
  const submissionId = variablePathValue(args.context.variables, "submission.id");
  if (typeof submissionId !== "string" || !submissionId) return null;

  const load = async (): Promise<AnswerSource | null> => {
    const { data: submission, error } = await args.supabase
      .from("form_submissions")
      .select("form_version_id, answers")
      .eq("id", submissionId)
      .eq("workspace_id", args.context.workspaceId)
      .maybeSingle();
    if (error) throw new Error(`no pude leer la respuesta del formulario: ${error.message}`);
    if (!submission) return null;

    const { data: version, error: versionError } = await args.supabase
      .from("form_versions")
      .select("definition")
      .eq("id", submission.form_version_id)
      .maybeSingle();
    if (versionError) throw new Error(`no pude leer la version del formulario: ${versionError.message}`);
    if (!version) return null;

    const fields = (version.definition as { fields?: unknown } | null)?.fields;
    return {
      fields: Array.isArray(fields) ? (fields as AnswerSource["fields"]) : [],
      answers: (submission.answers ?? {}) as AnswerSource["answers"],
    };
  };

  if (!args.memo) return load();
  const key = `answer-source:${submissionId}`;
  if (!args.memo.has(key)) args.memo.set(key, load());
  return (await args.memo.get(key)) as AnswerSource | null;
}

registerTypedField({
  prefix: "answer.",
  label: "Respuesta del formulario",
  value: async (args) => {
    const path = `answer.${args.argument}`;
    const source = await loadAnswerSource(args);
    // Si la pregunta no esta en la version con la que se respondio, lanza
    // MissingFieldError: "la pregunta ya no existe" no es lo mismo que "vacia".
    if (source) return answerValueOf(path, source);
    // Sin respuesta que leer: el texto de la variable (`{{answer.x}}`).
    return variablePathValue(args.context.variables, path);
  },
});
// @plantilla-hasta(formularios)
