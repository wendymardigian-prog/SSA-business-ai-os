/**
 * Que pinta la burbuja para cada adjunto (F12).
 *
 * Hasta ahora la burbuja mostraba un clip y la palabra "Adjunto" para todo lo
 * que no fuera un correo: no habia un solo `<audio>` ni un `<video>` en el repo.
 * Una nota de voz llegaba y no se podia escuchar.
 *
 * Todas las decisiones viven aca, en funciones puras: que componente para que
 * tipo, que etiqueta, si el archivo esta corrupto, si se ofrece reintento. El
 * componente solo las compone. Modulo PURO.
 */

import {
  EMAIL_BUCKET_MARKER,
  attachmentLabel,
  type AttachmentKind,
  type ChatAttachment,
} from "@/lib/messages/attachments";
import { chatMediaDownloadUrl, chatMediaUrl } from "@/lib/chat-media/bucket";

/**
 * Que componente pinta el adjunto.
 *
 * `gif-video` existe porque WhatsApp manda los GIF como un mp4 corto: hay que
 * pintarlos con `<video autoplay loop muted>` y no con `<img>`, o no se mueven.
 */
export type MediaComponent =
  | "image"
  | "gif-video"
  | "gif-image"
  | "video"
  | "audio"
  | "document"
  | "link-card"
  | "label"
  | "pending"
  | "failed"
  | "unavailable"
  | "corrupt";

export interface MediaRenderPlan {
  component: MediaComponent;
  /** Lo que se lee: la etiqueta del tipo, o el motivo del fallo. */
  label: string;
  /** Si se ofrece "Reintentar". */
  canRetry: boolean;
  /** De donde se lee el archivo, o null si no hay. */
  url: string | null;
  /** El link de descarga, con el nombre con el que se guarda. */
  downloadUrl: string | null;
  /** El nombre que se muestra (un documento) y con el que se descarga. */
  filename: string | null;
  /** La URL externa de un link o un post compartido. */
  externalUrl: string | null;
  /** El titulo del post compartido (el caption del reel), recortado para la tarjeta (FA1). */
  shareTitle: string | null;
  /** La URL corta para mostrar debajo del titulo, sin protocolo ni query. */
  shareUrlLabel: string | null;
}

/** Las familias de mime que le corresponden a cada kind. */
const EXPECTED_FAMILY: Partial<Record<AttachmentKind, string>> = {
  image: "image/",
  sticker: "image/",
  video: "video/",
  audio: "audio/",
  voice: "audio/",
};

/**
 * Si el archivo que se bajo no es lo que dice ser (F12).
 *
 * El caso real: el proveedor devolvio una pagina de error en vez del archivo, y
 * quedo guardado un `text/html` de 900 bytes como si fuera una imagen. Sin este
 * chequeo, la burbuja pinta un `<img>` roto y ofrece reintentar algo que va a
 * fallar igual.
 *
 * Un GIF se deja pasar en las dos familias: WhatsApp los manda como video.
 */
export function isCorruptMedia(item: Pick<ChatAttachment, "kind" | "mime" | "status">): boolean {
  if (item.status !== "ready") return false;
  if (!item.mime) return false;
  if (item.kind === "gif") return !item.mime.startsWith("image/") && !item.mime.startsWith("video/");

  const expected = EXPECTED_FAMILY[item.kind];
  if (!expected) return false;
  return !item.mime.startsWith(expected);
}

/**
 * Si vale la pena ofrecer "Reintentar" para un adjunto que fallo.
 *
 * No se ofrece cuando reintentar no puede cambiar nada: un archivo demasiado
 * grande va a seguir siendo demasiado grande, y uno que WhatsApp ya borro no va
 * a volver. Un boton que siempre falla es peor que no tener boton.
 */
export function isRetryableMediaError(error: string | null | undefined): boolean {
  if (!error) return true;
  const lower = error.toLowerCase();
  if (lower.includes("supera el máximo") || lower.includes("supera el maximo")) return false;
  if (lower.includes("ya no tiene este archivo")) return false;
  if (lower.includes("llegó vacío") || lower.includes("llego vacio")) return false;
  if (lower.includes("sin dirección") || lower.includes("sin direccion")) return false;
  return true;
}

/** De que bucket se lee: los adjuntos de email viven en el suyo. */
function urlFor(item: ChatAttachment): { url: string | null; downloadUrl: string | null } {
  if (!item.storagePath) return { url: null, downloadUrl: null };

  if (item.meta?.bucket === EMAIL_BUCKET_MARKER) {
    // La ruta de los correos no se toca: los adjuntos de email tienen que
    // seguir viendose exactamente como hoy.
    const url = `/api/v1/email-attachments?path=${encodeURIComponent(item.storagePath)}`;
    return { url, downloadUrl: url };
  }

  return {
    url: chatMediaUrl(item.storagePath),
    downloadUrl: chatMediaDownloadUrl(item.storagePath, item.filename),
  };
}

/** La URL externa de un share, un link o una respuesta a una historia. */
function externalUrlOf(item: ChatAttachment): string | null {
  const meta = item.meta ?? {};
  for (const key of ["url", "storyUrl"]) {
    const value = meta[key];
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  }
  return null;
}

/** La etiqueta por tipo de post compartido (FA1). Sin pista, la generica. */
const SHARE_TYPE_LABELS: Record<string, string> = {
  reel: "Reel compartido",
  post: "Publicación compartida",
  story: "Historia compartida",
};

function shareLabel(item: ChatAttachment): string {
  const shareType = item.meta?.shareType;
  if (typeof shareType === "string" && shareType in SHARE_TYPE_LABELS) {
    return SHARE_TYPE_LABELS[shareType];
  }
  return attachmentLabel(item.kind);
}

/** El titulo de un post compartido (el caption del reel). Sin recorte: lo recorta el CSS. */
function shareTitleOf(item: ChatAttachment): string | null {
  const title = item.meta?.title;
  return typeof title === "string" && title.trim().length > 0 ? title.trim() : null;
}

/** La URL sin protocolo ni query, para mostrar en gris debajo del titulo. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(?:www\.)?/i, "").replace(/\?.*$/, "");
}

/** El nombre que se muestra y con el que se descarga. */
export function displayFilename(item: ChatAttachment): string {
  if (item.filename) return item.filename;
  return attachmentLabel(item.kind);
}

/**
 * Que hacer con un adjunto. Es la unica decision, y esta testeada.
 *
 * El orden de los chequeos no es casual: primero los estados (que no dependen
 * del tipo), despues lo corrupto (que invalida el tipo), y al final el tipo.
 */
export function renderPlan(item: ChatAttachment): MediaRenderPlan {
  const { url, downloadUrl } = urlFor(item);
  const externalUrl = externalUrlOf(item);
  const base = {
    canRetry: false,
    url,
    downloadUrl,
    filename: displayFilename(item),
    externalUrl,
    shareTitle: null as string | null,
    shareUrlLabel: externalUrl ? shortUrl(externalUrl) : null,
  };

  // Un link, una ubicacion o un contacto no tienen archivo: sus estados no
  // aplican, y mirarlos primero dejaria un spinner girando para siempre.
  const hasNoFile = ["location", "contact", "poll"].includes(item.kind);
  if (hasNoFile) {
    return { ...base, component: "label", label: labelWithDetail(item) };
  }

  const isLink = ["share", "link", "story_reply"].includes(item.kind);
  if (isLink) {
    // FA1: un post compartido se ve con su titulo y su URL corta, sin
    // reproducir nada y sin spinner ni error cuando no trae titulo: un link
    // siempre se puede abrir.
    return {
      ...base,
      component: base.externalUrl ? "link-card" : "label",
      label: item.kind === "share" ? shareLabel(item) : labelWithDetail(item),
      shareTitle: item.kind === "share" ? shareTitleOf(item) : null,
    };
  }

  if (item.status === "pending") {
    return { ...base, component: "pending", label: "Descargando adjunto…" };
  }

  if (item.status === "failed") {
    return {
      ...base,
      component: "failed",
      label: item.error ?? "No pudimos bajar este adjunto",
      canRetry: isRetryableMediaError(item.error),
    };
  }

  if (item.status === "none" || !item.storagePath) {
    // Media vieja (su URL vencio) o purgada por retencion. La etiqueta igual
    // dice que llego: "Adjunto ya no disponible" a secas no dice si era una
    // nota de voz o una foto.
    return {
      ...base,
      component: "unavailable",
      label: `${attachmentLabel(item.kind)} · ya no disponible`,
    };
  }

  if (isCorruptMedia(item)) {
    return {
      ...base,
      component: "corrupt",
      label: "El archivo no se pudo descargar correctamente",
    };
  }

  switch (item.kind) {
    case "image":
    case "sticker":
      return { ...base, component: "image", label: attachmentLabel(item.kind) };
    case "gif":
      return {
        ...base,
        // WhatsApp manda los GIF como mp4 corto.
        component: item.mime?.startsWith("video/") ? "gif-video" : "gif-image",
        label: "GIF",
      };
    case "video":
      return { ...base, component: "video", label: attachmentLabel(item.kind) };
    case "audio":
    case "voice":
      return { ...base, component: "audio", label: attachmentLabel(item.kind) };
    case "document":
      return { ...base, component: "document", label: attachmentLabel(item.kind) };
    default:
      return { ...base, component: "document", label: attachmentLabel(item.kind) };
  }
}

/** La etiqueta con el dato que la hace util, si lo hay. */
function labelWithDetail(item: ChatAttachment): string {
  const label = attachmentLabel(item.kind);
  const meta = item.meta ?? {};
  const name = typeof meta.name === "string" ? meta.name : null;

  if (item.kind === "location") {
    const address = typeof meta.address === "string" ? meta.address : null;
    const detail = name || address;
    return detail ? `${label}: ${detail}` : label;
  }
  if (item.kind === "contact" && name) return `${label}: ${name}`;
  if (item.kind === "poll" && name) return `${label}: ${name}`;
  return label;
}

/** Los bytes en palabras. Reusa el criterio de los adjuntos de email. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * La duracion como la lee una persona: `m:ss`.
 *
 * Un audio sin duracion devuelve null y NO "0:00": cero segundos diria que el
 * audio esta vacio, y lo que pasa es que no sabemos cuanto dura (el webm que
 * graba Chrome no la trae en la cabecera).
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** La extension en mayusculas, para la tarjeta de un documento. */
export function extensionLabel(item: ChatAttachment): string | null {
  const fromName = item.filename?.match(/\.([a-z0-9]{1,6})$/i)?.[1];
  if (fromName) return fromName.toUpperCase();
  const fromMime = item.mime?.split("/")[1]?.split(";")[0];
  return fromMime ? fromMime.toUpperCase().slice(0, 6) : null;
}
