/**
 * El alta rápida de un contacto desde el asistente de venta (plano F18). Lo puro se mudó a
 * `lib/contacts/manual-contact.ts` (lo usa también «Nuevo servicio»); acá se re-exporta para no
 * cambiar los imports de Ventas.
 */
export {
  manualContactSchema,
  resolveFoundContact,
  type ManualContactInput,
  type FindContactResult,
  type ContactResolution,
} from "@/lib/contacts/manual-contact";
