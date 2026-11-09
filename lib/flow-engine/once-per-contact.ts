/**
 * «Una sola vez por contacto» en un disparador: quien ya tuvo una sesión de ese flujo (activa o terminada) no vuelve a
 * entrar aunque el evento se repita. PURO: lo usa el panel.
 *
 * Solo vale para los disparadores que corren por `processContactEvent`, que es donde se aplica. Los de mensaje,
 * comentario, inactividad y email entran por otro camino, y «Contacto nuevo» ya dispara una sola vez en su vida.
 * `once-per-contact.test.ts` compara esta regla con el registro.
 */
import { triggerEntry } from "./trigger-catalog";

// Servicios: sus disparadores tambien corren por eventos sobre un contacto (el cliente del servicio).
const EVENT_GROUPS: readonly string[] = ["contactos", "agenda", "formularios", "ventas", "tareas", "llamadas", "grupos_whatsapp", "servicios"]; // @plantilla-quitar(formularios,ventas,tareas,llamadas,servicios)
// @plantilla-sin(formularios,ventas,tareas,llamadas): const EVENT_GROUPS: readonly string[] = ["contactos", "agenda", "grupos_whatsapp"];

export function supportsOncePerContact(triggerType: string | null | undefined): boolean {
  const entry = triggerEntry(triggerType);
  return !!entry && entry.type !== "new_contact" && EVENT_GROUPS.includes(entry.group);
}

export const ONCE_PER_CONTACT_TITLE = "Una sola vez por contacto";

export const ONCE_PER_CONTACT_DETAIL =
  "Si esta persona ya pasó por esta automatización (o está pasando), no vuelve a entrar aunque se repita el evento, por ejemplo si llena el formulario dos veces. Lo que originó el evento se guarda igual."; // @plantilla-quitar(formularios)
  // @plantilla-sin(formularios): "Si esta persona ya pasó por esta automatización (o está pasando), no vuelve a entrar aunque se repita el evento, por ejemplo si agenda dos veces. Lo que originó el evento se guarda igual.";
