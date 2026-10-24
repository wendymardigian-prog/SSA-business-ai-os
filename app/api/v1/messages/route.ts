import { after, NextRequest, NextResponse } from "next/server";
import { getMemberAction } from "@/lib/auth/guards";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { toInboxThread } from "@/lib/zernio-message";
import { messagePreview } from "@/lib/message-preview";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { applyManualReply } from "@/lib/agent/manual-reply";
import { mergeThreadWithLocal, platformIdsOf, type LocalMessageMedia } from "@/lib/zernio-message-merge";
import { sendChannelMessage, type SendContext, type OutboundMedia } from "@/lib/flow-engine/send";
import { CHAT_MEDIA_BUCKET, isSafeStoragePath } from "@/lib/chat-media/bucket";
import { sniffUploadMime } from "@/lib/content/media";
import { attachmentLabel, emptyAttachment, toAttachmentsColumn, type AttachmentKind } from "@/lib/messages/attachments";
import { afterMediaStored } from "@/lib/chat-media/after-stored";
import { assetKindForAttachment, channelAccepts } from "@/lib/channels/media";
import { stickerCapability } from "@/lib/channels/stickers";
import { touchSticker } from "@/lib/stickers/library";
import { loadOriginChips, withOriginChips } from "@/lib/inbox/origin-chip-load";
import { canRetrySend, retryMediaFrom, sendErrorText } from "@/lib/inbox/send-failure";
import { withLocalFailedSends } from "@/lib/zernio-message-merge";

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
    return NextResponse.json(await withChips(supabase, conversation.workspace_id, messages ?? []));
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
    if (platformIds.length === 0) return NextResponse.json(await withFailedSends(supabase, conversationId, thread));

    // Por las DOS columnas de id: el historial de Zernio hoy devuelve el id de
    // Meta, que guardamos en platform_native_message_id (ver
    // lib/zernio-message-merge.ts). Cada id va entre comillas dobles para que
    // un caracter raro no rompa el filtro de PostgREST.
    const idList = platformIds.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(",");
    const { data: local, error: localError } = await supabase
      .from("messages")
      .select("id, platform_message_id, platform_native_message_id, attachments, transcript, transcript_status, transcript_error, media_description, origin_context")
      .eq("conversation_id", conversationId)
      .or(`platform_message_id.in.(${idList}),platform_native_message_id.in.(${idList})`);

    if (localError) {
      // Sin lo nuestro el hilo igual se muestra (la media como "ya no
      // disponible"): mejor eso que una bandeja en blanco.
      console.error("Failed to read local media for the Instagram thread:", localError.message);
    }

    const merged = mergeThreadWithLocal(thread, (local ?? []) as LocalMessageMedia[]);
    return NextResponse.json(await withChips(supabase, conversation.workspace_id, await withFailedSends(supabase, conversationId, merged)));
  } catch (error) {
    console.error("Failed to fetch messages from Zernio API:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * Los envios de una persona que no salieron (00262). El hilo de Instagram lo
 * manda Zernio, que no sabe nada de un mensaje que nunca llego a la red: sin
 * esto, al recargar desaparecia y con el la opcion de reintentarlo. Nunca
 * falla: sin ellos el hilo se ve igual que antes.
 */
async function withFailedSends<T extends { id: string; created_at: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  thread: T[],
) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("status", "failed")
    .eq("origin", "user")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Failed to read the failed sends:", error.message);
    return thread;
  }
  return withLocalFailedSends(thread, data ?? []);
}

/**
 * Suma a cada mensaje entrante con origen su chip "Vino de…" (Extra I, F44).
 *
 * Los titulos se resuelven aca, en el servidor y con la sesion de quien mira: una consulta por tabla por hilo, no una por
 * mensaje. Nunca falla: sin chips el hilo se ve igual que siempre.
 */
async function withChips<T extends { id: string; direction: "inbound" | "outbound"; origin_context?: unknown }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  messages: T[],
) {
  try {
    if (!messages.some((m) => m.direction === "inbound" && m.origin_context)) return messages;
    // Los anuncios solo se linkean (y su nombre solo se lee del catalogo) con el permiso del dashboard de anuncios.
    const access = await getMemberAction();
    const chips = await loadOriginChips(supabase, {
      workspaceId,
      messages,
      canSeeAds: access?.can("dashboards.ads.view") ?? false,
    });
    return withOriginChips(messages, chips);
  } catch (error) {
    console.error("Failed to build the origin chips:", error instanceof Error ? error.message : "error");
    return messages;
  }
}

/** Los kinds que puede declarar un adjunto saliente (F19). */
const OUTBOUND_MEDIA_KINDS = new Set<AttachmentKind>(["audio", "voice", "image", "video", "document", "sticker"]);

/**
 * La familia de mime que le corresponde a cada kind, para el chequeo por
 * magic bytes. Mismo criterio que `isCorruptMedia` en media-render.ts.
 */
const EXPECTED_MIME_FAMILY: Partial<Record<AttachmentKind, string>> = {
  image: "image/",
  video: "video/",
  audio: "audio/",
  voice: "audio/",
  sticker: "image/",
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
  // sniffUploadMime y no sniffMime: un .docx o un video .webm (de la banca de
  // recursos o del clip) se reconocen por su contenedor + lo declarado, igual
  // que en la subida (lib/content/media.ts).
  const sniffed = sniffUploadMime(bytes, args.media.mime ?? null);
  const family = EXPECTED_MIME_FAMILY[kind as AttachmentKind];
  if (!sniffed || (family && !sniffed.startsWith(family))) {
    return { ok: false, status: 400, error: "El archivo no se pudo reconocer." };
  }
  // Un sticker es siempre el webp que dejo listo la biblioteca (00257).
  if (kind === "sticker" && sniffed !== "image/webp") {
    return { ok: false, status: 400, error: "El sticker no se pudo reconocer." };
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
  const { conversationId, confirmedDoNotContact, stickerId, retryOf } = body as {
    conversationId?: string;
    text?: string;
    media?: IncomingMedia;
    confirmedDoNotContact?: boolean;
    /** El sticker de la biblioteca que se mando (00257): suma un uso. */
    stickerId?: string;
    /** Reintentar ESTE envio fallido (00262): se manda lo que guardo, no lo que diga el pedido. */
    retryOf?: string;
  };
  let text = (body as { text?: string }).text;
  let incomingMedia = (body as { media?: IncomingMedia }).media;

  // Reintentar (00262): el texto y el adjunto salen de la fila fallida, leida
  // con el cliente del usuario (la RLS decide si la ve). Solo un saliente de una
  // persona que guardo el motivo aparte: en una fila vieja el texto ES el motivo.
  let retryId: string | null = null;
  if (typeof retryOf === "string" && retryOf) {
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    const { data: failedRow } = await supabase
      .from("messages")
      .select("id, direction, origin, status, text, attachments, send_error")
      .eq("id", retryOf)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (!failedRow) {
      return NextResponse.json({ error: "No encontré el mensaje para reintentar." }, { status: 404 });
    }
    if (failedRow.status !== "failed") {
      return NextResponse.json({ error: "Ese mensaje ya se está reintentando o ya salió." }, { status: 409 });
    }
    if (!canRetrySend(failedRow)) {
      return NextResponse.json(
        { error: "Este mensaje no se puede reintentar: es de antes y no guardó el texto original. Escribilo de nuevo." },
        { status: 409 },
      );
    }
    retryId = failedRow.id;
    text = failedRow.text ?? undefined;
    const retryMedia = retryMediaFrom(failedRow.attachments);
    incomingMedia = retryMedia
      ? {
          storagePath: retryMedia.storagePath,
          kind: retryMedia.kind,
          mime: retryMedia.mime ?? undefined,
          filename: retryMedia.filename,
          durationSeconds: retryMedia.durationSeconds,
        }
      : undefined;
  }

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

  // Escribir pide "puede responder" en la CUENTA de la conversacion (00249). Sin eso la API responde 403 ANTES de
  // llamar a ningun proveedor. El workspace tiene que ser el de la sesion.
  const access = await getMemberAction();
  if (!access || access.workspace.id !== conversation.workspace_id || !canReplyChannel(access.permissions, conversation.channel_id)) {
    return NextResponse.json({ error: "No tenés permiso para responder por esta cuenta" }, { status: 403 });
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

  // La conversacion ya se cargo con el cliente del usuario: si llego hasta
  // aca, la RLS dejo que la vea. Las claves del proveedor se leen con el de
  // servicio porque desde la 00143 `read_secret` solo la ejecuta el servidor
  // (antes, un Member no podia responder: la RPC solo dejaba a Owner/Admin).
  const service = await createServiceClient();

  // Rama explicita por proveedor y no un `else`: un canal nuevo que caiga
  // por default en Zernio manda el mensaje al lugar equivocado sin avisar.
  if (outChannel.provider === "resend") {
    // Un email que falla no deja fila (la respuesta es el error): no hay nada que reintentar.
    if (retryId) {
      return NextResponse.json({ error: "Este mensaje no se puede reintentar. Escribilo de nuevo." }, { status: 400 });
    }
    // El email no admite adjuntos. channelAccepts (lib/channels/media.ts) es
    // el unico lugar que decide esto, para que el widget de la bandeja, el
    // agente y esta ruta digan lo mismo.
    if (incomingMedia) {
      const acceptance = channelAccepts(outChannel.provider, "file");
      return NextResponse.json(
        { error: acceptance.ok ? "El email no admite adjuntos todavía." : acceptance.reason },
        { status: 400 },
      );
    }
    return sendViaResendChannel({
      supabase,
      secrets: service,
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
    // Que el canal acepte ESTE adjunto (un archivo por Instagram, un audio en
    // un formato que Instagram rechaza), antes de mandar nada. Un sticker lo
    // decide lib/channels/stickers.ts (solo WhatsApp) y va sin texto.
    if (validated.media.kind === "sticker") {
      const capability = stickerCapability(outChannel.provider);
      if (!capability.supported) return NextResponse.json({ error: capability.reason }, { status: 400 });
      if (text?.trim()) return NextResponse.json({ error: "Un sticker se manda sin texto." }, { status: 400 });
    } else {
      const acceptance = channelAccepts(
        outChannel.provider,
        assetKindForAttachment(validated.media.kind),
        validated.media.mime,
      );
      if (!acceptance.ok) {
        return NextResponse.json({ error: acceptance.reason }, { status: 400 });
      }
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

  // Reintentar reclama la fila ANTES de mandar: `failed -> pending` en una sola
  // sentencia. Un doble clic o dos pestanas dan un solo envio.
  if (retryId) {
    const { data: claimed, error: claimError } = await service
      .from("messages")
      .update({ status: "pending", send_error: null })
      .eq("id", retryId)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (claimError) {
      console.error("[messages] no pude reclamar el reintento:", claimError.message);
      return NextResponse.json({ error: "No se pudo reintentar. Probá de nuevo." }, { status: 500 });
    }
    if (!claimed) {
      return NextResponse.json({ error: "Ese mensaje ya se está reintentando o ya salió." }, { status: 409 });
    }
  }

  let outcome: Awaited<ReturnType<typeof sendChannelMessage>>;
  try {
    outcome = await sendChannelMessage(
      supabase,
      context,
      { text: text ?? "", media: media ?? undefined },
      { secrets: service },
    );
  } catch (err) {
    // Un reintento reclamado no puede quedar en `pending` para siempre.
    console.error("[messages] el envio lanzo:", err instanceof Error ? err.message : "error desconocido");
    outcome = { ok: false, failure: { kind: "unknown", message: "No se pudo enviar el mensaje.", hint: "Probá de nuevo en un momento.", retryable: true } };
  }
  const sendError = outcome.ok ? null : sendErrorText(outcome.failure);

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
  // falla, se loguea y la respuesta sigue. Un envio rechazado guarda lo que se
  // quiso mandar en el texto y el motivo aparte (00262): asi se puede leer el
  // por que y reintentar sin volver a escribirlo.
  const { data: stored, error: storeError } = retryId
    ? // El reintento es la MISMA fila: sale -> pasa a enviada (y baja al
      // final del hilo); vuelve a fallar -> queda fallida con el motivo nuevo.
      await service
        .from("messages")
        .update(
          outcome.ok
            ? {
                status: "sent" as const,
                send_error: null,
                platform_message_id: outcome.platformMessageId ?? null,
                sent_by_user_id: user.id,
                created_at: now,
              }
            : { status: "failed" as const, send_error: sendError },
        )
        .eq("id", retryId)
        .select("*")
        .single()
    : await supabase
        .from("messages")
        .insert({
          ...outboundMessageRow({
            conversationId,
            origin: "user",
            text: text ?? "",
            attachments: attachmentsColumn,
            platformMessageId: outcome.platformMessageId ?? null,
            sentByUserId: user.id,
            status: outcome.ok ? "sent" : "failed",
            createdAt: now,
          }),
          send_error: sendError,
        })
        .select("*")
        .single();

  if (storeError && storeError.code !== "23505") {
    console.error("[messages] no pude guardar el envio manual:", storeError.message);
  }

  if (!outcome.ok) {
    return NextResponse.json(
      {
        error: sendError,
        retryable: outcome.failure?.retryable ?? false,
        // La fila guardada: la pantalla la pone en lugar del mensaje
        // optimista, con su id para poder reintentarla.
        message: stored ?? null,
      },
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

  // Un sticker de la biblioteca suma un uso (00257). Nunca frena el envio.
  if (media?.kind === "sticker" && typeof stickerId === "string") {
    await touchSticker(service, { workspaceId: conversation.workspace_id, stickerId });
  }

  // El audio propio tambien se transcribe (F19): asi el agente sabe que dijo
  // la persona si despues alguien lee el historial. Va en el after(): la
  // respuesta sale primero y la transcripcion no demora el envio ni la
  // pantalla. Nunca hace fallar la respuesta (afterMediaStored no lanza).
  // Sin un request en curso (un test) no hay donde colgarlo y se espera aca.
  if (media && stored) {
    const transcribeSentMedia = () =>
      // Con el de servicio, como en los dos webhooks: transcribir lee la
      // key del proveedor, reclama la fila y puede encolar un reintento.
      afterMediaStored({ supabase: service, messageId: stored.id, items: toAttachmentsColumn([attachmentsColumn!.items[0]])!.items });
    try {
      after(transcribeSentMedia);
    } catch {
      await transcribeSentMedia();
    }
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
  secrets,
  conversationId,
  channel,
  contact,
  text,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  /** Solo para leer la key de Resend (ver el comentario en POST). */
  secrets: Awaited<ReturnType<typeof createServiceClient>>;
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
    secrets,
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

