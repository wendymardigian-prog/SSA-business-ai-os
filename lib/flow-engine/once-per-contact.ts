/**
 * «Una sola vez por contacto» en un disparador: quien ya tuvo una sesión de ese flujo (activa o terminada) no vuelve a
 * entrar aunque el evento se repita (por ejemplo, si llena el formulario dos veces). PURO: lo usa el panel.
 *
 * Solo vale para los disparadores que corren por `processContactEvent`, que es donde se aplica. Los de mensaje,
 * comentario, inactividad y email entran por otro camino, y «Contacto nuevo» ya dispara una sola vez en su vida.
 * «Webhook recibido» tiene la suya propia (`lib/webhooks/once-per-contact.ts`). `once-per-contact.test.ts` compara esta
 * regla con el registro.
 */
import { triggerEntry } from "./trigger-catalog";

const EVENT_GROUPS: readonly string[] = ["contactos", "agenda", "formularios", "ventas", "tareas", "llamadas", "grupos_whatsapp"];

export function supportsOncePerContact(triggerType: string | null | undefined): boolean {
  const entry = triggerEntry(triggerType);
  return !!entry && entry.type !== "new_contact" && EVENT_GROUPS.includes(entry.group);
}

export const ONCE_PER_CONTACT_TITLE = "Una sola vez por contacto";

export const ONCE_PER_CONTACT_DETAIL =
  "Si esta persona ya pasó por esta automatización (o está pasando), no vuelve a entrar aunque se repita el evento, por ejemplo si llena el formulario dos veces. Lo que originó el evento se guarda igual.";
