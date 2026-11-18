/**
 * Lee lo que necesita el modal de «Agendar una reunión» cuando se abre desde fuera de la Agenda (el botón
 * «Agendar llamada» de las fichas del cliente y del servicio). Solo servidor. La Agenda arma lo mismo con las
 * funciones puras de `lib/scheduling/booking/manual-options.ts`, sobre lo que ya leyó para su pantalla.
 *
 * Eventos y áreas se leen con la SESIÓN (su RLS); quién puede crear un Meet y los flujos de confirmación, con el
 * cliente de SERVICIO (igual que la Agenda: un rol sin permiso sobre automatizaciones también tiene que saberlo).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";
import { listCategories, listEventTypes, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { hostNames } from "@/lib/scheduling/data/bookings";
import { loadMeetContext } from "@/lib/scheduling/data/meet-availability";
import {
  manualAreaOptions,
  manualEventOptions,
  manualHostOptions,
  type ManualAreaOption,
  type ManualEventOptionData,
  type ManualHostOption,
  type PreferredManualArea,
} from "@/lib/scheduling/booking/manual-options";

type Db = SupabaseClient<Database>;

export interface ManualBookingOptions {
  events: ManualEventOptionData[];
  hosts: ManualHostOption[];
  areas: ManualAreaOption[];
  confirmationConfigs: BookingTriggerConfig[];
}

/** Los flujos de «Se agendó una reunión» prendidos: el modal dice si sale el email de confirmación. */
export async function loadConfirmationConfigs(service: Db, workspaceId: string): Promise<BookingTriggerConfig[]> {
  const { data } = await service
    .from("triggers")
    .select("config, flows!inner(status)")
    .eq("workspace_id", workspaceId)
    .eq("type", "booking_created")
    .eq("is_active", true)
    .eq("flows.status", "published");
  return (data ?? []).map((t) => ((t as { config: unknown }).config ?? {}) as BookingTriggerConfig);
}

export async function loadManualBookingOptions(
  supabase: Db,
  service: Db,
  workspaceId: string,
  prefer?: PreferredManualArea,
): Promise<ManualBookingOptions> {
  const [categories, events, names, confirmationConfigs] = await Promise.all([
    listCategories(supabase, workspaceId),
    listEventTypes(supabase, workspaceId),
    hostNames(workspaceId),
    loadConfirmationConfigs(service, workspaceId),
  ]);
  const meet = await loadMeetContext(service, workspaceId, [...names.keys(), ...events.map((e) => e.owner_user_id)]);
  const rows = categories.map(toCategoryRow);
  return {
    events: manualEventOptions(events, rows, names, meet),
    hosts: manualHostOptions(names, meet),
    areas: manualAreaOptions(rows, prefer),
    confirmationConfigs,
  };
}
