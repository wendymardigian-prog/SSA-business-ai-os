"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { EmailStatusError, isEmailStatus, setEmailStatus } from "@/lib/email/subscription";

/**
 * Cambiar a mano el estado de email de un contacto (suscripcion a emails, E5): "Dar
 * de baja de emails" o "Volver a suscribir". Modo `admin`: alguien del equipo.
 *
 * Pide `contacts.edit` (el mismo permiso que editar el contacto y marcarlo "no
 * contactar") y que la persona VEA el contacto (se lee con su sesion: la RLS decide).
 * La escritura va con el cliente de servicio y por `set_email_status`, que aplica el
 * cambio a todos los contactos con esa direccion y deja el historial. Sacar un
 * rebote o una queja exige un motivo (lo controla tambien la base, EM002).
 */
export async function setContactEmailStatus(
  contactId: string,
  status: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("contacts.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar la suscripción a emails de este contacto." };
  if (!isEmailStatus(status) || (status !== "subscribed" && status !== "unsubscribed")) {
    return { ok: false, error: "Ese estado no se puede elegir a mano." };
  }

  const { data: contact } = await ctx.supabase
    .from("contacts")
    .select("id, email, secondary_email, email_status")
    .eq("id", contactId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!contact) return { ok: false, error: "No encontré ese contacto." };
  if (!contact.email?.trim() && !contact.secondary_email?.trim()) {
    return { ok: false, error: "Este contacto no tiene email." };
  }

  const cleanReason = (reason ?? "").trim().slice(0, 500) || null;
  if (status === "subscribed" && (contact.email_status === "bounced" || contact.email_status === "complained") && !cleanReason) {
    return { ok: false, error: "Contá por qué lo volvés a suscribir: su email rebotaba o marcó spam." };
  }

  try {
    const service = await createServiceClient();
    await setEmailStatus(service, contactId, {
      status,
      source: "admin",
      mode: "admin",
      reason: cleanReason,
      performedBy: ctx.user.id,
      address: contact.email ?? contact.secondary_email,
    });
  } catch (error) {
    if (error instanceof EmailStatusError && error.code === "EM002") {
      return { ok: false, error: "Contá por qué lo volvés a suscribir: su email rebotaba o marcó spam." };
    }
    console.error("[contacts] no pude cambiar el estado de email:", error instanceof Error ? error.message : "error");
    return { ok: false, error: "No se pudo guardar el cambio. Probá de nuevo." };
  }

  revalidatePath(`/dashboard/contacts/${contactId}`);
  return { ok: true };
}
