/**
 * Formato y archivos de cada red (F93).
 *
 * Cada entrada de `networks[]` elige un FORMATO (Reel, Carrusel, Short...) y,
 * segun el, los archivos de la biblioteca de la pieza que usa, en orden. El
 * formato dice cuantos archivos y de que tipo pide: de ahi salen el selector
 * filtrado, la linea de verificacion en verde o rojo y lo que bloquea que la
 * red se programe.
 *
 * Todo puro y sin dependencias de servidor: lo importa la pantalla (para
 * mostrar) y el servidor (para validar y publicar), asi que lo que el editor
 * dice es lo que despues pasa de verdad (F77).
 *
 * Una red SIN `format` sigue el modelo anterior: nada de esto se le aplica.
 */

import { liveMedia, type MediaEntry, type MediaKind } from "./media";
import { idOf, networkFileIds } from "./media-library";
import type { NetworkEntry } from "./redistribution";

export interface FormatDef {
  id: string;
  label: string;
  /** Tipos de archivo que admite. Vacio = ninguno (solo texto). */
  kinds: MediaKind[];
  min: number;
  max: number;
}

/** Verificado contra lo que acepta cada red (ver `limits.ts`). */
export const NETWORK_FORMATS: Record<string, FormatDef[]> = {
  instagram: [
    { id: "reel", label: "Reel", kinds: ["video"], min: 1, max: 1 },
    { id: "carousel", label: "Carrusel", kinds: ["image"], min: 2, max: 10 },
    { id: "image", label: "Imagen", kinds: ["image"], min: 1, max: 1 },
    { id: "story", label: "Historia", kinds: ["image", "video"], min: 1, max: 1 },
  ],
  tiktok: [
    { id: "video", label: "Video", kinds: ["video"], min: 1, max: 1 },
    { id: "photos", label: "Carrusel de fotos", kinds: ["image"], min: 2, max: 35 },
  ],
  youtube: [
    { id: "video", label: "Video", kinds: ["video"], min: 1, max: 1 },
    { id: "short", label: "Short", kinds: ["video"], min: 1, max: 1 },
  ],
  linkedin: [
    { id: "text", label: "Solo texto", kinds: [], min: 0, max: 0 },
    { id: "image", label: "Imagen", kinds: ["image"], min: 1, max: 1 },
    { id: "pdf", label: "Carrusel PDF", kinds: ["document"], min: 1, max: 1 },
    { id: "video", label: "Video", kinds: ["video"], min: 1, max: 1 },
  ],
  threads: [
    { id: "text", label: "Solo texto", kinds: [], min: 0, max: 0 },
    { id: "image", label: "Imagen", kinds: ["image"], min: 1, max: 1 },
    { id: "carousel", label: "Carrusel", kinds: ["image"], min: 2, max: 10 },
    { id: "video", label: "Video", kinds: ["video"], min: 1, max: 1 },
  ],
};

/** Las cinco redes que puede tener una pieza (Contenido v4, C1). */
export const CONTENT_PLATFORMS = Object.keys(NETWORK_FORMATS);

export function formatsFor(platform: string): FormatDef[] {
  return NETWORK_FORMATS[platform] ?? [];
}

export function getFormat(platform: string, id: string | null | undefined): FormatDef | null {
  if (!id) return null;
  return formatsFor(platform).find((f) => f.id === id) ?? null;
}

// ── En palabras ────────────────────────────────────────────────────────────

const NOUNS: Record<MediaKind, [string, string]> = {
  image: ["imagen", "imágenes"],
  video: ["video", "videos"],
  document: ["PDF", "PDFs"],
};

function noun(kind: MediaKind, count: number): string {
  return NOUNS[kind][count === 1 ? 0 : 1];
}

/** "1 video", "de 2 a 10 imágenes, en orden", "1 archivo (imagen o video)". */
export function requirementText(def: FormatDef): string {
  if (def.max === 0) return "ningún archivo";
  if (def.kinds.length > 1) return `${def.max} archivo (${def.kinds.map((k) => NOUNS[k][0]).join(" o ")})`;
  const kind = def.kinds[0];
  if (def.min === def.max) return `${def.max} ${noun(kind, def.max)}`;
  return `de ${def.min} a ${def.max} ${noun(kind, def.max)}, en orden`;
}

// ── Que archivos sirven ────────────────────────────────────────────────────

/** Los archivos de la biblioteca que este formato admite: lo que ofrece el selector. */
export function eligibleFiles(def: FormatDef, library: MediaEntry[]): MediaEntry[] {
  return liveMedia(library).filter((m) => def.kinds.includes(m.kind));
}

export interface FilesCheck {
  ok: boolean;
  message: string;
}

/**
 * La linea de verificacion de una red: verde dice que publica y en que orden;
 * roja dice que falta o que sobra. Es la que decide si la red se puede
 * programar, y corre igual en el servidor.
 */
export function checkFormatFiles(def: FormatDef, files: MediaEntry[]): FilesCheck {
  const live = liveMedia(files);
  const count = live.length;

  if (count > def.max) {
    return {
      ok: false,
      message:
        def.max === 0
          ? "Sobran archivos: este formato no lleva ninguno"
          : `Sobran archivos: este formato pide ${def.min === def.max ? requirementText(def) : `entre ${def.min} y ${def.max}`}`,
    };
  }

  if (live.some((m) => !def.kinds.includes(m.kind))) {
    return {
      ok: false,
      message: `Un archivo no sirve para este formato: pide ${requirementText(def)}`,
    };
  }

  if (count < def.min) {
    return {
      ok: false,
      message: `Faltan archivos: este formato pide ${def.min === def.max ? requirementText(def) : `entre ${def.min} y ${def.max}`}`,
    };
  }

  if (def.max === 0) return { ok: true, message: "Publica solo texto" };

  const kind = live[0].kind;
  const ordered = def.max > 1 ? " en ese orden" : "";
  return { ok: true, message: `Publica ${count} ${noun(kind, count)}${ordered}` };
}

// ── Cambiar de formato, elegir y ordenar ───────────────────────────────────

/**
 * Cambia el formato de una red.
 *
 * Se descartan los archivos que ya no sirven (de Reel a Carrusel el video sale
 * de esa red, y SIGUE en la biblioteca) y, si queda de menos, se propone uno
 * valido cuando lo hay: el primero para un formato de un archivo, o todas las
 * imagenes disponibles para un carrusel que llega al minimo.
 *
 * Devuelve la red nueva; no toca la biblioteca ni muta lo que recibe.
 */
export function changeFormat(network: NetworkEntry, formatId: string, library: MediaEntry[]): NetworkEntry {
  const def = getFormat(network.platform, formatId);
  if (!def) return network;

  const eligible = eligibleFiles(def, library);
  const eligibleIds = eligible.map(idOf);

  let files = networkFileIds(network, library)
    .filter((id) => eligibleIds.includes(id))
    .slice(0, def.max);

  if (files.length < def.min) {
    if (def.max === 1) {
      files = eligibleIds.slice(0, 1);
    } else if (eligibleIds.length >= def.min) {
      files = eligibleIds.slice(0, def.max);
    }
  }

  // El modelo anterior (una copia de la media) deja de regir en cuanto la red
  // elige un formato: dos fuentes de archivos a la vez serian ambiguas.
  return { ...network, format: def.id, files, media: null };
}

/** Elegir o sacar un archivo. Uno ya elegido sale; uno nuevo entra AL FINAL. */
export function toggleFile(files: string[], id: string, def: FormatDef): string[] {
  if (files.includes(id)) return files.filter((f) => f !== id);
  // Un formato de un solo archivo reemplaza: sumar un segundo seria un error.
  if (def.max === 1) return [id];
  if (files.length >= def.max) return files;
  return [...files, id];
}

/** ↑ y ↓: sube o baja un lugar. El primero no sube y el ultimo no baja. */
export function moveFile(files: string[], id: string, direction: "up" | "down"): string[] {
  const index = files.indexOf(id);
  if (index === -1) return files;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= files.length) return files;

  const next = [...files];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ── El formato completa las opciones del publicador ───────────────────────

const IG_CONTENT_TYPE: Record<string, string> = {
  reel: "reel",
  carousel: "carousel",
  image: "feed",
  story: "story",
};

const LINKEDIN_POST_TYPE: Record<string, string> = {
  text: "text",
  image: "image",
  pdf: "document",
  video: "video",
};

/**
 * Lo que el formato agrega a `options`: el tipo de Instagram, video o fotos en
 * TikTok, el tipo de publicacion de LinkedIn. YouTube y Threads no agregan
 * nada: un Short lo decide YouTube segun el video.
 */
export function optionsForFormat(platform: string, formatId: string | null | undefined): Record<string, unknown> {
  const def = getFormat(platform, formatId);
  if (!def) return {};

  if (platform === "instagram") return { contentType: IG_CONTENT_TYPE[def.id] };
  if (platform === "tiktok") return { mediaType: def.id === "photos" ? "photo" : "video" };
  if (platform === "linkedin") return { postType: LINKEDIN_POST_TYPE[def.id] };
  return {};
}

/**
 * Las opciones de una red ya resueltas: las guardadas mas lo que dice el
 * formato, que gana. Las usan el editor, la validacion del servidor y el
 * publicador, para que los tres hablen de lo mismo.
 */
export function resolveNetworkOptions(network: NetworkEntry): Record<string, unknown> {
  return { ...(network.options ?? {}), ...optionsForFormat(network.platform, network.format) };
}

/** El formato que tenia una red ANTES de que existiera `format`, mirando sus opciones. */
export function formatFromOptions(platform: string, options: Record<string, unknown> | null | undefined): string {
  const o = options ?? {};

  if (platform === "instagram") {
    const t = o.contentType;
    if (t === "reel" || t === "carousel" || t === "story") return t;
    return "image";
  }
  if (platform === "linkedin") {
    const t = o.postType;
    if (t === "document") return "pdf";
    if (t === "video") return "video";
    if (t === "image" || t === "multi_image") return "image";
    return "text";
  }
  if (platform === "threads") return "text";
  return "video";
}

// ── Sugerir desde el formato de la pieza ───────────────────────────────────

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * El formato de una red que mejor corresponde al formato escrito de la pieza
 * ("Reel", "Carrusel", "Historia"...), o null si no se sabe. Es una sugerencia
 * para no empezar de cero; la persona la cambia cuando quiera.
 */
export function suggestFormat(platform: string, pieceFormat: string | null | undefined): string | null {
  const f = fold(pieceFormat ?? "").trim();
  if (!f) return null;

  const pick = (id: string) => (getFormat(platform, id) ? id : null);

  if (f.includes("short")) return platform === "youtube" ? "short" : pick(platform === "instagram" ? "reel" : "video");
  if (f.includes("reel") || f.includes("video")) return pick(platform === "instagram" ? "reel" : "video");
  if (f.includes("carrusel") || f.includes("carousel")) {
    if (platform === "tiktok") return "photos";
    if (platform === "linkedin") return "pdf";
    return pick("carousel");
  }
  if (f.includes("historia") || f.includes("story")) return platform === "instagram" ? "story" : pick("image");
  if (f.includes("imagen") || f.includes("image") || f.includes("foto")) {
    return platform === "tiktok" ? null : pick("image");
  }
  if (f.includes("documento") || f.includes("pdf")) return pick("pdf");
  if (f.includes("texto") || f.includes("text")) return pick("text");

  return null;
}
