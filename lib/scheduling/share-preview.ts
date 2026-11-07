/**
 * La tarjeta de un link de agenda (ver `lib/og/share.ts`). SOLO servidor. Recibe un evento que
 * `findPublicEvent` ya dio por público: uno inactivo nunca llega acá. Si no se puede leer la
 * marca devuelve null: mejor sin tarjeta que con el logo de otro negocio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { SHARE_WORKSPACE_COLUMNS, buildShareData, type ShareData } from "@/lib/og/share";
import { eventShareText } from "@/lib/og/text";

type Tables = Database["public"]["Tables"];

export async function loadEventShare(
  service: SupabaseClient<Database>,
  { event, profile }: { event: Tables["event_types"]["Row"]; profile: Tables["scheduling_profiles"]["Row"] },
): Promise<ShareData | null> {
  try {
    const { data: workspace, error } = await service.from("workspaces").select(SHARE_WORKSPACE_COLUMNS).eq("id", event.workspace_id).maybeSingle();
    if (error || !workspace) return null;
    return buildShareData(
      workspace,
      `/calendario/${encodeURIComponent(profile.username)}/${encodeURIComponent(event.slug)}`,
      eventShareText({ title: event.title, hostName: profile.display_name, durationMinutes: event.duration_minutes, description: event.description_md }),
    );
  } catch (error) {
    console.error("[vista previa] no pude leer la marca del evento:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
