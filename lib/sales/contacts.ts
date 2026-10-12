/**
 * El alta rápida de un contacto desde el asistente de venta (plano F18). Puro: valida lo que
 * se escribió y decide qué hacer con lo que devolvió `find_contact_by_phone_or_email`
 * (Formularios, 00156): teléfono primero, después email; NO crea contactos.
 *
 * El alta manual NO usa `find_or_link_contact`: ese exige un `channel_id` y es para lo que
 * entra por un canal. Nunca se deduplica por nombre.
 */
import { z } from "zod";

export const manualContactSchema = z
  .object({
    name: z.string().trim().min(1, "Poné el nombre").max(120, "Máximo 120 caracteres"),
    email: z.string().trim().max(200).email("El email no es válido").nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(40).nullable().optional(),
  })
  .refine((v) => !!(v.email && v.email.trim()) || !!(v.phone && v.phone.trim()), { message: "Poné al menos un email o un teléfono", path: ["email"] });

export type ManualContactInput = z.input<typeof manualContactSchema>;

export interface FindContactResult {
  contact_id: string | null;
  matched_by?: string | null;
  conflict_contact_id?: string | null;
}

export type ContactResolution =
  | { kind: "existing"; contactId: string; matchedBy: string | null; conflictContactId: string | null; notice: string }
  | { kind: "create" };

/** Con un id, se usa ese contacto (y se avisa); con `null`, la Server Action inserta uno nuevo. */
export function resolveFoundContact(found: FindContactResult | null | undefined): ContactResolution {
  if (!found?.contact_id) return { kind: "create" };
  const conflict = found.conflict_contact_id ?? null;
  return {
    kind: "existing",
    contactId: found.contact_id,
    matchedBy: found.matched_by ?? null,
    conflictContactId: conflict,
    notice: conflict ? "Ya existía un contacto con ese teléfono: se usó ese. El email pertenece a otro contacto." : "Ya existía: se usó ese contacto.",
  };
}
