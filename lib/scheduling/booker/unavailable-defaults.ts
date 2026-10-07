/**
 * Los textos por defecto de "si no se puede agendar" (F58), solos y sin
 * dependencias.
 *
 * Viven acá y no junto a la validación porque los necesita el script de embed
 * (`lib/embed/fallback.ts`), que se compila aparte y termina en la página de
 * cualquiera: importar el módulo de validación arrastraba Zod y el resto del
 * módulo de agendamiento al bundle, que pasaba de unos kilobytes a medio mega.
 */

import type { UnavailableKey, UnavailableMessage } from "../types";

export const DEFAULT_UNAVAILABLE_MESSAGES: Record<UnavailableKey, UnavailableMessage> = {
  no_slots: {
    title: "No hay horarios disponibles por ahora",
    body: "Todos los espacios de {{event_title}} están tomados. Escribinos y te buscamos un lugar.",
  },
  unavailable: {
    title: "No podemos mostrar los horarios en este momento",
    body: "Probá de nuevo en unos minutos o escribinos.",
  },
  load_error: {
    title: "No pudimos cargar el calendario",
    body: "Revisá tu conexión y probá de nuevo, o escribinos.",
  },
};

/** Lo que viaja en `data-agenda-fallback` del snippet: ya resuelto, sin variables. */
export interface FallbackPayload {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}
