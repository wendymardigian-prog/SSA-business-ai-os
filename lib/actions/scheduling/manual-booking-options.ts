"use server";

/**
 * «Agendar llamada» desde la ficha del cliente o del servicio: lo que necesita el modal de agendar a mano, pedido
 * recién al tocar el botón (abrir la ficha no paga estas consultas). Mismo permiso que agendar (`bookings.manage`).
 * El contacto se lee con la SESIÓN: si quien agenda no lo ve, no se abre.
 */

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadManualBookingOptions, type ManualBookingOptions } from "@/lib/scheduling/data/manual-options";

export async function loadManualBookingForContact(
  contactId: string,
): Promise<
  | {
      ok: true;
      data: ManualBookingOptions & {
        timezone: string;
        currentUserId: string;
        contact: { id: string; name: string; detail: string; timezone: string | null; email: string | null; phone: string | null };
      };
    }
  | { ok: false; error: string }
> {
  const ctx = await getPermissionAction("bookings.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para agendar." };
  if (typeof contactId !== "string" || !/^[0-9a-f-]{36}$/i.test(contactId)) return { ok: false, error: "No encontré ese contacto." };

  try {
    const service = await createServiceClient();
    const [{ data: c }, options, timezone] = await Promise.all([
      ctx.supabase
        .from("contacts")
        .select("id, display_name, email, phone, timezone")
        .eq("id", contactId)
        .eq("workspace_id", ctx.workspace.id)
        .is("deleted_at", null)
        .maybeSingle(),
      loadManualBookingOptions(ctx.supabase, service, ctx.workspace.id, "servicio"),
      resolveViewerTimezone((ctx.workspace as { timezone?: string }).timezone),
    ]);
    if (!c) return { ok: false, error: "No encontré ese contacto." };
    return {
      ok: true,
      data: {
        ...options,
        timezone,
        currentUserId: ctx.user.id,
        contact: {
          id: c.id,
          name: c.display_name ?? "Sin nombre",
          detail: [c.email, c.phone].filter(Boolean).join(" · ") || "Sin datos de contacto",
          timezone: c.timezone,
          email: c.email,
          phone: c.phone,
        },
      },
    };
  } catch (err) {
    console.error("[loadManualBookingForContact] no pude cargar el modal", err instanceof Error ? err.message : "error");
    return { ok: false, error: "No pude abrir la agenda. Probá de nuevo en un momento." };
  }
}
