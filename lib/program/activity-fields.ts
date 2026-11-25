// @plantilla-quitar(servicios)
/**
 * Las preguntas de una actividad del programa, PURO: qué tipos acepta cada formulario del portal, la ayuda que se ve
 * dentro del cuadro y cómo se guarda una pregunta de estrellas. Lo usan el editor y `savePortalForm`.
 *
 * Las estrellas siguen la convención de Formularios (`rating`, 1 a 5, `lib/forms/fields.ts`): así un tablero común de
 * satisfacción las puede sumar sin convertir nada.
 */
import { RATING_MAX, RATING_MIN } from "./activity-answers";

export type PortalFieldType = "short_text" | "long_text" | "file" | "single_select" | "multi_select" | "consent" | "rating";
export type PortalFormKind = "quiz" | "activity" | "terms";

export const PORTAL_FIELD_TYPES: Record<PortalFormKind, readonly PortalFieldType[]> = {
  quiz: ["single_select", "multi_select"],
  activity: ["short_text", "long_text", "file", "single_select", "multi_select", "rating"],
  terms: ["consent"],
};

/** Hasta cuántos caracteres de ayuda (el texto que se ve dentro del cuadro antes de escribir). */
export const HELP_MAX = 300;

export interface PortalFieldInput {
  key: string;
  type: PortalFieldType;
  label: string;
  required: boolean;
  options?: string[];
  consentText?: string;
  help?: string;
}

/** La ayuda limpia: sin espacios de más ni saltos de línea, hasta HELP_MAX. Vacía = sin ayuda. */
export function cleanHelp(help: unknown): string | undefined {
  if (typeof help !== "string") return undefined;
  const t = help.replace(/\s+/g, " ").trim().slice(0, HELP_MAX).trim();
  return t || undefined;
}

/** Lo que se pide al cambiar de tipo: las opciones solo existen en las de selección. */
export function fieldForType<T extends PortalFieldInput>(f: T, type: PortalFieldType): T {
  const selects = type === "single_select" || type === "multi_select";
  return { ...f, type, options: selects ? f.options ?? ["", ""] : undefined };
}

/** Cómo se guarda una pregunta en la definición del formulario. */
export function fieldDefinition(f: PortalFieldInput, kind: PortalFormKind): Record<string, unknown> {
  const help = kind === "activity" ? cleanHelp(f.help) : undefined;
  return {
    id: f.key,
    key: f.key,
    type: f.type,
    label: f.label,
    required: f.required,
    ...(f.options ? { options: f.options } : {}),
    ...(f.consentText ? { consentText: f.consentText } : {}),
    ...(help ? { help } : {}),
    ...(f.type === "rating" ? { min: RATING_MIN, max: RATING_MAX } : {}),
  };
}

/** El primer problema de una lista de preguntas, o null. */
export function portalFieldsIssue(fields: readonly PortalFieldInput[], kind: PortalFormKind): string | null {
  if (fields.length === 0) return "Agregá al menos una pregunta";
  const allowed = PORTAL_FIELD_TYPES[kind];
  const keys = new Set<string>();
  for (const f of fields) {
    if (!allowed.includes(f.type)) return `«${f.label || f.key}»: ese tipo de pregunta no va acá`;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key) || keys.has(f.key)) return "Hay preguntas con la misma clave";
    keys.add(f.key);
    if ((f.type === "single_select" || f.type === "multi_select") && (f.options ?? []).filter((o) => o.trim()).length < 2) return `«${f.label}»: agregá al menos dos opciones`;
    if (f.type === "rating" && !f.label.trim()) return "Escribí la pregunta de las estrellas";
  }
  return null;
}
