/**
 * Procesar un correo que entra (F63).
 *
 * El mismo camino que los otros canales: contacto, conversacion, mensaje,
 * opt-out, automatizaciones. Tres diferencias, todas a proposito:
 *
 * 1. **Los adjuntos se copian a nuestro Storage antes de guardar nada.** Los
 *    links que da Resend vencen, y un adjunto que no se puede abrir tres
 *    dias despues es un adjunto perdido.
 * 2. **Un correo automatico se guarda pero no crea contacto ni dispara
 *    nada.** Un rebote es informacion util; tratarlo como un lead es crear
 *    una persona que no existe.
 * 3. **NO se agenda un turno del agente.** El agente esta pensado para
 *    chat: contesta corto y rapido. Un email contestado como un DM se lee
 *    mal, y ademas nadie lo pidio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { upsertContactForSender } from "@/lib/inbox-sync";
import { messagePreview } from "@/lib/message-preview";
import { applyOptOut, insertMessage, upsertConversation, type ChannelRow } from "@/lib/inbound";
import { detectAutomatic } from "./auto-detect";
import { bareAddress } from "./reply";
import { ATTACHMENTS_BUCKET } from "./buckets";

type Db = SupabaseClient<Database>;

export { ATTACHMENTS_BUCKET } from "./buckets";

export interface InboundEmail {
  /** El id del correo en Resend. */
  emailId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  receivedAt: string;
  headers?: Record<string, string | undefined> | null;
  attachments?: Array<{ filename: string; contentType: string; url?: string; size?: number }>;
}

export interface StoredAttachment {
  filename: string;
  contentType: string;
  /** El path en nuestro bucket. */
  storagePath: string;
  sizeBytes: number | null;
}

export interface ProcessResult {
  stored: boolean;
  automatic: boolean;
  contactId: string | null;
  conversationId: string | null;
  attachments: number;
  /** Por que no se hizo algo, cuando no se hizo. */
  note: string | null;
}

/**
 * Copia los adjuntos a nuestro bucket.
 *
 * Best-effort por adjunto: que falle uno no puede hacer que se pierda el
 * correo entero. Los que no se pudieron copiar quedan afuera y se anota.
 */
export async function storeAttachments(
  supabase: Db,
  params: {
    workspaceId: string;
    emailId: string;
    attachments: InboundEmail["attachments"];
    fetchImpl?: typeof fetch;
  },
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = [];
  const fetchImpl = params.fetchImpl ?? fetch;

  for (const [index, attachment] of (params.attachments ?? []).entries()) {
    if (!attachment.url) continue;

    try {
      const response = await fetchImpl(attachment.url);
      if (!response.ok) {
        console.error(`[email] no pude bajar el adjunto ${index}: HTTP ${response.status}`);
        continue;
      }

      const bytes = await response.arrayBuffer();
      // El primer segmento es el workspace: es lo que mira la policy del
      // bucket para decidir quien lo puede leer.
      const path = `${params.workspaceId}/${params.emailId}/${index}-${safeName(attachment.filename)}`;

      const { error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, bytes, { contentType: attachment.contentType, upsert: true });

      if (error) {
        console.error(`[email] no pude guardar el adjunto ${index}:`, error.message);
        continue;
      }

      stored.push({
        filename: attachment.filename,
        contentType: attachment.contentType,
        storagePath: path,
        sizeBytes: attachment.size ?? bytes.byteLength,
      });
    } catch (err) {
      console.error(`[email] no pude copiar el adjunto ${index}:`, err);
    }
  }

  return stored;
}

/** Un nombre de archivo que no rompe un path. */
export function safeName(filename: string): string {
  return filename
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

/**
 * El texto que se muestra en la bandeja.
 *
 * El texto plano primero; el HTML, desarmado, como ultimo recurso. Un
 * correo solo en HTML mostrado crudo es una pared de etiquetas.
 */
export function bodyText(email: Pick<InboundEmail, "text" | "html">): string {
  if (email.text?.trim()) return email.text.trim();
  if (!email.html) return "";

  return email.html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Guarda el correo: contacto, conversacion y mensaje.
 *
 * No agenda turnos del agente. A proposito y probado con un espia.
 */
export async function processInboundEmail(
  supabase: Db,
  params: {
    channel: ChannelRow;
    email: InboundEmail;
    fetchImpl?: typeof fetch;
  },
): Promise<ProcessResult> {
  const { channel, email } = params;

  const detection = detectAutomatic({
    from: email.from,
    subject: email.subject,
    raw: email.headers,
  });

  const fromAddress = bareAddress(email.from);
  if (!fromAddress) {
    return {
      stored: false,
      automatic: detection.automatic,
      contactId: null,
      conversationId: null,
      attachments: 0,
      note: "El correo no trae un remitente utilizable",
    };
  }

  // Los adjuntos van primero: los links de Resend vencen, y si se guarda el
  // mensaje y despues falla la copia, el adjunto se pierde sin registro.
  const attachments = await storeAttachments(supabase, {
    workspaceId: channel.workspace_id,
    emailId: email.emailId,
    attachments: email.attachments,
    fetchImpl: params.fetchImpl,
  });

  const text = bodyText(email);
  const preview = messagePreview(email.subject ? `${email.subject}: ${text}` : text) || "";

  // Un correo automatico no crea contacto: seria una persona que no existe.
  const contact = detection.automatic
    ? null
    : await upsertContactForSender({
        supabase,
        channel,
        senderId: fromAddress,
        senderName: displayName(email.from) ?? fromAddress,
        senderUsername: fromAddress,
        senderPicture: null,
        // El email es clave fuerte de deduplicacion, igual que el telefono:
        // si esta persona ya escribio por Instagram y alguien le cargo el
        // mail, se vincula al mismo contacto.
        senderEmail: fromAddress,
        interactionAt: email.receivedAt,
      });

  if (!detection.automatic && !contact) {
    return {
      stored: false,
      automatic: false,
      contactId: null,
      conversationId: null,
      attachments: attachments.length,
      note: "No pude resolver el contacto",
    };
  }

  // Sin contacto (automatico) no hay conversacion: un rebote no abre un
  // hilo con nadie. Se registra en el log y ahi queda.
  if (!contact) {
    console.log(`[email] correo automatico de ${fromAddress}: ${detection.reason}`);
    return {
      stored: false,
      automatic: true,
      contactId: null,
      conversationId: null,
      attachments: attachments.length,
      note: detection.reason,
    };
  }

  const conversation = await upsertConversation({
    supabase,
    channel,
    contactId: contact.contactId,
    preview,
    at: email.receivedAt,
    incrementUnread: true,
  });

  if (!conversation) {
    return {
      stored: false,
      automatic: false,
      contactId: contact.contactId,
      conversationId: null,
      attachments: attachments.length,
      note: "No pude abrir la conversacion",
    };
  }

  const stored = await insertMessage({
    supabase,
    conversationId: conversation.id,
    direction: "inbound",
    text,
    // El id de Resend es lo unico unico que llega siempre: el Message-ID
    // puede faltar en correos mal formados.
    platformMessageId: email.emailId,
    attachments: attachments.length > 0 ? { files: attachments } : null,
    createdAt: email.receivedAt,
    workspaceId: channel.workspace_id,
    email: {
      subject: email.subject,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      from: email.from,
      to: email.to,
      cc: email.cc,
    },
  });

  // Opt-out: alguien que responde "desuscribir" tiene que dejar de recibir.
  await applyOptOut({
    supabase,
    contactId: contact.contactId,
    conversationId: conversation.id,
    text,
  });

  return {
    stored,
    automatic: false,
    contactId: contact.contactId,
    conversationId: conversation.id,
    attachments: attachments.length,
    note: null,
  };
}

/** El nombre del remitente: `Ana Perez <ana@x.com>` → `Ana Perez`. */
export function displayName(from: string | null | undefined): string | null {
  if (!from) return null;
  const match = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}
