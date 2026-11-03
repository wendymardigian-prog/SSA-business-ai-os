/**
 * Las reglas de una encuesta de WhatsApp que se manda (desde la bandeja o con el paso «Enviar encuesta»). PURO.
 *
 * WhatsApp acepta de 2 a 12 opciones distintas. `selectableCount`: 1 = una sola opcion; 0 = todas las que quiera.
 */

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 12;
export const POLL_MAX_QUESTION = 255;
export const POLL_MAX_OPTION = 100;

export interface PollDraft {
  question: string;
  options: string[];
  /** true = se pueden elegir varias. */
  multiple: boolean;
}

export type PollValidation =
  | { ok: true; poll: { name: string; values: string[]; selectableCount: number } }
  | { ok: false; error: string };

export function validatePoll(draft: PollDraft): PollValidation {
  const name = (draft.question ?? "").trim();
  if (!name) return { ok: false, error: "Escribí la pregunta de la encuesta." };
  if (name.length > POLL_MAX_QUESTION) return { ok: false, error: `La pregunta puede tener hasta ${POLL_MAX_QUESTION} caracteres.` };

  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of draft.options ?? []) {
    const option = (raw ?? "").trim();
    if (!option) continue;
    if (option.length > POLL_MAX_OPTION) return { ok: false, error: `Cada opción puede tener hasta ${POLL_MAX_OPTION} caracteres.` };
    const key = option.toLocaleLowerCase("es");
    if (seen.has(key)) return { ok: false, error: `La opción «${option}» está repetida.` };
    seen.add(key);
    values.push(option);
  }
  if (values.length < POLL_MIN_OPTIONS) return { ok: false, error: `Poné al menos ${POLL_MIN_OPTIONS} opciones.` };
  if (values.length > POLL_MAX_OPTIONS) return { ok: false, error: `WhatsApp acepta hasta ${POLL_MAX_OPTIONS} opciones.` };
  return { ok: true, poll: { name, values, selectableCount: draft.multiple ? 0 : 1 } };
}
