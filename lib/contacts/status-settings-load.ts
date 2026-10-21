/**
 * Las listas de estados del workspace, para las pantallas del servidor (la
 * ficha, la lista de contactos). Solo de servidor: usa el cliente de servicio
 * filtrado por el workspace de la sesión (que pasa quien llama). Las listas no
 * son un secreto: cualquier miembro las ve en la ficha.
 *
 * Nunca lanza: ante un error, los estados por defecto (la pantalla se dibuja
 * igual y el cambio lo valida la base).
 */
import { createServiceClient } from "@/lib/supabase/server";
import { parseStatusSettings, type ContactStatusSettings } from "./statuses";

export async function loadContactStatusSettings(workspaceId: string): Promise<ContactStatusSettings> {
  try {
    const service = await createServiceClient();
    const { data, error } = await service
      .from("workspaces")
      .select("contact_status_settings")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) console.error("[contact-status] no pude leer los estados:", error.message);
    return parseStatusSettings((data as { contact_status_settings?: unknown } | null)?.contact_status_settings);
  } catch (err) {
    console.error("[contact-status] no pude leer los estados:", err instanceof Error ? err.message : err);
    return parseStatusSettings(null);
  }
}
