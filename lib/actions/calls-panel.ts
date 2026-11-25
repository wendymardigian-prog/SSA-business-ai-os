"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { loadCallDetail, type LoadedCallDetail } from "@/lib/calls/load-detail";

/**
 * El detalle de una grabación, pedido APARTE de la lista de Grabaciones (mismo patrón que la Agenda,
 * `loadBookingDetail`).
 *
 * Abrir, cerrar, cambiar de pestaña o pasar a la anterior o la siguiente no vuelve a armar la lista en el servidor:
 * la pantalla abre el panel en el momento y le pide esto. Mismo permiso que la página (`calls.view`); la grabación se
 * lee con la sesión, así que la RLS decide si la ve, y siempre con el negocio de la sesión. null = no existe o no
 * tiene acceso.
 */
export async function loadCallPanel(callId: string): Promise<LoadedCallDetail | null> {
  const ctx = await getPermissionAction("calls.view");
  if (!ctx || typeof callId !== "string") return null;
  try {
    return await loadCallDetail(ctx, callId);
  } catch (err) {
    console.error("[llamadas] no pude cargar el panel de la grabación:", err instanceof Error ? err.message : "error");
    return null;
  }
}
