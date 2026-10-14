/**
 * Lo que falta para publicar, por pregunta y en general (plano formularios-ui, F9). Puro.
 *
 * Los mensajes son los de `checkPublishable` (los mismos que el servidor usa al publicar). Lo nuevo es que cada uno
 * sabe de que pregunta es, para marcarlo en rojo en su tarjeta; lo que no es de una pregunta (el link, el texto del
 * contrato, el puntaje de la encuesta) queda en la lista general de arriba del lienzo.
 */
import { validateDefinitionDetailed } from "./definition-schema";
import type { FormDefinition, FormType } from "./fields";
import { SLUG_PATTERN } from "./list";

export interface PublishIssues {
  /** Lo que no es de una pregunta. */
  general: string[];
  /** Por clave de pregunta: lo que le falta, sin repetir su nombre (ya esta en la tarjeta). */
  byField: Record<string, string[]>;
  /** Cuantas cosas hay que arreglar en total. */
  total: number;
  /** La clave de la primera pregunta con un problema, en el orden del formulario. */
  firstFieldKey: string | null;
}

const NONE: PublishIssues = { general: [], byField: {}, total: 0, firstFieldKey: null };

/** `"Email": cargá al menos 2 opciones` -> `cargá al menos 2 opciones`; `fields.3.label: Falta la etiqueta` -> `Falta la etiqueta`. */
export function stripFieldPrefix(message: string): string {
  return message.replace(/^"[^"]*": /, "").replace(/^fields\.\d+\.[\w.]+: /, "");
}

export function publishIssues(input: {
  type: FormType;
  slug: string;
  definition: unknown;
  /** Las reglas propias de cada tipo (`typeChecks`): devuelven motivos que no son de una pregunta. */
  extraChecks?: Array<(definition: FormDefinition) => string[]>;
}): PublishIssues {
  const general: string[] = [];
  const byField: Record<string, string[]> = {};

  if (!SLUG_PATTERN.test(input.slug)) {
    general.push("El link del formulario no es válido (3 a 60 caracteres: minúsculas, números y guiones)");
  }

  const result = validateDefinitionDetailed(input.definition, { formType: input.type });
  result.errors.forEach((message, i) => {
    const owner = result.owners[i];
    if (owner) (byField[owner] ??= []).push(stripFieldPrefix(message));
    else general.push(message);
  });

  // Las reglas de cada tipo solo corren sobre una definicion que ya es valida (igual que al publicar).
  if (result.ok && result.definition) {
    for (const check of input.extraChecks ?? []) general.push(...check(result.definition));
  }

  const total = general.length + Object.values(byField).reduce((sum, list) => sum + list.length, 0);
  if (total === 0) return NONE;

  const order = (((input.definition as { fields?: Array<{ key?: unknown }> } | null | undefined)?.fields ?? []) as Array<{ key?: unknown }>).map((f) => f.key);
  const firstFieldKey = order.find((key): key is string => typeof key === "string" && key in byField) ?? null;
  return { general, byField, total, firstFieldKey };
}
