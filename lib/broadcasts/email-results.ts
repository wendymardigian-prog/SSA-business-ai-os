/**
 * Los resultados de un broadcast por email (A9): las cuentas de `email_log` y lo que paso con el email de cada
 * destinatario. Con el cliente de SERVICIO, despues de `broadcasts.manage` (la RLS de `email_log` es de Owner/Admin y
 * un rol con `broadcasts.manage` tiene que ver los resultados de lo que manda), siempre filtrando por el workspace de la
 * sesion y el broadcast. Solo cuentas y fechas: ningun dato del contenido.
 *
 * Solo servidor. Nunca lanza: lo que no se puede leer queda en null.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DEFER_MESSAGES } from "@/lib/email/delivery-guard";
import { EMAIL_RESULT_FILTERS, type EmailResultCounts, type EmailResultFilter, type RecipientEmailRow } from "./email-results-view";

type Client = SupabaseClient<Database>;

const ROW_COLUMNS = "contact_id, delivered_at, opened_at, clicked_at, bounced_at, complained_at, unsubscribed_at, open_count, click_count";

function base(service: Client, workspaceId: string, broadcastId: string) {
  return service
    .from("email_log")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("related_entity_type", "broadcast")
    .eq("related_entity_id", broadcastId)
    .eq("status", "sent");
}

export async function loadBroadcastEmailResults(service: Client, workspaceId: string, broadcastId: string): Promise<EmailResultCounts | null> {
  try {
    const [sent, delivered, opened, clicked, bounced, complained, unsubscribed] = await Promise.all([
      base(service, workspaceId, broadcastId),
      base(service, workspaceId, broadcastId).not("delivered_at", "is", null),
      base(service, workspaceId, broadcastId).not("opened_at", "is", null),
      base(service, workspaceId, broadcastId).not("clicked_at", "is", null),
      base(service, workspaceId, broadcastId).not("bounced_at", "is", null),
      base(service, workspaceId, broadcastId).not("complained_at", "is", null),
      base(service, workspaceId, broadcastId).not("unsubscribed_at", "is", null),
    ]);
    const all = [sent, delivered, opened, clicked, bounced, complained, unsubscribed];
    if (all.some((r) => r.error)) return null;
    return {
      sent: sent.count ?? 0,
      delivered: delivered.count ?? 0,
      opened: opened.count ?? 0,
      clicked: clicked.count ?? 0,
      bounced: bounced.count ?? 0,
      complained: complained.count ?? 0,
      unsubscribed: unsubscribed.count ?? 0,
    };
  } catch {
    return null;
  }
}

/** Cuantos esperan el tope del dia o la pausa del marketing (pendientes con el motivo de la guardia). */
export async function countDeferredRecipients(service: Client, broadcastId: string): Promise<number | null> {
  const { count, error } = await service
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending")
    .in("error_message", Object.values(DEFER_MESSAGES));
  return error ? null : (count ?? 0);
}

/** Lo que paso con el email de cada uno de estos contactos (la pagina visible de la lista). */
export async function loadRecipientEmailRows(service: Client, workspaceId: string, broadcastId: string, contactIds: string[]): Promise<Map<string, RecipientEmailRow>> {
  const out = new Map<string, RecipientEmailRow>();
  if (contactIds.length === 0) return out;
  const { data } = await service
    .from("email_log")
    .select(ROW_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("related_entity_type", "broadcast")
    .eq("related_entity_id", broadcastId)
    .eq("status", "sent")
    .in("contact_id", contactIds);
  for (const row of (data ?? []) as Array<RecipientEmailRow & { contact_id: string | null }>) {
    if (row.contact_id) out.set(row.contact_id, row);
  }
  return out;
}

/** Los contactos cuyo email tuvo ese resultado (para el filtro `?email=`). Hasta 1000. */
export async function contactsWithEmailResult(service: Client, workspaceId: string, broadcastId: string, filter: EmailResultFilter): Promise<string[]> {
  const column = EMAIL_RESULT_FILTERS[filter].column;
  const { data } = await service
    .from("email_log")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .eq("related_entity_type", "broadcast")
    .eq("related_entity_id", broadcastId)
    .eq("status", "sent")
    .not(column, "is", null)
    .limit(1000);
  return [...new Set(((data ?? []) as Array<{ contact_id: string | null }>).map((r) => r.contact_id).filter((id): id is string => Boolean(id)))];
}
