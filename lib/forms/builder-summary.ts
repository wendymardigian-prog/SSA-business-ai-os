/**
 * El resumen del formulario del panel de la derecha (plano formularios-ui, F11): cuantas preguntas, cuantas son
 * obligatorias, cuantas son condicionales y cuantas van al contacto. Los campos ocultos no son preguntas.
 */
import type { ContactConfig } from "./contact-config";
import type { FormField } from "./fields";

export interface BuilderSummary {
  questions: number;
  required: number;
  conditional: number;
  /** Preguntas (de las que existen hoy) que se guardan en el contacto. */
  toContact: number;
}

export function builderSummary(fields: FormField[], config: ContactConfig): BuilderSummary {
  const visible = fields.filter((f) => f.type !== "hidden");
  const keys = new Set(fields.map((f) => f.key));
  return {
    questions: visible.length,
    required: visible.filter((f) => f.required).length,
    conditional: fields.filter((f) => f.visibility).length,
    toContact: config.map.filter((m) => keys.has(m.fieldKey)).length,
  };
}
