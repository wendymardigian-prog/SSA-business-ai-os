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
import {
  canSendEmailTo,
  EMAIL_SKIP_LOG_STATUS,
  type EmailCategory,
  type EmailSkipReason,
} from "@/lib/email/subscription";
import type { EmailLogStatus } from "@/lib/types/database";
import { withUnsubscribe } from "@/lib/email/unsubscribe";
import { senderFor, type ResendSenderConfig } from "@/lib/email/senders";
import { resolveBrand } from "@/lib/brand";
import { appUrl } from "@/lib/app-url";

export type EmailKind = "team_invite" | "channel_disconnected" | (string & {});

export interface SendEmailParams {
  workspaceId: string;
  to: string;
  subject: string;
  html: string;
  kind: EmailKind;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /**
   * El contacto al que se refiere el email (00135): el que lo recibe, o sobre
   * quien trata un aviso al equipo. Es lo que lo hace aparecer en el historial
   * de su ficha. Omitido en los emails del sistema (invitaciones, avisos de canal).
   */
  contactId?: string | null;
  /** Quien lo disparo. Null/omitido = el sistema. */
  createdBy?: string | null;
  /** Adjuntos en base64 (por ejemplo, un PDF). Omitido = sin adjuntos, como siempre. */
  attachments?: Array<{ filename: string; content: string }>;
  /**
   * Suscripcion a emails (E2). Todo email a un CONTACTO lleva su categoria y pasa
   * por `canSendEmailTo`: marketing no sale a una direccion dada de baja o con
   * queja; nada sale a una que rebota. Omitido = email al equipo o del sistema
   * (invitaciones, avisos, pruebas del editor), que no es de ningun contacto: no
   * se mira la suscripcion. `subscription-gate.test.ts` lista esos casos.
   */
  category?: EmailCategory;
  /** Ademas, frena si algun contacto vivo con esa direccion esta en "no contactar". */
  honorDoNotContact?: boolean;
  /** Inyeccion para tests. En produccion no se pasa. */
  deps?: {
    supabase?: SupabaseClient;
    fetchImpl?: typeof fetch;
  };
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured"; error: string }
  | { ok: false; reason: "failed"; error: string }
  /** La puerta de suscripcion lo salteo: queda en email_log con el motivo. No es un fallo. */
  | { ok: false; reason: "skipped"; skip: EmailSkipReason; error: string };


async function serviceClient(): Promise<SupabaseClient> {
  // Import diferido: lib/supabase/server arrastra next/headers, que no tiene
  // sentido en los tests ni en un import de modulo suelto.
  const { createServiceClient } = await import("@/lib/supabase/server");
  return (await createServiceClient()) as unknown as SupabaseClient;
}

/**
 * Deja constancia del intento. Un fallo aca no cambia el resultado del envio.
 * Exportado para la respuesta por email (`send-reply.ts`), que anota en el mismo lugar.
 */
export async function logEmail(
  supabase: SupabaseClient,
  params: SendEmailParams,
  row: {
    status: EmailLogStatus;
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
    contact_id: params.contactId ?? null,
    created_by: params.createdBy ?? null,
  });

  if (error) {
    console.error("[email] no pude registrar el envio:", error.message);
  }
}

/**
 * Deja anotado un email que no salio porque la persona no lo puede recibir (la
 * puerta de suscripcion, o "no contactar" en un paso que lo respeta). Nunca lanza.
 */
export async function recordSkippedEmail(
  supabase: SupabaseClient,
  params: Omit<SendEmailParams, "html" | "deps">,
  skip: EmailSkipReason,
  message: string,
): Promise<void> {
  await logEmail(supabase, params as SendEmailParams, { status: EMAIL_SKIP_LOG_STATUS[skip] as EmailLogStatus, last_error: message });
}

export async function sendTransactionalEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const supabase = params.deps?.supabase ?? (await serviceClient());

  // 0. La suscripcion: un email a un contacto, solo si la direccion lo puede recibir.
  let unsubscribeToken: string | null = null;
  if (params.category) {
    const gate = await canSendEmailTo(supabase, {
      workspaceId: params.workspaceId,
      address: params.to,
      category: params.category,
      contactId: params.contactId ?? null,
      honorDoNotContact: params.honorDoNotContact === true,
    });
    if (!gate.ok) {
      await recordSkippedEmail(supabase, params, gate.reason, gate.message);
      return { ok: false, reason: "skipped", skip: gate.reason, error: gate.message };
    }
    unsubscribeToken = gate.token;
  }

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

  // El remitente segun la categoria (E8): marketing sale del suyo si esta configurado; si no, del de importantes.
  const sender = senderFor((integration.config ?? {}) as ResendSenderConfig, params.category);
  const fromEmail = sender.email;
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
  const from = sender.name ? `${sender.name} <${fromEmail}>` : fromEmail;

  // El link de baja (E3): marketing lleva el pie y las cabeceras; un transaccional, nada (solo se resuelve el link si
  // alguien lo puso a mano). Sin categoria (un email al equipo) el cuerpo sale tal cual.
  const extras = params.category
    ? withUnsubscribe({
        html: params.html,
        category: params.category,
        token: unsubscribeToken,
        appUrl: appUrl(),
        ...(params.category === "marketing" && unsubscribeToken ? await footerBrand(supabase, params.workspaceId) : { brandName: "" }),
      })
    : { html: params.html, headers: {} };

  const result = await sendViaResend(
    apiKey,
    {
      from,
      to: params.to,
      subject: params.subject,
      html: extras.html,
      ...(Object.keys(extras.headers).length > 0 ? { headers: extras.headers } : {}),
      ...(params.attachments && params.attachments.length > 0 ? { attachments: params.attachments } : {}),
      ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
    },
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

/**
 * La marca y la direccion postal del pie de un email de marketing. Leer el workspace nunca frena un envio: sin dato,
 * la marca de la instalacion y sin direccion.
 */
export async function footerBrand(supabase: SupabaseClient, workspaceId: string): Promise<{ brandName: string; postalAddress: string | null }> {
  try {
    const { data } = await supabase
      .from("workspaces")
      .select("brand_name, brand_logo_path, brand_color, email_footer_address")
      .eq("id", workspaceId)
      .maybeSingle();
    const row = data as { brand_name?: string | null; brand_logo_path?: string | null; brand_color?: string | null; email_footer_address?: string | null } | null;
    return { brandName: resolveBrand(row).name, postalAddress: row?.email_footer_address ?? null };
  } catch {
    return { brandName: resolveBrand(null).name, postalAddress: null };
  }
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
