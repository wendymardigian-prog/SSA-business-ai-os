/**
 * La actividad mas reciente de cada contacto (00287, `contact_last_activity`): el ultimo mensaje o el ultimo toque
 * (formulario, agenda, compra cargada); si no hay ninguno, el alta.
 *
 * Con un tope diario de marketing, el orden importa: si el dia alcanza para 100, que sean los 100 mas activos (los que
 * mas probablemente abren y los que menos rebotan). La usa la cola de broadcasts al poner en cola.
 *
 * Nunca lanza: si la base no contesta, el contacto queda sin dato (sale despues, en el orden de siempre).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

const CHUNK = 1000;

export async function loadContactActivity(service: SupabaseClient<Database>, workspaceId: string, contactIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    try {
      const { data, error } = await service.rpc("contact_last_activity", {
        p_workspace_id: workspaceId,
        p_contact_ids: contactIds.slice(i, i + CHUNK),
      });
      if (error) {
        console.error("[activity] no pude leer la actividad de los contactos:", error.message);
        continue;
      }
      for (const row of (data ?? []) as { contact_id: string; activity_at: string | null }[]) {
        if (row.activity_at) out.set(row.contact_id, row.activity_at);
      }
    } catch (err) {
      console.error("[activity] no pude leer la actividad de los contactos:", err instanceof Error ? err.message : "error");
    }
  }
  return out;
}
