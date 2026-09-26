/**
 * Validacion de formato de un secreto, antes de guardarlo.
 *
 * Vive fuera de lib/actions/integrations.ts porque ese archivo es "use server"
 * y ahi todo lo exportado tiene que ser una funcion asincrona: una funcion pura
 * exportada rompe el build. Ademas asi la puede usar tambien el modal para dar
 * el error mientras se escribe, con exactamente la misma regla que el servidor.
 */

import type { SecretField } from "./providers";

export type SecretValidation = { ok: true } | { ok: false; error: string };

/**
 * Valida el formato de un secreto contra lo que declara su campo.
 *
 * No llama al proveedor: eso es "Probar y guardar", y lo hace quien sepa
 * probar esa integracion. Aca solo se atajan los errores de copiado, que son
 * la mayoria.
 */
export function validateSecretValue(field: SecretField, value: string): SecretValidation {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `Pega ${field.label.toLowerCase()}` };

  if (field.keyPrefix && !trimmed.startsWith(field.keyPrefix)) {
    return {
      ok: false,
      error: `${field.label} empieza con "${field.keyPrefix}". Revisa que hayas copiado la correcta.`,
    };
  }
  if (field.minLength && trimmed.length < field.minLength) {
    return {
      ok: false,
      error: `${field.label} parece incompleto: tiene ${trimmed.length} caracteres y se esperan al menos ${field.minLength}.`,
    };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: `${field.label} no puede tener espacios. Copialo de nuevo completo.` };
  }
  return { ok: true };
}
