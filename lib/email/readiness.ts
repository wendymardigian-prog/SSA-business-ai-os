/**
 * ¿Van a salir los correos del sistema? Para avisar ANTES de que un correo importante no llegue. SOLO servidor el lector; la regla (`describeEmailReadiness`) es pura.
 *
 * Mira lo mismo que mira `sendTransactionalEmail` para decidir si manda (Resend conectado y con remitente) y, además,
 * el ÚLTIMO intento de envío: si Resend lo rechazó por algo que no se arregla solo (un dominio sin verificar, una clave
 * revocada), cada correo siguiente va a fallar igual. Nunca muestra direcciones ni la clave.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailReadiness = { ok: true } | { ok: false; reason: "not_connected" | "no_sender" | "rejected"; message: string };

export interface ReadinessInput {
  integration: { is_active: boolean; from_email?: string | null } | null;
  /** El último envío registrado en `email_log` (cualquier tipo). */
  lastLog: { status: string; last_error: string | null } | null;
}

export function describeEmailReadiness(input: ReadinessInput): EmailReadiness {
  if (!input.integration || !input.integration.is_active) {
    return { ok: false, reason: "not_connected", message: "Resend no está conectado: los correos (como la copia firmada) no se mandan. Conectalo en Ajustes → Integraciones." };
  }
  if (!input.integration.from_email?.trim()) {
    return { ok: false, reason: "no_sender", message: "Falta el remitente de Resend: los correos no se mandan. Completalo en Ajustes → Integraciones." };
  }
  const log = input.lastLog;
  if (log?.status === "failed" && log.last_error) {
    const status = Number(/Resend respondio (\d{3})/.exec(log.last_error)?.[1] ?? 0);
    // Un 429 o un 5xx pasan solos; un 4xx no.
    if (status >= 400 && status < 500 && status !== 429) {
      const domain = /The ([a-z0-9.-]+\.[a-z]{2,}) domain is not verified/i.exec(log.last_error)?.[1];
      if (domain) {
        return {
          ok: false,
          reason: "rejected",
          message: `Resend está rechazando los correos: el dominio ${domain} no está verificado. Verificalo en resend.com → Domains (cargando los registros DNS que te da) y la copia firmada va a salir.`,
        };
      }
      if (status === 401 || status === 403) {
        return { ok: false, reason: "rejected", message: "Resend está rechazando los correos (la clave o el remitente no sirven). Revisá la conexión en Ajustes → Integraciones." };
      }
    }
  }
  return { ok: true };
}

export async function loadEmailReadiness(service: SupabaseClient, workspaceId: string): Promise<EmailReadiness> {
  try {
    const [{ data: integration }, { data: lastLog }] = await Promise.all([
      service.from("integration_configs").select("is_active, config").eq("workspace_id", workspaceId).eq("type", "email_provider").eq("provider", "resend").maybeSingle(),
      service.from("email_log").select("status, last_error").eq("workspace_id", workspaceId).neq("status", "skipped_not_configured").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const row = integration as { is_active: boolean; config: { from_email?: string } | null } | null;
    return describeEmailReadiness({
      integration: row ? { is_active: row.is_active, from_email: row.config?.from_email ?? null } : null,
      lastLog: (lastLog as ReadinessInput["lastLog"]) ?? null,
    });
  } catch {
    // Sin poder mirar, no se asusta a nadie.
    return { ok: true };
  }
}
