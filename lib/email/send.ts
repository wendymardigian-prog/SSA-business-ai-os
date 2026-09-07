/**
 * Envio de emails transaccionales — la unica puerta de salida.
 *
 * Todo lo que manda un email pasa por aca (invitaciones, avisos de canal, y
 * en Fase 2 las secuencias). Reglas de esta funcion:
 *
 * 1. NUNCA lanza. Un email que falla no puede tumbar la operacion que lo
 *    genero: si no se puede invitar por email, la invitacion igual se creo.
 * 2. Si Resend no esta conectado, devuelve `reason: "not_configured"` y lo
 *    deja anotado en email_log como 'skipped_not_configured'. Ese es el estado
 *    normal del sistema hasta que se pegue la API key en
 *    /dashboard/settings/integrations.
 * 3. La API key sale de Vault y se lee con el SERVICE client, no con la sesion
 *    del usuario: read_secret solo lo aceptan Owner/Admin o service_role, y
 *    hay envios disparados por un Member (invitar no, pero avisos si) o por un
 *    cron sin usuario logueado.
 * 4. La key no se loguea, no se devuelve y no entra en email_log.
 *
 * Solo servidor. Nunca importar esto desde un Client Component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { sendViaResend } from "@/lib/email/resend-client";
import { getProvider } from "@/lib/integrations/providers";

export type EmailKind = "team_invite" | "channel_disconnected" | (string & {});

export interface SendEmailParams {
  workspaceId: string;
  to: string;
  subject: string;
  html: string;
  kind: EmailKind;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /** Quien lo disparo. Null/omitido = el sistema. */
  createdBy?: string | null;
  /** Inyeccion para tests. En produccion no se pasa. */
  deps?: {
    supabase?: SupabaseClient;
    fetchImpl?: typeof fetch;
  };
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured"; error: string }
  | { ok: false; reason: "failed"; error: string };

/** Config del remitente guardada en integration_configs.config. */
interface ResendConfig {
  from_email?: string;
  from_name?: string;
}

async function serviceClient(): Promise<SupabaseClient> {
  // Import diferido: lib/supabase/server arrastra next/headers, que no tiene
  // sentido en los tests ni en un import de modulo suelto.
  const { createServiceClient } = await import("@/lib/supabase/server");
  return (await createServiceClient()) as unknown as SupabaseClient;
}

/** Deja constancia del intento. Un fallo aca no cambia el resultado del envio. */
async function logEmail(
  supabase: SupabaseClient,
  params: SendEmailParams,
  row: {
    status: "sent" | "failed" | "skipped_not_configured";
    provider_message_id?: string | null;
    attempts?: number;
    last_error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("email_log").insert({
    workspace_id: params.workspaceId,
    to_email: params.to,
    subject: params.subject,
    kind: params.kind,
    status: row.status,
    provider_message_id: row.provider_message_id ?? null,
    attempts: row.attempts ?? 0,
    last_error: row.last_error ?? null,
    related_entity_type: params.relatedEntityType ?? null,
    related_entity_id: params.relatedEntityId ?? null,
    created_by: params.createdBy ?? null,
  });

  if (error) {
    console.error("[email] no pude registrar el envio:", error.message);
  }
}

export async function sendTransactionalEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const supabase = params.deps?.supabase ?? (await serviceClient());

  // 1. Esta conectado Resend?
  const { data: integration, error: integrationError } = await supabase
    .from("integration_configs")
    .select("config, is_active, vault_secret_name")
    .eq("workspace_id", params.workspaceId)
    .eq("type", "email_provider")
    .eq("provider", "resend")
    .maybeSingle();

  if (integrationError) {
    console.error("[email] no pude leer la config de email:", integrationError.message);
  }

  const notConfigured = async (reason: string): Promise<SendEmailResult> => {
    await logEmail(supabase, params, { status: "skipped_not_configured", last_error: reason });
    return { ok: false, reason: "not_configured", error: reason };
  };

  if (!integration || !integration.is_active) {
    return notConfigured("Resend no esta conectado");
  }

  const config = (integration.config ?? {}) as ResendConfig;
  const fromEmail = config.from_email?.trim();
  if (!fromEmail) {
    return notConfigured("Falta configurar el remitente de Resend");
  }

  // 2. La key, de Vault.
  const secretName =
    integration.vault_secret_name ??
    getProvider("resend")?.secretName ??
    SECRET_NAMES.resendApiKey;

  let apiKey: string | null = null;
  try {
    apiKey = await readSecret(supabase, params.workspaceId, secretName);
  } catch (err) {
    // readSecret lanza ante falta de permisos. Con el service client no
    // deberia pasar, pero si pasa se trata como no configurado en vez de
    // romper la operacion que pidio el envio.
    console.error(
      "[email] no pude leer la API key de Resend:",
      err instanceof Error ? err.message : String(err),
    );
    return notConfigured("No se pudo leer la API key de Resend");
  }

  if (!apiKey) {
    return notConfigured("Resend figura conectado pero no hay API key guardada");
  }

  // 3. Enviar.
  const from = config.from_name?.trim()
    ? `${config.from_name.trim()} <${fromEmail}>`
    : fromEmail;

  const result = await sendViaResend(
    apiKey,
    { from, to: params.to, subject: params.subject, html: params.html },
    params.deps?.fetchImpl,
  );

  if (result.ok) {
    await logEmail(supabase, params, {
      status: "sent",
      provider_message_id: result.id,
      attempts: result.attempts,
    });
    return { ok: true, id: result.id };
  }

  console.error(`[email] envio "${params.kind}" fallido:`, result.error);
  await logEmail(supabase, params, {
    status: "failed",
    attempts: result.attempts,
    last_error: result.error,
  });
  return { ok: false, reason: "failed", error: result.error };
}

/** True si el workspace tiene Resend conectado. Para pintar estados en la UI. */
export async function isEmailConfigured(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("integration_configs")
    .select("is_active")
    .eq("workspace_id", workspaceId)
    .eq("type", "email_provider")
    .eq("provider", "resend")
    .maybeSingle();

  return data?.is_active === true;
}
