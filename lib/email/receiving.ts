/**
 * Traer el contenido completo de un correo recibido (F63).
 *
 * El webhook de Resend avisa que llego un correo, pero no manda el cuerpo
 * ni los adjuntos: hay que pedirlos. Es una llamada mas, y por eso el
 * receptor contesta 200 antes de hacerla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import type { InboundEmail } from "./inbound";

type Db = SupabaseClient<Database>;

const RECEIVING_ENDPOINT = "https://api.resend.com/emails/receiving";

interface ReceivedPayload {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  created_at?: string;
  headers?: Record<string, string> | Array<{ name?: string; value?: string }>;
  attachments?: Array<{
    filename?: string;
    content_type?: string;
    url?: string;
    size?: number;
  }>;
}

/** Las cabeceras, vengan como objeto o como lista de pares. */
export function normalizeHeaders(
  headers: ReceivedPayload["headers"],
): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const entry of headers) {
      if (entry?.name && typeof entry.value === "string") out[entry.name.toLowerCase()] = entry.value;
    }
    return out;
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

/** El payload de Resend a nuestra forma. */
export function toInboundEmail(payload: ReceivedPayload, fallbackId: string): InboundEmail {
  const headers = normalizeHeaders(payload.headers);

  return {
    emailId: payload.id ?? fallbackId,
    from: payload.from ?? headers.from ?? "",
    to: payload.to ?? [],
    cc: payload.cc ?? [],
    subject: payload.subject ?? headers.subject ?? null,
    text: payload.text ?? null,
    html: payload.html ?? null,
    messageId: headers["message-id"] ?? null,
    inReplyTo: headers["in-reply-to"] ?? null,
    references: headers.references ?? null,
    receivedAt: payload.created_at ?? new Date().toISOString(),
    headers,
    attachments: (payload.attachments ?? [])
      .filter((a) => a.filename)
      .map((a) => ({
        filename: a.filename as string,
        contentType: a.content_type ?? "application/octet-stream",
        url: a.url,
        size: a.size,
      })),
  };
}

/**
 * Pide el correo completo.
 *
 * Devuelve null si no se puede: quien llama se queda con lo que trajo el
 * evento, que es menos pero es mejor que perder el correo.
 */
export async function fetchReceivedEmail(
  supabase: Db,
  params: { workspaceId: string; emailId: string; fetchImpl?: typeof fetch },
): Promise<InboundEmail | null> {
  let apiKey: string | null = null;
  try {
    apiKey = await readSecret(supabase, params.workspaceId, SECRET_NAMES.resendApiKey);
  } catch (err) {
    console.error("[email] no pude leer la API key de Resend:", err);
    return null;
  }
  if (!apiKey) {
    console.error("[email] no hay API key de Resend guardada");
    return null;
  }

  try {
    const response = await (params.fetchImpl ?? fetch)(
      `${RECEIVING_ENDPOINT}/${encodeURIComponent(params.emailId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      console.error(`[email] no pude traer el correo: HTTP ${response.status}`);
      return null;
    }

    return toInboundEmail((await response.json()) as ReceivedPayload, params.emailId);
  } catch (err) {
    console.error("[email] no pude traer el correo:", err);
    return null;
  }
}
