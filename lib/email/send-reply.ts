/**
 * Enviar una respuesta por email (F65).
 *
 * La rama `resend` que comparten los dos lugares que mandan mensajes: el
 * motor de flows y la bandeja. Esta aca y no duplicada en los dos porque
 * armar mal el hilo en uno de los dos caminos daria conversaciones rotas
 * segun de donde salio la respuesta.
 *
 * Lo que hace, en orden: busca el ultimo entrante del hilo, arma las tres
 * cabeceras, manda por Resend y devuelve el Message-ID para guardarlo. Ese
 * ultimo paso es el que permite que la proxima respuesta siga el hilo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { sendViaResend } from "./resend-client";
import { bareAddress, canReply, replyHeaders, textToHtml } from "./reply";

type Db = SupabaseClient<Database>;

export interface EmailSendResult {
  ok: boolean;
  /** El Message-ID que se mando, para guardarlo en el saliente. */
  messageId: string | null;
  /** El id de Resend. */
  providerId: string | null;
  error?: string;
  /** Reintentar tiene sentido. */
  retryable?: boolean;
}

/** El ultimo correo entrante del hilo: de ahi salen las cabeceras. */
export async function lastInboundEmail(
  supabase: Db,
  conversationId: string,
): Promise<{ subject: string | null; messageId: string | null; references: string | null; from: string | null } | null> {
  const { data } = await supabase
    .from("messages")
    .select("email_subject, email_message_id, email_references, email_from")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .not("email_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    subject: data.email_subject,
    messageId: data.email_message_id,
    references: data.email_references,
    from: data.email_from,
  };
}

/**
 * Responde el hilo.
 *
 * Si no hay entrante previo (alguien escribe primero desde la bandeja), se
 * manda igual sin `In-Reply-To`: es un correo nuevo, y eso es correcto.
 */
export async function sendEmailReply(
  supabase: Db,
  params: {
    workspaceId: string;
    conversationId: string;
    channel: { platform: string; is_active: boolean; email_address: string | null };
    toAddress: string | null;
    text: string;
    contactOptedOut: boolean;
    /** Sobrescribe el asunto. Sin esto, se deriva del hilo. */
    subject?: string | null;
    fetchImpl?: typeof fetch;
    /**
     * Cliente con el que se lee la key de Resend. Por defecto `supabase`. La
     * bandeja, que manda con el cliente del usuario, pasa el de servicio:
     * desde la 00143 `read_secret` solo la ejecuta el servidor.
     */
    secrets?: Db;
  },
): Promise<EmailSendResult> {
  const last = await lastInboundEmail(supabase, params.conversationId);
  const to = params.toAddress ?? bareAddress(last?.from);

  const check = canReply({
    channelPlatform: params.channel.platform,
    channelActive: params.channel.is_active,
    contactOptedOut: params.contactOptedOut,
    toAddress: to,
  });
  if (!check.ok) {
    return { ok: false, messageId: null, providerId: null, error: check.error, retryable: false };
  }

  if (!params.channel.email_address) {
    return {
      ok: false,
      messageId: null,
      providerId: null,
      error: "El canal de email no tiene direccion configurada",
      retryable: false,
    };
  }

  const apiKey = await readSecret(params.secrets ?? supabase, params.workspaceId, SECRET_NAMES.resendApiKey);
  if (!apiKey) {
    return {
      ok: false,
      messageId: null,
      providerId: null,
      error: "Falta la API key de Resend. Cargala en Ajustes → Integraciones.",
      retryable: false,
    };
  }

  const headers = last
    ? replyHeaders(last)
    : { subject: params.subject?.trim() || "(sin asunto)", inReplyTo: null, references: null };

  const result = await sendViaResend(
    apiKey,
    {
      from: params.channel.email_address,
      to: to as string,
      subject: params.subject?.trim() || headers.subject,
      html: textToHtml(params.text),
      headers: {
        ...(headers.inReplyTo ? { "In-Reply-To": headers.inReplyTo } : {}),
        ...(headers.references ? { References: headers.references } : {}),
      },
    },
    params.fetchImpl,
  );

  if (!result.ok) {
    return {
      ok: false,
      messageId: null,
      providerId: null,
      error: result.error,
      // Resend ya reintento por su cuenta: si llego hasta aca, el problema
      // dura mas que tres intentos seguidos.
      retryable: true,
    };
  }

  // El aviso de cuota va despues de mandar y nunca frena nada: el objetivo
  // es que alguien se entere ANTES de quedarse sin, no bloquear el email que
  // esta saliendo bien (F66).
  void warnIfNearQuota(supabase, params.workspaceId).catch((err) => {
    console.error("[email] no pude revisar la cuota:", err);
  });

  return {
    ok: true,
    // Resend devuelve su id; el Message-ID real lo pone su servidor. Se
    // guarda el de Resend, que es con lo que se puede consultar despues.
    messageId: result.id,
    providerId: result.id,
  };
}

/**
 * Avisa si la cuota del dia se esta acabando (F66).
 *
 * Una vez por dia, con la ventana de `integration_attention`. Quedarse sin
 * cuota un martes a la tarde significa que las respuestas de la tarde no
 * salen; con este aviso se ve venir.
 */
export async function warnIfNearQuota(supabase: Db, workspaceId: string): Promise<boolean> {
  const { countEmailsToday } = await import("@/lib/integrations/usage-counts");
  const { computeQuota } = await import("./quota");
  const { notifyIntegrationAttention } = await import("@/lib/notifications/integration-alerts");

  const { data: config } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("type", "email_provider")
    .eq("provider", "resend_inbound")
    .maybeSingle();

  const quota = (config?.config as { daily_quota?: number } | null)?.daily_quota ?? null;
  const used = await countEmailsToday(supabase, workspaceId);
  const usage = computeQuota({ sentToday: used, receivedToday: 0, quota });

  if (!usage.shouldWarn) return false;

  return notifyIntegrationAttention({
    supabase,
    workspaceId,
    providerId: "resend_inbound",
    providerLabel: "Resend (email entrante)",
    cause: "quota",
    detail: usage.label,
  });
}
