/**
 * Que le llega al invitado cuando se agenda a mano: lo que el modal le muestra a
 * quien agenda, para que no tenga que adivinarlo.
 *
 * Usa los MISMOS filtros que deciden si un flujo corre (`matchesCommonFilters`):
 * si esta linea dice que sale el email, es porque el disparador lo va a tomar.
 *
 * Puro: sin React ni base.
 */

import { matchesCommonFilters, type BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";

export const NO_EVENT_FLOWS_PATH = "/dashboard/agenda/configuracion/sin-evento";

/** Donde se prende la confirmacion de un evento, o la de las reuniones sin evento. */
export function confirmationSettingsPath(eventTypeId: string | null): string {
  return eventTypeId ? `/dashboard/agenda/configuracion/eventos/${eventTypeId}?seccion=flows` : NO_EVENT_FLOWS_PATH;
}

export interface ManualBookingTarget {
  eventTypeId: string | null;
  hostUserId: string;
  /** El area elegida o la del evento: un flujo puede filtrar por ella. */
  categoryId: string | null;
}

/** Si algun flujo de "Se agendó una reunión" prendido corre para esta reunion. */
export function hasActiveConfirmation(configs: BookingTriggerConfig[], target: ManualBookingTarget): boolean {
  return configs.some((config) =>
    matchesCommonFilters(config, {
      event_type_id: target.eventTypeId ?? "",
      host_user_id: target.hostUserId,
      origin: "manual",
      status: "scheduled",
      category_snapshot: { area_id: target.categoryId, type_id: target.categoryId },
      metadata: target.eventTypeId ? {} : { without_event: true },
    }),
  );
}

export interface GuestNotice {
  google: boolean;
  email: "on" | "off" | "no_address";
  /** La frase de arriba. */
  summary: string;
}

export function guestNotice(input: {
  /** Quien atiende tiene un calendario donde crear el evento: Google manda la invitacion. */
  googleAvailable: boolean;
  confirmationOn: boolean;
  /** El invitado tiene email. Sin email no le llega ni la invitacion ni la confirmacion. */
  hasEmail: boolean;
}): GuestNotice {
  if (!input.hasEmail) {
    return { google: false, email: "no_address", summary: "Este invitado no tiene email: no le va a llegar ninguna confirmación." };
  }
  const google = input.googleAvailable;
  const email = input.confirmationOn ? "on" : "off";
  const summary =
    google && input.confirmationOn
      ? "Al invitado le llega la invitación de Google Calendar y el email de confirmación."
      : google
        ? "Al invitado le llega la invitación de Google Calendar."
        : input.confirmationOn
          ? "Al invitado le llega el email de confirmación."
          : "Al invitado no le va a llegar ningún aviso.";
  return { google, email, summary };
}
