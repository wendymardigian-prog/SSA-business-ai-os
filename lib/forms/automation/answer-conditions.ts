/**
 * El "Solo si…" de una automatizacion de formulario: la unica parte del
 * disparador que el editor de pasos puede cambiar.
 *
 * Es `answer_conditions` del nodo disparador (el MISMO formato de siempre,
 * validado con `parseFormTriggerConfig`). NO se migra a Condiciones: decide si
 * el flujo arranca; Condiciones decide por donde sigue una vez que arranco.
 * Todo lo demas del disparador (el tipo, los formularios, el puntaje de una
 * encuesta) sale de lo guardado y el editor no lo toca.
 */

import { parseFormTriggerConfig } from "./trigger-config";

export type AnswerConditionsResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/**
 * Los datos del disparador con el "Solo si…" nuevo.
 *  - `undefined`: no se toca (el navegador no mando nada).
 *  - `null` o vacio: se saca.
 *  - un contrato firmado no admite condiciones sobre respuestas.
 */
export function withAnswerConditions(triggerData: Record<string, unknown>, raw: unknown): AnswerConditionsResult {
  if (raw === undefined) return { ok: true, data: triggerData };

  const type = String(triggerData.triggerType ?? "form_submitted");
  if (type === "contract_signed") {
    return raw === null ? { ok: true, data: triggerData } : { ok: false, error: "Un contrato firmado no admite condiciones sobre las respuestas." };
  }

  const parsed = parseFormTriggerConfig(type, { form_ids: Array.isArray(triggerData.form_ids) ? triggerData.form_ids : [], answer_conditions: raw });
  if (!parsed.ok) return { ok: false, error: "Las condiciones de «Solo si…» no son válidas." };

  const conditions = parsed.config.answer_conditions;
  const empty = !conditions || (conditions.conditions.length === 0 && conditions.groups.every((g) => g.conditions.length === 0));

  const next = { ...triggerData };
  if (empty) delete next.answer_conditions;
  else next.answer_conditions = conditions;
  return { ok: true, data: next };
}
