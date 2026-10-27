/**
 * Lo que cada nodo le deja a los pasos que vienen DESPUES, para poder
 * compararlo en un camino condicional ("Condiciones").
 *
 * Es un modulo puro y sin dependencias: el registro de nodos (servidor) lo
 * referencia en `NodeDefinition.outputs` y el catalogo de condiciones
 * (`condition-catalog.ts`, que corre en el navegador) lo importa directo. Una
 * sola fuente, asi lo que el nodo hace y lo que la pantalla ofrece no se
 * separan.
 *
 * Hoy solo dos nodos escriben una variable que despues se lee:
 *   - `httpRequest`: la respuesta, en la variable que se eligio;
 *   - `aiResponse`: el texto generado, SIEMPRE en `ai_response`.
 * Los demas no aportan nada (enviar un mensaje, poner un tag...).
 */

import type { ConditionFieldSpec } from "./condition-eval";

/** Un nodo como lo guarda el canvas. */
export interface RawFlowNode {
  type: string;
  data?: unknown;
}

/**
 * El tipo canonico de un nodo del canvas. El panel guarda los nodos de accion
 * como `type: "action"` con el tipo real en `data.actionType`.
 */
export function canonicalNodeType(node: RawFlowNode): string {
  const actionType = (node.data as { actionType?: unknown } | undefined)?.actionType;
  return node.type === "action" && typeof actionType === "string" ? actionType : node.type;
}

const GROUP = "De pasos anteriores";

export function httpRequestOutputs(data: { responseVariable?: string } | undefined): ConditionFieldSpec[] {
  const name = typeof data?.responseVariable === "string" ? data.responseVariable.trim() : "";
  if (!name) return [];
  return [{ path: `variable:${name}`, label: `Respuesta de la llamada HTTP (${name})`, type: "text", group: GROUP }];
}

export function aiResponseOutputs(): ConditionFieldSpec[] {
  // El nodo guarda siempre el texto en `ai_response`, lo mande o no al contacto.
  return [{ path: "variable:ai_response", label: "Respuesta del agente de IA", type: "text", group: GROUP }];
}

// @plantilla-desde(webhooks)
/** «Crear o actualizar contacto»: qué pasó con el contacto y, si no se pudo, por qué. */
export function upsertContactOutputs(): ConditionFieldSpec[] {
  return [
    {
      path: "variable:contact_result",
      label: "Qué pasó con el contacto",
      type: "single_select",
      options: [
        { value: "created", label: "Se creó" },
        { value: "updated", label: "Se actualizó" },
        { value: "unchanged", label: "Sin cambios" },
      ],
      group: GROUP,
    },
    { path: "variable:contact_fail_reason", label: "Por qué no se pudo", type: "text", group: GROUP, hint: "no_identifier (sin teléfono, email ni red) o not_found (no existe)" },
  ];
}
// @plantilla-hasta(webhooks)

const OUTPUTS: Record<string, (data: never) => ConditionFieldSpec[]> = {
  httpRequest: httpRequestOutputs as (data: never) => ConditionFieldSpec[],
  aiResponse: aiResponseOutputs as (data: never) => ConditionFieldSpec[],
  upsert_contact: upsertContactOutputs as (data: never) => ConditionFieldSpec[], // @plantilla-quitar(webhooks)
};

/** Los tipos de nodo que aportan campos (para el test que lo cruza con el registro). */
export function nodeTypesWithOutputs(): string[] {
  return Object.keys(OUTPUTS);
}

/** Los campos que deja un nodo. Un tipo que no aporta nada devuelve []. */
export function nodeOutputs(node: RawFlowNode): ConditionFieldSpec[] {
  const builder = OUTPUTS[canonicalNodeType(node)];
  return builder ? builder((node.data ?? {}) as never) : [];
}
