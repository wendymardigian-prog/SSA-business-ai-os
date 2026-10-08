/**
 * El tipo de un recurso de la banca (`response_assets.kind`).
 *
 * Modulo chico y sin JSX a proposito: lo importan tanto componentes (para el
 * label) como la herramienta del agente (para el campo `tipo` que le devuelve
 * al modelo), y esta ultima no puede importar React. Los iconos viven en
 * components/response-assets/asset-kind-icon.tsx por la misma razon.
 *
 * Seis tipos desde la 00131. Sumar un septimo es una migracion (el CHECK de
 * `kind`) y una entrada en cada mapa de abajo: el `Record` hace que TypeScript
 * marque cada lugar que falta.
 */

export type AssetKind = "text" | "audio" | "video" | "image" | "file" | "link";

/** En el orden en que se muestran los chips y las tarjetas de alta. */
export const ASSET_KINDS: readonly AssetKind[] = ["text", "audio", "video", "image", "file", "link"];

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  text: "Texto",
  audio: "Audio",
  video: "Video",
  image: "Imagen",
  file: "Archivo",
  link: "Enlace",
};

/** El plural, para los chips del filtro ("Textos · Audios · ..."). */
export const ASSET_KIND_PLURAL: Record<AssetKind, string> = {
  text: "Textos",
  audio: "Audios",
  video: "Videos",
  image: "Imágenes",
  file: "Archivos",
  link: "Enlaces",
};

/** Una linea de para que sirve cada uno: las tarjetas de "Nuevo recurso". */
export const ASSET_KIND_HINT: Record<AssetKind, string> = {
  text: "Un mensaje escrito, con variables como el nombre del contacto.",
  audio: "Una nota de voz: grabala acá o subila del disco.",
  video: "Un testimonio, una demo o una explicación en video.",
  image: "Una captura, un flyer o una foto de un resultado.",
  file: "Un PDF, una presentación o una planilla para mandar.",
  link: "Un enlace a una landing, un formulario, un video o tu agenda.",
};

/** Los que tienen archivo en el bucket (`storage_path`). */
export const FILE_KINDS: readonly AssetKind[] = ["audio", "video", "image", "file"];

/** Los que tienen voz y se transcriben. Un video puede no tenerla. */
export const TRANSCRIBABLE_KINDS: readonly AssetKind[] = ["audio", "video"];

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && (ASSET_KINDS as readonly string[]).includes(value);
}

export function hasFile(kind: AssetKind): boolean {
  return FILE_KINDS.includes(kind);
}

export function isTranscribableKind(kind: AssetKind): boolean {
  return TRANSCRIBABLE_KINDS.includes(kind);
}

/** El caption (texto que ve el contacto con el archivo) solo existe en estos. */
export function acceptsCaption(kind: AssetKind): boolean {
  return kind === "image" || kind === "video" || kind === "file";
}

// ── Clases de enlace ───────────────────────────────────────────────────────

/**
 * Lista cerrada, igual al CHECK `response_assets_link_kind_check` (00131).
 * Cerrada y no texto libre para que el filtro agrupe: con texto libre
 * "testimonio", "testimonios" y "Testimonio" serian tres cosas.
 */
export type LinkKind =
  | "video"
  | "imagen"
  | "testimonio"
  | "articulo"
  | "landing"
  | "formulario"
  | "agenda"
  | "pago"
  | "otro";

export const LINK_KINDS: readonly LinkKind[] = [
  "video",
  "imagen",
  "testimonio",
  "articulo",
  "landing",
  "formulario",
  "agenda",
  "pago",
  "otro",
];

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  video: "Video",
  imagen: "Imagen",
  testimonio: "Testimonio",
  articulo: "Artículo",
  landing: "Landing",
  formulario: "Formulario",
  agenda: "Agenda",
  pago: "Pago",
  otro: "Otro",
};

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === "string" && (LINK_KINDS as readonly string[]).includes(value);
}
