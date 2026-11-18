/**
 * Lo que necesita el modal de «Agendar una reunión» (`BookManualDialog`), armado
 * en UN lugar: la página de Agenda y el botón «Agendar llamada» de las fichas del
 * cliente y del servicio usan estas mismas funciones. Puro: recibe lo ya leído.
 */

import { categoryLabel, type CategoryRow } from "@/lib/scheduling/categories";
import { defaultManualCategory } from "@/lib/scheduling/booking/manual";
import { meetAvailableFor, type MeetContext } from "@/lib/scheduling/meet-availability";

export interface ManualEventSource {
  id: string;
  title: string;
  duration_minutes: number;
  owner_user_id: string;
  category_id: string | null;
  status: string;
  color: string | null;
  location_type: string | null;
  location_text: string | null;
  destination_calendar_id: string | null;
}

export interface ManualEventOptionData {
  id: string;
  title: string;
  durationMinutes: number;
  categoryLabel: string;
  hostName: string;
  hostUserId: string;
  categoryId: string | null;
  status: "active" | "hidden" | "inactive";
  color: string | null;
  locationType: "google_meet" | "manual";
  locationText: string | null;
  meetAvailable: boolean;
}

export interface ManualHostOption {
  userId: string;
  label: string;
  meetAvailable: boolean;
}

export interface ManualAreaOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/** El área preferida al agendar desde la ficha de un cliente o un servicio. */
export type PreferredManualArea = "servicio";

/**
 * TODOS los eventos, los inactivos también (el modal los muestra abajo): el horario es libre, no depende de que el
 * evento esté activo.
 */
export function manualEventOptions(events: ManualEventSource[], categories: CategoryRow[], names: Map<string, string>, meet: MeetContext): ManualEventOptionData[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    durationMinutes: e.duration_minutes,
    categoryLabel: categoryLabel(e.category_id, categories),
    hostName: names.get(e.owner_user_id) ?? "Sin nombre",
    hostUserId: e.owner_user_id,
    categoryId: e.category_id,
    status: e.status as "active" | "hidden" | "inactive",
    color: e.color,
    locationType: e.location_type === "google_meet" ? "google_meet" : "manual",
    locationText: e.location_text,
    meetAvailable: meetAvailableFor(meet, e.owner_user_id, e.destination_calendar_id),
  }));
}

/** Quienes pueden atender una reunión sin evento, por nombre. */
export function manualHostOptions(names: Map<string, string>, meet: MeetContext): ManualHostOption[] {
  return [...names.entries()]
    .map(([userId, label]) => ({ userId, label, meetAvailable: meetAvailableFor(meet, userId) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Las áreas vivas. La de por defecto es «Otros» (`defaultManualCategory`), salvo que se pida otra: desde las fichas
 * de Servicios es «Servicio» (por su clave estable `servicio`, o por el nombre si es de sistema). Si no está, «Otros».
 */
export function manualAreaOptions(categories: CategoryRow[], prefer?: PreferredManualArea): ManualAreaOption[] {
  const areas = categories.filter((c) => c.parent_id === null && !c.archived_at);
  const preferred = prefer === "servicio" ? areas.find((a) => a.system_key === "servicio") ?? areas.find((a) => a.is_system && a.name === "Servicio") : undefined;
  const defaultId = preferred?.id ?? defaultManualCategory(categories);
  return areas.map((c) => ({ id: c.id, name: c.name, isDefault: c.id === defaultId }));
}
