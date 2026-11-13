// @plantilla-quitar(servicios)
/**
 * Lee el responsable del servicio del flujo (A4, F157): el del evento o el activo o pausado más reciente del contacto.
 * Nunca lanza: si algo falla, no hay responsable y el paso usa su plan B.
 */
import { svcSchema } from "@/lib/services/db";
import { resolveServiceForFlow } from "./service-actions";

export async function serviceOwnerOf(supabase: unknown, workspaceId: string, contactId: string | null, variables: Record<string, unknown>): Promise<string | null> {
  try {
    const serviceId = await resolveServiceForFlow(supabase, workspaceId, contactId, variables, null);
    if (!serviceId) return null;
    const { data } = await svcSchema(supabase).from("services").select("owner_user_id").eq("id", serviceId).eq("workspace_id", workspaceId).maybeSingle();
    return (data as { owner_user_id?: string | null } | null)?.owner_user_id ?? null;
  } catch (error) {
    console.error("[servicios] no pude leer el responsable del servicio:", error instanceof Error ? error.message : "error");
    return null;
  }
}
