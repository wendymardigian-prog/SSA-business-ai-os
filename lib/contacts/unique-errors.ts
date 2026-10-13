/**
 * Traduce el error de un indice unico de `contacts` (00205) a un mensaje que una persona entienda.
 *
 * Los indices son `uq_contacts_workspace_phone` y `uq_contacts_workspace_email`: un telefono o un email
 * principal solo puede ser de UN contacto vivo por workspace. PURO.
 */

export const CONTACT_PHONE_INDEX = "uq_contacts_workspace_phone";
export const CONTACT_EMAIL_INDEX = "uq_contacts_workspace_email";

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** El mensaje claro si el error es de un indice unico de contactos; null si es otra cosa. */
export function describeContactUniqueViolation(error: DbErrorLike | null | undefined): string | null {
  if (!error || error.code !== "23505") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (text.includes(CONTACT_PHONE_INDEX)) return "Ese telefono ya es de otro contacto";
  if (text.includes(CONTACT_EMAIL_INDEX)) return "Ese email ya es de otro contacto";
  return null;
}
