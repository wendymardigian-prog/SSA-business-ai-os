import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { toInboxThread } from "@/lib/zernio-message";
import { messagePreview } from "@/lib/message-preview";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { applyManualReply } from "@/lib/agent/manual-reply";
import { mergeThreadWithLocal, platformIdsOf, type LocalMessageMedia } from "@/lib/zernio-message-merge";
import { sendChannelMessage, type SendContext, type OutboundMedia } from "@/lib/flow-engine/send";
import { CHAT_MEDIA_BUCKET, isSafeStoragePath } from "@/lib/chat-media/bucket";
import { sniffMime } from "@/lib/content/media";
import { attachmentLabel, emptyAttachment, toAttachmentsColumn, type AttachmentKind } from "@/lib/messages/attachments";
import { afterMediaStored } from "@/lib/chat-media/after-stored";
import { channelAcceptsMedia } from "@/lib/channels/media";

/**
 * Cuantos mensajes trae el hilo. Es el maximo que acepta Zernio, y alcanza
 * para cualquier conversacion real de la bandeja; si algun dia hace falta ver
 * mas atras, la API pagina por cursor.
 */
const THREAD_PAGE_SIZE = 100;

/**
 * GET /api/v1/messages?conversationId=...
 *
 * De donde sale el hilo depende del canal:
 * - Zernio (Instagram, ...): se le pide por API a Zernio, que es la fuente de
 *   verdad de la LECTURA.
 * - Evolution (WhatsApp): no hay una API equivalente donde vivan los mensajes,
 *   asi que el hilo sale de nuestra tabla messages, que llena el webhook.
 *
 * Desde la Fase 3 la tabla local ya NO queda vacia para los canales de Zernio:
 * el receptor guarda ahi una copia de cada entrante (dual-write). Pero la
 * lectura sigue viniendo de Zernio a proposito, hasta tener confianza en la
 * data local. Es un cambio de una linea el dia que se decida moverla, y hasta
 * entonces la bandeja se comporta exactamente como siempre.
 *
 * Consecuencia a tener presente si algun dia se mueve: el hilo de Zernio trae
 * los salientes mandados desde cualquier lado (incluida la app de Instagram),
 * mientras que la tabla local solo tiene los que salieron por el sistema.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id, workspace_id, channels(late_account_id, provider)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const channelRef = conversation.channels as
    | { late_account_id: string; provider: string }
    | null;

  // WhatsApp y email leen el hilo de NUESTRA tabla: ninguno de los dos
  // proveedores tiene una API donde vivan los mensajes. Instagram sigue
  // leyendo de Zernio (ver el comentario del receptor).
  if (channelRef?.provider === "evolution" || channelRef?.provider === "resend") {
    // RLS ya filtro la conversacion: si el usuario llego hasta aca, puede verla.
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to read messages from our table:", error);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }
    return NextResponse.json(messages ?? []);
  }

  if (!conversation.late_conversation_id) {
    return NextResponse.json({ error: "Conversation not found or missing Zernio ID" }, { status: 404 });
  }

  const apiKey = await getZernioApiKey(conversation.workspace_id);

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 400 });
  }

  if (!channelRef?.late_account_id) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  const channel = channelRef;

  // Fetch messages from Zernio API
  try {
    const zernio = createZernioClient(apiKey);
    const res = await zernio.messages.getInboxConversationMessages({
      path: { conversationId: conversation.late_conversation_id },
      // sortOrder "desc" trae los MAS RECIENTES. El default del SDK es
      // ascendente, asi que sin esto una conversacion larga mostraba los cien
      // mensajes mas viejos y nunca el ultimo, justo el que se ve en el preview
      // de la lista. toInboxThread devuelve el hilo ya en orden de lectura.
      query: {
        accountId: channel.late_account_id,
        limit: THREAD_PAGE_SIZE,
        sortOrder: "desc",
      },
    });

    // Toda la interpretacion de la respuesta vive en lib/zernio-message.ts,
    // que es donde se prueba con payloads reales.
    const thread = toInboxThread(res, conversationId);

    // ── La media guardada (F14) ──────────────────────────────────────────────
    // El hilo lo sigue mandando Zernio: no se cambia de donde se lee. Pero
    // Zernio no sabe nada de los archivos que copiamos ni de las
    // transcripciones, y sus URLs del CDN de Meta ya vencieron. Asi que se cruza
    // por platform_message_id y cada mensaje se enriquece con lo nuestro.
    //
    // Con el cliente del USUARIO: la RLS decide que filas se ven, igual que en
    // el resto de la bandeja.
    const platformIds = platformIdsOf(thread);
    if (platformIds.length === 0) return NextResponse.json(thread);

    const { data: local } = await supabase
      .from("messages")
      .select("id, platform_message_id, attachments, transcript, transcript_status, transcript_error, media_description")
      .eq("conversation_id", conversationId)
      .in("platform_message_id", platformIds);

    return NextResponse.json(mergeThreadWithLocal(thread, (local ?? []) as LocalMessageMedia[]));
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/** Los kinds que puede declarar un adjunto saliente (F19). */
const OUTBOUND_MEDIA_KINDS = new Set<AttachmentKind>(["audio", "voice", "image", "video", "document"]);

/**
 * La familia de mime que le corresponde a cada kind, para el chequeo por
 * magic bytes. Mismo criterio que `isCorruptMedia` en media-render.ts.
 */
const EXPECTED_MIME_FAMILY: Partial<Record<AttachmentKind, string>> = {
  image: "image/",
  video: "video/",
  audio: "audio/",
  voice: "audio/",
};

interface IncomingMedia {
  storagePath?: string;
  kind?: string;
  mime?: string;
  filename?: string | null;
  durationSeconds?: number | null;
}

type MediaValidation =
  | { ok: true; media: OutboundMedia }
  | { ok: false; status: number; error: string };

/**
 * Valida el adjunto que manda la bandeja ANTES de mandar nada (F19).
 *
 * No se confia en lo que declara el cliente (kind, mime): se vuelve a leer el
 * archivo y se chequea por magic bytes, igual que en la subida. El path
 * tiene que pertenecer a ESTE workspace y a ESTA conversacion -- si no,
 * cualquiera podria mandar un archivo de otro lado solo adivinando una ruta.
 */
async function validateOutboundMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { workspaceId: string; conversationId: string; media: IncomingMedia },
): Promise<MediaValidation> {
  const { storagePath, kind, filename, durationSeconds } = args.media;

  if (!isSafeStoragePath(storagePath)) {
    return { ok: false, status: 400, error: "Ruta de archivo inválida." };
  }
  if (!storagePath.startsWith(`${args.workspaceId}/${args.conversationId}/`)) {
    return { ok: false, status: 400, error: "El archivo no pertenece a esta conversación." };
  }
  if (!kind || !OUTBOUND_MEDIA_KINDS.has(kind as AttachmentKind)) {
    return { ok: false, status: 400, error: "Tipo de adjunto inválido." };
  }

  const { data: file, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).download(storagePath);
  if (error || !file) {
    return { ok: false, status: 400, error: "No pude leer el archivo subido." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(bytes);
  const family = EXPECTED_MIME_FAMILY[kind as AttachmentKind];
  if (!sniffed || (family && !sniffed.startsWith(family))) {
    return { ok: false, status: 400, error: "El archivo no se pudo reconocer." };
  }

  return {
    ok: true,
    media: {
      kind: kind as OutboundMedia["kind"],
      storagePath,
      mime: sniffed,
      filename: filename ?? null,
      durationSeconds: durationSeconds ?? null,
    },
  };
}

/**
 * POST /api/v1/messages
 *
 * Manda por el canal que corresponda, siempre por `sendChannelMessage`
 * (F19): es el mismo camino que usan los flows y las secuencias, asi que un
 * arreglo (o un formato nuevo) vale para los dos. `text` es opcional SOLO si
 * viene `media`.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { conversationId, text, media: incomingMedia, confirmedDoNotContact } = body as {
    conversationId?: string;
    text?: string;
    media?: IncomingMedia;
    confirmedDoNotContact?: boolean;
  };

  if (!conversationId || (!text && !incomingMedia)) {
    return NextResponse.json(
      { error: "conversationId and text (or media) required" },
      { status: 400 }
    );
  }

  // Get conversation with channel info
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, channels(*), contacts(do_not_contact, do_not_contact_reason)")
    .eq("id", conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // F18: a un contacto marcado se le puede escribir igual (a veces hay que
  // cerrar la conversacion, o el operador sabe algo que el sistema no), pero
  // no por accidente. El chequeo esta aca y no solo en la UI porque la
  // advertencia tiene que valer para cualquiera que use la API. Vale con o
  // sin media.
  const contact = conversation.contacts as {
    do_not_contact: boolean;
    do_not_contact_reason: string | null;
  } | null;

  if (contact?.do_not_contact && confirmedDoNotContact !== true) {
    return NextResponse.json(
      {
        error: "Este contacto está marcado como \"no contactar\".",
        requiresConfirmation: true,
        reason: contact.do_not_contact_reason,
      },
      { status: 409 }
    );
  }

  const outChannel = conversation.channels as {
    id: string;
    workspace_id: string;
    late_account_id: string;
    provider: string;
    platform: string;
    evolution_instance: string | null;
    email_address: string | null;
    is_active: boolean;
  } | null;

  if (!outChannel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  // Rama explicita por proveedor y no un `else`: un canal nuevo que caiga
  // por default en Zernio manda el mensaje al lugar equivocado sin avisar.
  if (outChannel.provider === "resend") {
    // El email no admite adjuntos. channelAcceptsMedia (lib/channels/media.ts)
    // es el unico lugar que decide esto, para que el picker de la bandeja, el
    // agente y esta ruta digan lo mismo.
    if (incomingMedia && !channelAcceptsMedia(outChannel.provider)) {
      return NextResponse.json({ error: "El email no admite adjuntos todavía." }, { status: 400 });
    }
    return sendViaResendChannel({
      supabase,
      conversationId,
      channel: outChannel,
      contact,
      text: text!,
      userId: user.id,
    });
  }

  let media: OutboundMedia | null = null;
  if (incomingMedia) {
    const validated = await validateOutboundMedia(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId,
      media: incomingMedia,
    });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status });
    }
    media = validated.media;
  }

  // Sin `origin`: solo lo usa `recordSend`, que esta ruta no llama (guarda la
  // fila ella misma, con origin:"user", unas lineas mas abajo).
  const context: SendContext = {
    workspaceId: conversation.workspace_id,
    channelId: outChannel.id,
    contactId: conversation.contact_id,
    conversationId,
    lateConversationId: conversation.late_conversation_id ?? undefined,
    lateAccountId: outChannel.late_account_id ?? undefined,
  };

  const outcome = await sendChannelMessage(supabase, context, {
    text: text ?? "",
    media: media ?? undefined,
  });

  const now = new Date().toISOString();
  const attachmentsColumn = media
    ? toAttachmentsColumn([
        emptyAttachment(media.kind, {
          storagePath: media.storagePath,
          mime: media.mime,
          filename: media.filename,
          durationSeconds: media.durationSeconds,
          status: "ready",
        }),
      ])
    : null;

  // Guardar nunca puede hacer fallar un envio que ya salio: si el insert
  // falla, se loguea y la respuesta sigue.
  const { data: stored, error: storeError } = await supabase
    .from("messages")
    .insert(
      outboundMessageRow({
        conversationId,
        origin: "user",
        // Un envio rechazado guarda el motivo en vez del texto que no salio,
        // igual que recordSend: es lo que va a leer el operador.
        text: outcome.ok ? (text ?? "") : (outcome.failure?.message ?? text ?? ""),
        attachments: attachmentsColumn,
        platformMessageId: outcome.platformMessageId ?? null,
        sentByUserId: user.id,
        status: outcome.ok ? "sent" : "failed",
        createdAt: now,
      }),
    )
    .select("*")
    .single();

  if (storeError && storeError.code !== "23505") {
    console.error("[messages] no pude guardar el envio manual:", storeError.message);
  }

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.failure?.message ?? "No se pudo enviar el mensaje" },
      { status: outcome.failure?.retryable ? 502 : 400 },
    );
  }

  await supabase
    .from("conversations")
    .update({
      last_message_at: now,
      last_message_preview: text ? messagePreview(text) : attachmentLabel(media!.kind),
    })
    .eq("id", conversationId);

  // Una persona respondio: se apaga el agente en esta conversacion y se borra
  // la marca de error (Fase 3, F31).
  await applyManualReply(supabase, {
    conversationId,
    workspaceId: conversation.workspace_id,
    userId: user.id,
  });

  // El audio propio tambien se transcribe (F19): asi el agente sabe que dijo
  // la persona si despues alguien lee el historial. Nunca hace fallar la
  // respuesta: corre despues de que el 201 ya esta armado.
  if (media && stored) {
    await afterMediaStored({ supabase, messageId: stored.id, items: toAttachmentsColumn([attachmentsColumn!.items[0]])!.items });
  }

  return NextResponse.json(
    stored ?? {
      id: outcome.platformMessageId ?? `sent-${Date.now()}`,
      conversation_id: conversationId,
      direction: "outbound",
      text: text ?? "",
      attachments: attachmentsColumn,
      platform_message_id: outcome.platformMessageId ?? null,
      sent_by_user_id: user.id,
      status: "sent",
      created_at: now,
    },
    { status: 201 }
  );
}

/**
 * Responde un email desde la bandeja (F65).
 *
 * El hilo se arma con `In-Reply-To` y `References` del ultimo entrante: sin
 * eso, la respuesta le llega a la otra persona como un correo suelto.
 */
async function sendViaResendChannel({
  supabase,
  conversationId,
  channel,
  contact,
  text,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  conversationId: string;
  channel: {
    workspace_id: string;
    platform: string;
    email_address: string | null;
    is_active: boolean;
  };
  contact: { email?: string | null; do_not_contact?: boolean | null } | null;
  text: string;
  userId: string;
}) {
  const { sendEmailReply } = await import("@/lib/email/send-reply");

  const result = await sendEmailReply(supabase, {
    workspaceId: channel.workspace_id,
    conversationId,
    channel: {
      platform: channel.platform,
      is_active: channel.is_active,
      email_address: channel.email_address,
    },
    toAddress: contact?.email ?? null,
    text,
    // El chequeo de "no contactar" ya corrio arriba y pidio confirmacion;
    // aca se pasa en false para no volver a frenarlo.
    contactOptedOut: false,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "No pude mandar el email" },
      { status: result.retryable ? 502 : 400 },
    );
  }

  const now = new Date().toISOString();

  const { data: stored } = await supabase
    .from("messages")
    .insert({
      ...outboundMessageRow({
        conversationId,
        origin: "user",
        text,
        platformMessageId: result.providerId,
        sentByUserId: userId,
        status: "sent",
        createdAt: now,
      }),
      // El Message-ID es lo que permite que la PROXIMA respuesta siga el
      // hilo: sin guardarlo, cada respuesta abre una conversacion nueva.
      email_message_id: result.messageId,
    })
    .select("*")
    .single();

  await supabase
    .from("conversations")
    .update({ last_message_at: now, last_message_preview: messagePreview(text) })
    .eq("id", conversationId);

  await applyManualReply(supabase, {
    conversationId,
    workspaceId: channel.workspace_id,
    userId,
  });

  return NextResponse.json(stored, { status: 201 });
}

