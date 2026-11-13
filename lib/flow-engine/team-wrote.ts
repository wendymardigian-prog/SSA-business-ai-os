/**
 * «¿Alguien del equipo ya le escribió por WhatsApp?» — para la opción «No mandar si ya le escribiste» de un paso de
 * WhatsApp (por ejemplo, el WhatsApp de bienvenida después de agendar: si la dueña ya le escribió desde el teléfono, el
 * automático sobra).
 *
 * Cuenta solo lo que escribió una PERSONA del equipo, en cualquier conversación de WhatsApp del contacto:
 *   - `external`: salió desde el teléfono (la app de WhatsApp), fuera del sistema.
 *   - `user`: salió desde la bandeja, escrito por alguien del equipo.
 * No cuentan las automatizaciones (`flow`), las difusiones (`broadcast`) ni el agente de IA (`agent`).
 *
 * «Desde» es el arranque de la ejecución (por ejemplo, el momento en que agendó). Con `hoursBefore` también cuenta lo
 * que se le escribió en las horas previas (le pasaste el link por WhatsApp y agendó al rato). Lo de antes no frena.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const TEAM_ORIGINS = ["external", "user"] as const;

/**
 * Las formas en que se puede haber guardado el mismo número. WhatsApp y los formularios a veces lo escriben distinto:
 *   - México: +52 55… y +521 55… (el «1» del celular viejo).
 *   - Argentina: +54 11… y +549 11… (el «9» del celular).
 * Pasó el 13/11/2026: la agenda guardó el número con +52 y el WhatsApp con +521, dos contactos para la misma persona.
 */
export function phoneVariants(phone: string | null | undefined): string[] {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return [];
  const out = new Set<string>([`+${digits}`]);
  const pairs: Array<[string, string]> = [["52", "521"], ["54", "549"]];
  for (const [short, long] of pairs) {
    if (digits.startsWith(long) && digits.length === long.length + 10) out.add(`+${short}${digits.slice(long.length)}`);
    else if (digits.startsWith(short) && !digits.startsWith(long) && digits.length === short.length + 10) out.add(`+${long}${digits.slice(short.length)}`);
  }
  return [...out];
}

/**
 * true si alguien del equipo le escribió por WhatsApp desde `since`; null si no se pudo mirar.
 * Mira las conversaciones del contacto y las de cualquier contacto con el mismo número (en todas sus formas).
 */
export async function teamWroteOnWhatsAppSince(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; contactId?: string | null; phone?: string | null; since: string }
): Promise<boolean | null> {
  const contactIds = new Set<string>();
  if (args.contactId) contactIds.add(args.contactId);

  const variants = phoneVariants(args.phone);
  if (variants.length > 0) {
    // Solo «+» y dígitos (salen de phoneVariants), así que van tal cual en el filtro.
    const anyOf = variants.flatMap((v) => [`phone.eq.${v}`, `whatsapp_phone.eq.${v}`]).join(",");
    const { data: sameNumber, error: phoneError } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", args.workspaceId)
      .or(anyOf);
    if (phoneError) return null;
    for (const c of sameNumber ?? []) contactIds.add(c.id);
  }
  if (contactIds.size === 0) return false;

  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .in("contact_id", [...contactIds])
    .eq("platform", "whatsapp");
  if (convError) return null;
  const ids = (conversations ?? []).map((c) => c.id);
  if (ids.length === 0) return false;

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id")
    .in("conversation_id", ids)
    .eq("direction", "outbound")
    .in("origin", [...TEAM_ORIGINS])
    .gte("created_at", args.since)
    .limit(1);
  if (error) return null;
  return (messages ?? []).length > 0;
}

/** Tope de «horas antes» que se puede poner en el paso (una semana). */
export const MAX_HOURS_BEFORE = 168;

/** Las horas antes, saneadas: un número entre 0 y MAX_HOURS_BEFORE; cualquier otra cosa es 0. */
export function normalizeHoursBefore(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_HOURS_BEFORE);
}

/** Desde cuándo mirar: el arranque menos las horas antes. */
export function lookbackFrom(startedAt: string, hoursBefore: unknown): string {
  const hours = normalizeHoursBefore(hoursBefore);
  if (hours === 0) return startedAt;
  return new Date(new Date(startedAt).getTime() - hours * 3_600_000).toISOString();
}

/** Cuándo arrancó la ejecución, o null si no se sabe (el simulador no tiene sesión). */
export async function sessionStartedAt(supabase: SupabaseClient<Database>, sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  const { data } = await supabase.from("flow_sessions").select("created_at").eq("id", sessionId).maybeSingle();
  return data?.created_at ?? null;
}
