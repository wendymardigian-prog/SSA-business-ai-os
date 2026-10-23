/**
 * El aviso de una llamada de WhatsApp que nadie atendio (00258).
 *
 * A quien: el responsable del chat; si no hay, el setter del contacto; si no,
 * el vendedor; si no, Owner/Admin (sin destinatario). Una sola vez por
 * conversacion cada 10 minutos sin leer: tres llamadas seguidas son un aviso.
 * Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotificationOnce } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/** Puro: a quien va el aviso. */
export function missedCallRecipient(args: { assignedTo: string | null; setterId: string | null; vendedorId: string | null }): string | null {
  return args.assignedTo ?? args.setterId ?? args.vendedorId ?? null;
}

export async function notifyMissedCall(
  service: Db,
  args: { workspaceId: string; conversationId: string; contactId: string; label: string },
): Promise<void> {
  try {
    const [{ data: conversation }, { data: contact }] = await Promise.all([
      service.from("conversations").select("assigned_to").eq("id", args.conversationId).maybeSingle(),
      service.from("contacts").select("display_name, setter_id, vendedor_id").eq("id", args.contactId).maybeSingle(),
    ]);
    const recipientId = missedCallRecipient({
      assignedTo: conversation?.assigned_to ?? null,
      setterId: contact?.setter_id ?? null,
      vendedorId: contact?.vendedor_id ?? null,
    });
    const name = contact?.display_name?.trim() || "Un contacto";
    await createNotificationOnce({
      supabase: service,
      workspaceId: args.workspaceId,
      type: "whatsapp_call_missed",
      title: `${name}: ${args.label.toLowerCase()}`,
      body: "Te llamó por WhatsApp y nadie atendió. Escribile o devolvele la llamada desde el celular.",
      entityType: "conversation",
      entityId: args.conversationId,
      recipientId,
      withinMinutes: 10,
    });
  } catch (err) {
    console.error("[llamadas] no pude avisar la llamada perdida:", err instanceof Error ? err.message : String(err));
  }
}
