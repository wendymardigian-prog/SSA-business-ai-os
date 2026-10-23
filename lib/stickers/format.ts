/**
 * Las reglas de un sticker de WhatsApp, puras.
 *
 * WhatsApp espera un webp de 512 x 512 con fondo transparente, de hasta
 * ~100 KB (estatico) o ~500 KB (animado). Lo que se sube se lleva a esa forma
 * en el servidor (`normalize.ts`); un GIF queda como sticker ANIMADO, que es la
 * unica forma de que se mueva solo en WhatsApp (ver lib/channels/stickers.ts).
 *
 * La biblioteca vive en el bucket `chat-media`, bajo `<workspace>/stickers/`:
 * la retencion de 180 dias solo borra archivos que referencia un mensaje, y un
 * sticker se COPIA a la conversacion antes de mandarse, asi que el de la
 * biblioteca no lo referencia ningun mensaje.
 */

export const STICKER_SIZE = 512;
export const STICKER_MIME = "image/webp";
/** Lo que se acepta al subir (se verifica por bytes, nunca por la extension). */
export const STICKER_INPUT_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_STICKER_INPUT_BYTES = 5 * 1024 * 1024;
export const STATIC_STICKER_MAX_BYTES = 100 * 1024;
export const ANIMATED_STICKER_MAX_BYTES = 500 * 1024;
export const STICKERS_PAGE_LIMIT = 300;

export const STICKER_TOO_LARGE_INPUT = "El archivo supera los 5 MB.";
export const STICKER_UNSUPPORTED = "Usá una imagen PNG, JPG, WEBP o un GIF.";

/** La ruta de un sticker de la biblioteca: una por contenido (sha256). */
export function stickerLibraryPath(workspaceId: string, sha256: string): string {
  return `${workspaceId}/stickers/${sha256}.webp`;
}

export function isStickerLibraryPath(path: string, workspaceId: string): boolean {
  return /^[0-9a-f-]{36}\/stickers\/[0-9a-f]{64}\.webp$/.test(path) && path.startsWith(`${workspaceId}/stickers/`);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

/** Si es un webp (RIFF....WEBP). */
export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

/**
 * Si un webp es animado: el encabezado extendido (VP8X) trae el bit de
 * animacion, o aparece un chunk ANIM. Sin leer el archivo entero con sharp.
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!isWebp(bytes)) return false;
  if (ascii(bytes, 12, 4) === "VP8X" && bytes.length > 20 && (bytes[20] & 0x02) !== 0) return true;
  const limit = Math.min(bytes.length - 4, 4096);
  for (let i = 12; i < limit; i++) {
    if (bytes[i] === 0x41 && ascii(bytes, i, 4) === "ANIM") return true;
  }
  return false;
}

export type StickerTab = "favorites" | "recent" | "all";

export interface StickerItem {
  id: string;
  storagePath: string;
  isAnimated: boolean;
  isFavorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface StickerWithUrl extends StickerItem {
  /** URL firmada para la miniatura (vence en 15 minutos). */
  url: string | null;
}

/** Lo que muestra cada pestaña del selector. */
export function stickersForTab<T extends StickerItem>(items: T[], tab: StickerTab): T[] {
  if (tab === "favorites") return items.filter((s) => s.isFavorite).sort(byRecentUse);
  if (tab === "recent") return items.filter((s) => s.lastUsedAt).sort(byRecentUse).slice(0, 40);
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function byRecentUse(a: StickerItem, b: StickerItem): number {
  return (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || b.createdAt.localeCompare(a.createdAt);
}

/** La pestaña con la que abre: favoritos si hay, si no recientes, si no todos. */
export function defaultStickerTab(items: readonly StickerItem[]): StickerTab {
  if (items.some((s) => s.isFavorite)) return "favorites";
  if (items.some((s) => s.lastUsedAt)) return "recent";
  return "all";
}
