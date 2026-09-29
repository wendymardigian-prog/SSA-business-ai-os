/**
 * Los adjuntos de un mensaje del chat: un solo contrato (F1).
 *
 * `messages.attachments` es jsonb libre y hasta ahora cada origen escribia una
 * forma distinta: el objeto de email, el array crudo de Zernio, el nodo crudo
 * de Baileys y lo que registraba un flow al enviar. Cuatro formas quiere decir
 * que la burbuja no puede decidir que pintar, que el agente no puede saber que
 * le mandaron, y que nadie puede preguntar "cuantas notas de voz entraron".
 *
 * Desde aca se guarda SIEMPRE `{ v: 2, items: ChatAttachment[] }`, y
 * `parseAttachments` entiende ademas los cuatro formatos viejos: se adaptan al
 * vuelo, sin backfill y sin fecha de corte. Las conversaciones viejas siguen
 * andando; lo unico que no vuelve es el archivo, porque su URL ya vencio.
 *
 * Modulo PURO: no importa nada del servidor ni de la base. Lo usan los dos
 * webhooks, la bandeja (que es cliente), el agente y el cron de limpieza.
 */

/**
 * Que es el adjunto. Decide que componente lo pinta y que puede hacer el
 * sistema con el: los seis primeros tienen archivo; los demas son una etiqueta
 * legible o un link, y no hay nada que descargar.
 */
export type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "sticker"
  | "gif"
  | "document"
  | "location"
  | "contact"
  | "poll"
  | "share"
  | "link"
  | "story_reply"
  | "unsupported";

/** Los kinds que tienen un archivo para bajar. El resto no se descarga nunca. */
export const KINDS_WITH_FILE: readonly AttachmentKind[] = [
  "image",
  "video",
  "audio",
  "voice",
  "sticker",
  "gif",
  "document",
];

/** Los kinds que se transcriben. */
export const AUDIO_KINDS: readonly AttachmentKind[] = ["audio", "voice"];

/**
 * En que estado esta el archivo:
 *
 *   pending  se esta bajando del proveedor
 *   ready    esta en nuestro bucket, se puede reproducir
 *   failed   no se pudo bajar; `error` dice por que
 *   none     no hay archivo que bajar (una ubicacion) o ya no esta (purgado
 *            por retencion, o media vieja cuya URL vencio)
 */
export type AttachmentStatus = "pending" | "ready" | "failed" | "none";

export interface ChatAttachment {
  kind: AttachmentKind;
  /** Ruta en el bucket `chat-media`. Null si no se pudo bajar o ya no esta. */
  storagePath: string | null;
  /** URL del proveedor. Solo como respaldo: vence. */
  sourceUrl: string | null;
  mime: string | null;
  filename: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  status: AttachmentStatus;
  /** Por que fallo, en castellano. Se muestra en la burbuja. */
  error: string | null;
  /** Lo propio de cada tipo: storyId, lat/lon, el titulo del post compartido. */
  meta: Record<string, unknown> | null;
}

/** La forma que se guarda. El `v` es lo que distingue lo nuevo de lo viejo. */
export interface ChatAttachments {
  v: 2;
  items: ChatAttachment[];
}

export const ATTACHMENTS_VERSION = 2 as const;

/**
 * Etiqueta legible de un adjunto. Es la UNICA fuente: la usa el preview de la
 * lista, la burbuja cuando no hay nada que reproducir, y el motivo del escalado
 * del agente. Antes vivia duplicada en lib/evolution-message.ts, con textos
 * distintos de los de la bandeja.
 */
const LABELS: Record<AttachmentKind, string> = {
  image: "📷 Imagen",
  video: "🎬 Video",
  audio: "🎵 Audio",
  voice: "🎤 Nota de voz",
  sticker: "Sticker",
  gif: "GIF",
  document: "📄 Documento",
  location: "📍 Ubicación",
  contact: "👤 Contacto",
  poll: "📊 Encuesta",
  share: "🔗 Publicación compartida",
  link: "🔗 Link",
  story_reply: "Respuesta a una historia",
  unsupported: "Adjunto",
};

export function attachmentLabel(kind: AttachmentKind): string {
  return LABELS[kind] ?? LABELS.unsupported;
}

/**
 * La etiqueta del conjunto: la del primer adjunto con algo que decir. Un
 * mensaje con una foto y un texto muestra el texto, asi que esto se usa solo
 * cuando no hay texto.
 */
export function attachmentsLabel(items: ChatAttachment[]): string | null {
  const first = items[0];
  return first ? attachmentLabel(first.kind) : null;
}

/** Un item con todo en su default. Para no repetir los diez campos. */
export function emptyAttachment(kind: AttachmentKind, overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    kind,
    storagePath: null,
    sourceUrl: null,
    mime: null,
    filename: null,
    sizeBytes: null,
    durationSeconds: null,
    status: "none",
    error: null,
    meta: null,
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Baileys manda algunos numeros como string ("12", "3021").
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * El mime sin sus parametros: `audio/ogg; codecs=opus` -> `audio/ogg`.
 *
 * Importa mas de lo que parece. El proveedor de transcripcion decide por la
 * extension del archivo, que se reconstruye desde el mime; y el chequeo de
 * archivo corrupto compara la familia del mime con el kind. Con el parametro
 * pegado, las dos comparaciones fallan.
 */
export function normalizeMime(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const clean = raw.split(";")[0].trim().toLowerCase();
  return clean.length > 0 ? clean : null;
}

/** El kind que le corresponde a un mime, cuando el origen no lo dice. */
export function kindForMime(mime: string | null): AttachmentKind {
  if (!mime) return "unsupported";
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// ── Formato 1: el array de Zernio (Instagram) ───────────────────────────────

/**
 * Un adjunto de Zernio: `{ type, url, payload? }`.
 *
 * Sus tipos son image, video, audio, file, sticker y share (el SDK los declara
 * asi). `file` es nuestro `document` y `share` se queda como `share`: un post
 * compartido no es un archivo, es un link a mostrar.
 */
const ZERNIO_KINDS: Record<string, AttachmentKind> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "document",
  document: "document",
  sticker: "sticker",
  share: "share",
  story_mention: "story_reply",
  ig_reel: "share",
  reel: "share",
};

export function fromZernioAttachment(raw: unknown): ChatAttachment | null {
  if (!isRecord(raw)) return null;

  const type = (asString(raw.type) ?? "").toLowerCase();
  const url = asString(raw.url);
  const kind = ZERNIO_KINDS[type] ?? (url ? "unsupported" : null);
  if (!kind) return null;

  // Un share no tiene archivo: su URL es la del post, y va en meta para que la
  // burbuja pinte una tarjeta con link en vez de intentar descargar nada.
  if (kind === "share") {
    return emptyAttachment("share", {
      status: "none",
      meta: { url, ...(asString(raw.payload) ? { payload: asString(raw.payload) } : {}) },
    });
  }

  return emptyAttachment(kind, {
    sourceUrl: url,
    // Pendiente: hay algo que bajar y todavia no se bajo. Sin URL no hay nada
    // que intentar, asi que queda en none.
    status: url ? "pending" : "none",
    ...(asString(raw.payload) ? { meta: { payload: asString(raw.payload) } } : {}),
  });
}

/** Los adjuntos de un mensaje de Zernio, ya normalizados. */
export function fromZernioAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(fromZernioAttachment).filter((item): item is ChatAttachment => item !== null);
}

/**
 * Las URLs de posts de Instagram que aparecen en el texto (F3).
 *
 * Cuando alguien comparte un reel por DM, Instagram a veces manda solo el link
 * en el texto y ningun adjunto. Sin esto, la burbuja muestra una URL pelada.
 */
const IG_POST_URL = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/gi;

export function sharedPostsInText(text: string | null | undefined): ChatAttachment[] {
  if (!text) return [];
  const matches = text.match(IG_POST_URL);
  if (!matches) return [];
  const seen = new Set<string>();
  const items: ChatAttachment[] = [];
  for (const url of matches) {
    const clean = url.replace(/\/$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    items.push(emptyAttachment("share", { status: "none", meta: { url: clean } }));
  }
  return items;
}

/** El item de una respuesta a una historia (hoy se descarta). */
export function storyReplyAttachment(storyReply: { storyId?: string | null; storyUrl?: string | null } | null | undefined): ChatAttachment | null {
  if (!storyReply?.storyId && !storyReply?.storyUrl) return null;
  return emptyAttachment("story_reply", {
    status: "none",
    meta: {
      ...(storyReply.storyId ? { storyId: storyReply.storyId } : {}),
      ...(storyReply.storyUrl ? { storyUrl: storyReply.storyUrl } : {}),
    },
  });
}

// ── Formato 2: el nodo de Baileys (WhatsApp) ────────────────────────────────

/**
 * Los nodos de Baileys que nos interesan, y que kind es cada uno.
 *
 * WhatsApp envuelve algunos mensajes (`ephemeralMessage`, `viewOnceMessage`),
 * asi que primero hay que desenvolver o no se ve nada de lo que hay adentro.
 */
const BAILEYS_KINDS: Record<string, AttachmentKind> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  liveLocationMessage: "location",
  contactMessage: "contact",
  contactsArrayMessage: "contact",
  pollCreationMessage: "poll",
  pollCreationMessageV2: "poll",
  pollCreationMessageV3: "poll",
  pollUpdateMessage: "poll",
};

/** Los nodos que NO son un adjunto: son texto, o plomeria del protocolo. */
const BAILEYS_NOT_ATTACHMENTS = new Set([
  "conversation",
  "extendedTextMessage",
  "buttonsResponseMessage",
  "listResponseMessage",
  "templateButtonReplyMessage",
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "deviceSentMessage",
  "editedMessage",
]);

const BAILEYS_WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"];

/** Desenvuelve los mensajes que WhatsApp mete adentro de otro. */
export function unwrapBaileysMessage(message: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  let current = message ?? null;
  for (let depth = 0; depth < 5 && current; depth++) {
    const wrapper = BAILEYS_WRAPPERS.find((key) => isRecord(current?.[key]));
    if (!wrapper) return current;
    const inner = (current[wrapper] as Record<string, unknown>).message;
    if (!isRecord(inner)) return current;
    current = inner;
  }
  return current;
}

/**
 * El adjunto de un mensaje de WhatsApp, sin el archivo.
 *
 * La media de WhatsApp llega cifrada (`url` es un `.enc` que no se puede
 * abrir sin la `mediaKey`), asi que aca solo salen los metadatos y el item
 * queda `pending`: el archivo se le pide despues a Evolution por su id.
 *
 * `ptt: true` es una nota de voz, que no es lo mismo que un audio adjunto: la
 * bandeja las pinta distinto y el agente las nombra distinto.
 */
export function fromBaileysMessage(rawMessage: Record<string, unknown> | null | undefined): ChatAttachment[] {
  const message = unwrapBaileysMessage(rawMessage);
  if (!message) return [];

  const items: ChatAttachment[] = [];

  for (const [key, node] of Object.entries(message)) {
    if (BAILEYS_NOT_ATTACHMENTS.has(key)) continue;
    const kind = BAILEYS_KINDS[key];
    if (!kind) continue;
    if (!isRecord(node)) continue;

    const mime = normalizeMime(node.mimetype);
    const seconds = asNumber(node.seconds);
    const isVoice = kind === "audio" && node.ptt === true;
    const isGif = kind === "video" && node.gifPlayback === true;

    if (kind === "location") {
      items.push(
        emptyAttachment("location", {
          status: "none",
          meta: {
            ...(asNumber(node.degreesLatitude) !== null ? { lat: asNumber(node.degreesLatitude) } : {}),
            ...(asNumber(node.degreesLongitude) !== null ? { lon: asNumber(node.degreesLongitude) } : {}),
            ...(asString(node.name) ? { name: asString(node.name) } : {}),
            ...(asString(node.address) ? { address: asString(node.address) } : {}),
          },
        }),
      );
      continue;
    }

    if (kind === "contact") {
      items.push(
        emptyAttachment("contact", {
          status: "none",
          meta: { ...(asString(node.displayName) ? { name: asString(node.displayName) } : {}) },
        }),
      );
      continue;
    }

    if (kind === "poll") {
      const options = Array.isArray(node.options)
        ? node.options.map((o) => (isRecord(o) ? asString(o.optionName) : null)).filter((o): o is string => o !== null)
        : [];
      items.push(
        emptyAttachment("poll", {
          status: "none",
          meta: {
            ...(asString(node.name) ? { name: asString(node.name) } : {}),
            ...(options.length > 0 ? { options } : {}),
          },
        }),
      );
      continue;
    }

    items.push(
      emptyAttachment(isVoice ? "voice" : isGif ? "gif" : kind, {
        mime,
        filename: asString(node.fileName),
        sizeBytes: asNumber(node.fileLength),
        durationSeconds: seconds,
        // Hay archivo y hay que pedirselo a Evolution: queda pendiente.
        status: "pending",
      }),
    );
  }

  return items;
}

// ── Formato 3: el objeto de email ───────────────────────────────────────────

/**
 * Los adjuntos de un correo. Son los unicos que hoy ya estan en un bucket
 * nuestro, y en OTRO bucket (`email-attachments`): por eso el item lleva
 * `meta.bucket`, para que la burbuja firme el link donde corresponde y los
 * correos se sigan viendo exactamente como hoy.
 */
export const EMAIL_BUCKET_MARKER = "email-attachments";

function fromEmailFiles(files: unknown[]): ChatAttachment[] {
  return files
    .filter(isRecord)
    .map((file) => {
      const storagePath = asString(file.storagePath);
      if (!storagePath) return null;
      const mime = normalizeMime(file.contentType) ?? "application/octet-stream";
      return emptyAttachment(kindForMime(mime) === "unsupported" ? "document" : "document", {
        storagePath,
        mime,
        filename: asString(file.filename) ?? "adjunto",
        sizeBytes: asNumber(file.sizeBytes),
        status: "ready",
        meta: { bucket: EMAIL_BUCKET_MARKER },
      });
    })
    .filter((item): item is ChatAttachment => item !== null);
}

// ── El lector ───────────────────────────────────────────────────────────────

function parseItem(raw: unknown): ChatAttachment | null {
  if (!isRecord(raw)) return null;
  const kind = asString(raw.kind) as AttachmentKind | null;
  if (!kind || !(kind in LABELS)) return null;
  const status = asString(raw.status) as AttachmentStatus | null;
  return {
    kind,
    storagePath: asString(raw.storagePath),
    sourceUrl: asString(raw.sourceUrl),
    mime: normalizeMime(raw.mime),
    filename: asString(raw.filename),
    sizeBytes: asNumber(raw.sizeBytes),
    durationSeconds: asNumber(raw.durationSeconds),
    status: status && ["pending", "ready", "failed", "none"].includes(status) ? status : "none",
    error: asString(raw.error),
    meta: isRecord(raw.meta) ? raw.meta : null,
  };
}

/**
 * Lee `messages.attachments` en cualquiera de las formas que existen.
 *
 * Nunca lanza y nunca devuelve undefined: con basura devuelve `[]`. Es lo que
 * lee la burbuja, que corre en el navegador de alguien que esta trabajando: un
 * throw aca le apaga la bandeja entera por un mensaje raro.
 */
export function parseAttachments(value: unknown): ChatAttachment[] {
  if (value === null || value === undefined) return [];

  // Forma nueva.
  if (isRecord(value) && value.v === ATTACHMENTS_VERSION) {
    const items = Array.isArray(value.items) ? value.items : [];
    return items.map(parseItem).filter((item): item is ChatAttachment => item !== null);
  }

  // Email.
  if (isRecord(value) && Array.isArray(value.files)) {
    return fromEmailFiles(value.files);
  }

  // Zernio, y lo que registra un flow al enviar (misma forma: `[{type, url}]`).
  if (Array.isArray(value)) {
    return fromZernioAttachments(value);
  }

  // Baileys.
  if (isRecord(value)) {
    return fromBaileysMessage(value);
  }

  return [];
}

/** Envuelve los items para guardarlos. */
export function toAttachmentsColumn(items: ChatAttachment[]): ChatAttachments | null {
  return items.length > 0 ? { v: ATTACHMENTS_VERSION, items } : null;
}
