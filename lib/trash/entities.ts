/**
 * La Papelera (docs/papelera.md): qué tipos de registro se eliminan, con qué clave y cómo se llaman en pantalla.
 *
 * Es la gemela de `private.trash_can` (supabase/migrations/00410_trash_engine.sql): `entities.test.ts` compara las
 * dos. Un tipo nuevo se suma acá, en esa función y en `private.trash_plan` (00411), en el mismo cambio.
 *
 * Módulo PURO: lo importan componentes del navegador.
 */

export const TRASH_ENTITIES = {
  booking: { key: "bookings.delete", singular: "la agenda", plural: "Agendas" },
  sale: { key: "sales.delete", singular: "la venta", plural: "Ventas" },
  payment: { key: "payments.delete", singular: "el pago", plural: "Pagos" },
  product: { key: "products.delete", singular: "el producto", plural: "Productos" },
  service: { key: "services.delete", singular: "el servicio", plural: "Servicios" },
  call: { key: "calls.delete", singular: "la grabación", plural: "Grabaciones" },
  form: { key: "forms.delete", singular: "el formulario", plural: "Formularios" },
  form_submission: { key: "forms.delete_responses", singular: "la respuesta", plural: "Respuestas de formularios" },
  eod_report: { key: "eod.delete", singular: "el reporte de fin de día", plural: "Reportes de fin de día" },
  expense: { key: "expenses.delete", singular: "el gasto", plural: "Gastos" },
  commission: { key: "commissions.delete", singular: "la comisión", plural: "Comisiones" },
  content_post: { key: "content.delete", singular: "la pieza", plural: "Piezas de contenido" },
  content_idea: { key: "content.delete", singular: "la idea", plural: "Ideas de contenido" },
  conversation: { key: "conversations.delete", singular: "la conversación", plural: "Conversaciones" },
} as const;

export type TrashEntity = keyof typeof TRASH_ENTITIES;

/** Los que ya se borraban antes (borrado suave con `deleted_at`): la Papelera los lista y los restaura igual. */
export const SOFT_DELETE_ENTITIES = {
  contact: { key: "contacts.delete", singular: "el contacto", plural: "Contactos" },
  task: { key: "tasks.delete", singular: "la tarea", plural: "Tareas" },
} as const;

export type SoftDeleteEntity = keyof typeof SOFT_DELETE_ENTITIES;
export type AnyTrashEntity = TrashEntity | SoftDeleteEntity;

export function isTrashEntity(value: unknown): value is TrashEntity {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TRASH_ENTITIES, value);
}

export function isSoftDeleteEntity(value: unknown): value is SoftDeleteEntity {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOFT_DELETE_ENTITIES, value);
}

export function trashKeyOf(entity: AnyTrashEntity): string {
  return isSoftDeleteEntity(entity) ? SOFT_DELETE_ENTITIES[entity].key : TRASH_ENTITIES[entity].key;
}

export function trashPluralOf(entity: AnyTrashEntity): string {
  return isSoftDeleteEntity(entity) ? SOFT_DELETE_ENTITIES[entity].plural : TRASH_ENTITIES[entity].plural;
}

/** Todas las claves que dan acceso a la Papelera (con una alcanza para ver la pestaña). */
export const TRASH_PERMISSION_KEYS: readonly string[] = Array.from(
  new Set([...Object.values(TRASH_ENTITIES), ...Object.values(SOFT_DELETE_ENTITIES)].map((e) => e.key)),
);

/** Días que faltan para que se borre para siempre (0 si ya venció). */
export function daysLeft(expiresAt: string, now: Date = new Date()): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** Cuánto dura la Papelera (la misma cuenta que `expires_at` en la base y la purga de contactos). */
export const TRASH_RETENTION_DAYS = 30;
