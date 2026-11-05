/**
 * Antes de escribirle por primera vez a un número: ¿tiene WhatsApp?
 *
 * Va aparte de `dispatch.ts`, que no habla con el proveedor (`dispatch.test.ts`
 * lo fija): el mensaje sale siempre por `sendChannelMessage`. Esto no manda nada.
 *
 * Nunca lanza. Un error o una respuesta que no se entiende es `error` (la cola
 * reintenta), nunca `no_whatsapp`: no se saltea a nadie por una duda.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { checkWhatsappNumber, EvolutionError } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { jidToPhone } from "@/lib/phone";

export type WhatsappTarget =
  /** `target` es el número en la forma que usa WhatsApp, para que su respuesta caiga en el mismo chat. */
  | { kind: "ok"; target: string }
  | { kind: "no_whatsapp" }
  | { kind: "not_configured" }
  | { kind: "error" };

export async function resolveWhatsappTarget(
  service: SupabaseClient<Database>,
  workspaceId: string,
  instance: string | null,
  phone: string,
): Promise<WhatsappTarget> {
  try {
    const config = await getEvolutionConfig(service, workspaceId);
    if (!config || !instance) return { kind: "not_configured" };
    const check = await checkWhatsappNumber(config, instance, phone);
    if (!check.exists) return { kind: "no_whatsapp" };
    return { kind: "ok", target: jidToPhone(check.jid) ?? phone };
  } catch (e) {
    const detail = e instanceof EvolutionError ? (e.status ?? "sin respuesta") : "error";
    console.error("[send-queue] no pude comprobar un número de WhatsApp:", detail);
    return { kind: "error" };
  }
}
