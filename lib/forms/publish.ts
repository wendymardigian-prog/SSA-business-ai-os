/**
 * Reglas previas a publicar (F8) y detección de cambios sin publicar.
 *
 * La publicación en sí es la función SQL `publish_form_version` (una
 * transacción). Esto es lo que se chequea ANTES de llamarla, para poder decirle
 * a la persona qué falta.
 */
import { validateDefinition } from "./definition-schema";
import type { FormDefinition, FormType } from "./fields";
import { SLUG_PATTERN } from "./list";

export interface PublishInput {
  type: FormType;
  slug: string;
  definition: unknown;
  /** Reglas propias de cada tipo (encuesta, contrato): devuelven los motivos que falten. */
  extraChecks?: Array<(definition: FormDefinition) => string[]>;
}

export type PublishCheck = { ok: true; definition: FormDefinition } | { ok: false; reasons: string[] };

export function checkPublishable(input: PublishInput): PublishCheck {
  const reasons: string[] = [];

  if (!SLUG_PATTERN.test(input.slug)) {
    reasons.push("El link del formulario no es válido (3 a 60 caracteres: minúsculas, números y guiones)");
  }

  const result = validateDefinition(input.definition);
  if (!result.ok) {
    reasons.push(...result.errors);
    return { ok: false, reasons };
  }

  for (const check of input.extraChecks ?? []) reasons.push(...check(result.definition));

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, definition: result.definition };
}

/** JSON con las claves ordenadas: dos definiciones iguales dan el mismo texto. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * ¿El borrador difiere de la versión vigente? Sin versión vigente, hay cambios
 * apenas el borrador tenga algo. Los ids internos de los renglones de la
 * interfaz de condiciones no cuentan.
 */
export function hasUnpublishedChanges(draft: unknown, publishedDefinition: unknown | null | undefined): boolean {
  if (publishedDefinition === null || publishedDefinition === undefined) return true;
  return stableStringify(stripUiIds(draft)) !== stableStringify(stripUiIds(publishedDefinition));
}

function stripUiIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUiIds);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      // `id` de condiciones y grupos es de la interfaz; el `id` de un campo sí es parte de la definición.
      out[key] = stripUiIds(entry);
    }
    return out;
  }
  return value;
}
