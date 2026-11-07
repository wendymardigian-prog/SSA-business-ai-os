/**
 * Los destinos que ofrece «Armar un link» de una pieza: los formularios publicados y las agendas del negocio, para no
 * tener que ir a buscar su link a otra pantalla (7/11/2026). El link final lo sigue armando `composePieceLink`.
 *
 * Funciona porque `/f/<slug>` y `/calendario/<usuario>/<evento>` leen los UTM de la URL y el toque guarda
 * `utm_content`: el trigger `contact_touches_content_code` lo reconoce como el código de la pieza.
 *
 * Vive en `lib/attribution` y no en `lib/forms`: la plantilla de estudiantes no tiene Formularios y sí Agenda. La parte
 * de formularios está en `lib/forms/link-destinations.ts`.
 *
 * Modulo PURO.
 */
import { eventPublicUrl } from "@/lib/scheduling/public-url";

export type PieceLinkDestinationKind = "form" | "event";

export interface PieceLinkDestination {
  kind: PieceLinkDestinationKind;
  id: string;
  label: string;
  url: string;
  /** Un formulario que no vincula las respuestas con contactos: sin contacto no hay toque y no suma a la pieza. */
  noContact?: boolean;
}

export interface PieceLinkDestinations {
  forms: PieceLinkDestination[];
  events: PieceLinkDestination[];
}

/** El valor del desplegable para «Otro link» (el que se pega a mano). */
export const CUSTOM_DESTINATION = "custom";

/** El valor de un destino en el desplegable. */
export function destinationKey(destination: Pick<PieceLinkDestination, "kind" | "id">): string {
  return `${destination.kind}:${destination.id}`;
}

export interface EventDestinationInput {
  events: Array<{ id: string; title: string; slug: string; status: string; owner_user_id: string }>;
  profiles: Array<{ user_id: string; username: string | null; display_name: string | null; is_active: boolean }>;
  /** `publicBaseUrl(workspace)`: el dominio del negocio o el principal. */
  base: string;
}

/**
 * Los eventos que se pueden abrir con su link: activos y ocultos (un oculto no aparece en la página pública pero abre
 * con el link directo; para eso existe). Fuera: los inactivos y los de un perfil apagado o sin usuario (su link da 404).
 * Los internos y los borrados ya los saca `listEventTypes`. Con más de una persona atendiendo, cada uno dice quién.
 */
export function buildEventDestinations(input: EventDestinationInput): PieceLinkDestination[] {
  const profiles = new Map(input.profiles.map((p) => [p.user_id, p]));
  const open = input.events
    .filter((e) => e.status === "active" || e.status === "hidden")
    .map((e) => ({ event: e, profile: profiles.get(e.owner_user_id) }))
    .filter((x): x is { event: (typeof input.events)[number]; profile: EventDestinationInput["profiles"][number] } =>
      Boolean(x.profile?.is_active && x.profile.username?.trim()),
    );
  const severalHosts = new Set(open.map((x) => x.event.owner_user_id)).size > 1;

  return open.map(({ event, profile }) => {
    const parts = [event.title.trim() || "Evento sin nombre"];
    if (severalHosts) parts.push(profile.display_name?.trim() || profile.username!.trim());
    if (event.status === "hidden") parts.push("oculto");
    return {
      kind: "event",
      id: event.id,
      label: parts.join(" · "),
      url: eventPublicUrl(input.base, profile.username!.trim(), event.slug),
    };
  });
}

/** El destino elegido, o null si es «Otro link» (o si el elegido ya no está en la lista). */
export function selectedDestination(selected: string, destinations: PieceLinkDestinations | null): PieceLinkDestination | null {
  if (!destinations || selected === CUSTOM_DESTINATION) return null;
  return [...destinations.forms, ...destinations.events].find((d) => destinationKey(d) === selected) ?? null;
}

/** La URL con la que se arma el link: la del destino elegido, o lo que escribió la persona. */
export function destinationUrl(destination: PieceLinkDestination | null, typed: string): string {
  return destination ? destination.url : typed;
}

/** El aviso de abajo del armador, según el destino. */
export function destinationHint(destination: PieceLinkDestination | null): string {
  if (!destination) return "Es un link sin seguimiento: como no hay un contacto, solo agrega los parámetros y no registra el clic.";
  if (destination.kind === "event") return "Cuando alguien agende por este link, la reunión queda atribuida a esta pieza.";
  if (destination.noContact) {
    return "Este formulario no vincula las respuestas con contactos: la respuesta guarda los parámetros, pero no suma a esta pieza.";
  }
  return "Cuando alguien lo complete por este link, la respuesta queda atribuida a esta pieza.";
}
