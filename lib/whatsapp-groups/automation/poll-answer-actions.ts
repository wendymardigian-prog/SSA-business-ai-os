/**
 * «Etiquetar según la respuesta» de una encuesta de grupo (bandeja → la encuesta). PURO.
 *
 * Sin pasar por el lienzo: la persona escribe, para cada respuesta, la etiqueta que se le pone al contacto que la
 * elige (por defecto, el mismo texto de la respuesta; vacía = esa respuesta no etiqueta), y opcionalmente un campo
 * de texto del contacto donde guardar lo que respondió. De eso salen automatizaciones comunes, que después se ven y
 * se editan en Automatizaciones como cualquier otra:
 *
 *   - una por respuesta con etiqueta: «Votó en una encuesta de un grupo» filtrado a ESA respuesta → «Agregar etiqueta».
 *     Una por respuesta (y no una sola con caminos) para que una encuesta de varias respuestas ponga todas las que eligió.
 *   - una para el campo: filtrada a TODAS las respuestas → «Definir campo» con `{{poll.selected}}`. Con el filtro puesto
 *     la clave del disparo incluye lo elegido, así que si la persona cambia su voto el campo se actualiza.
 *
 * Todas llevan la categoría de la encuesta, para encontrarlas juntas en la lista.
 */

import { MAX_CATEGORY_LENGTH } from "@/lib/flows/categories";

export const MAX_TAG_LENGTH = 100;
const MAX_NAME = 80;

export interface PollAnswerActionsInput {
  groupId: string;
  messageId: string;
  pollName: string;
  /** Las respuestas de la encuesta, en su orden (las de la encuesta guardada, no las del navegador). */
  options: string[];
  /** Respuesta → etiqueta. Una respuesta que no está, o con texto vacío, no etiqueta. */
  tags: Record<string, string>;
  /** El campo de texto donde guardar la respuesta, o null. */
  field: { slug: string; name: string } | null;
}

interface BuiltNode {
  id: string;
  type: "trigger" | "action";
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface BuiltFlow {
  name: string;
  categories: string[];
  nodes: BuiltNode[];
  edges: Array<{ id: string; source: string; target: string }>;
}

export const NOTHING_TO_DO = "Escribí al menos una etiqueta o elegí un campo.";
export const TAG_TOO_LONG = `Una etiqueta puede tener hasta ${MAX_TAG_LENGTH} caracteres.`;
export const TAG_WITH_VARIABLE = "Una etiqueta no puede llevar variables ({{...}}): escribí el texto tal cual.";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Las etiquetas que quedan, por respuesta, ya limpias (sin espacios de más; vacías afuera). */
export function cleanTags(options: string[], tags: Record<string, string>): Array<{ option: string; tag: string }> {
  const out: Array<{ option: string; tag: string }> = [];
  for (const option of options) {
    const tag = oneLine(String(tags[option] ?? ""));
    if (tag) out.push({ option, tag });
  }
  return out;
}

/** Lo que impide crear las automatizaciones, o null. */
export function pollAnswerActionsProblem(input: Pick<PollAnswerActionsInput, "options" | "tags" | "field">): string | null {
  const tags = cleanTags(input.options, input.tags);
  if (tags.length === 0 && !input.field) return NOTHING_TO_DO;
  if (tags.some((t) => t.tag.length > MAX_TAG_LENGTH)) return TAG_TOO_LONG;
  if (tags.some((t) => /\{\{|\}\}/.test(t.tag))) return TAG_WITH_VARIABLE;
  return null;
}

/**
 * La categoría que agrupa las automatizaciones de una encuesta. Sin comas: el filtro de la lista
 * (`?categoria=a,b`) las separa por coma.
 */
export function pollCategory(pollName: string): string {
  return clip(`Encuesta: ${oneLine(pollName.replace(/,/g, " ")) || "sin título"}`, MAX_CATEGORY_LENGTH);
}

function trigger(input: PollAnswerActionsInput, options: string[]): BuiltNode {
  return {
    id: "trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      triggerType: "whatsapp_group_poll_vote",
      group_ids: [input.groupId],
      message_scope: "picked",
      message_ids: [input.messageId],
      options,
    },
  };
}

function flowOf(input: PollAnswerActionsInput, name: string, triggerOptions: string[], step: Record<string, unknown>): BuiltFlow {
  return {
    name: clip(oneLine(name), MAX_NAME),
    categories: ["Grupos de WhatsApp", pollCategory(input.pollName)],
    nodes: [trigger(input, triggerOptions), { id: "step", type: "action", position: { x: 0, y: 160 }, data: step }],
    edges: [{ id: "e-trigger-step", source: "trigger", target: "step" }],
  };
}

/** Las automatizaciones que salen de lo elegido (vacío si no hay nada que hacer). */
export function buildPollAnswerFlows(input: PollAnswerActionsInput): BuiltFlow[] {
  if (pollAnswerActionsProblem(input)) return [];
  const poll = clip(oneLine(input.pollName) || "encuesta", 40);
  const flows = cleanTags(input.options, input.tags).map(({ option, tag }) =>
    flowOf(input, `Encuesta «${poll}» · ${option} → etiqueta «${tag}»`, [option], { actionType: "addTag", tagName: tag }),
  );
  if (input.field) {
    flows.push(
      flowOf(input, `Encuesta «${poll}» · respuesta → campo «${input.field.name}»`, [...input.options], {
        actionType: "setCustomField",
        fieldSlug: input.field.slug,
        value: "{{poll.selected}}",
      }),
    );
  }
  return flows;
}
