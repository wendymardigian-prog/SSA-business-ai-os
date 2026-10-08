/**
 * La forma de un recurso de la banca: que campos exige cada tipo, y la
 * validacion de cada campo.
 *
 * Modulo PURO y sin "use server": lo llaman el formulario (para avisar antes
 * de guardar) y las Server Actions (lib/actions/response-assets.ts) para
 * rechazar lo que llegue igual. Validar solo en la pantalla deja la puerta
 * abierta a un INSERT por la API; validar solo en el servidor hace que la
 * persona se entere tarde.
 *
 * Es la misma regla que los CHECK de la 00131, dicha en castellano: si la
 * base rechazara algo que esto deja pasar, la persona veria un error de
 * Postgres en vez de un mensaje que entiende. `shape.test.ts` prueba los seis
 * tipos.
 */

import { usedVariables } from "@/lib/templates/interpolate";
import { acceptsCaption, hasFile, isLinkKind, type AssetKind, type LinkKind } from "./kind";

export const MAX_NAME = 80;
export const MAX_CONTENT = 5000;
export const MAX_DESCRIPTION = 500;
export const MAX_CAPTION = 1000;
export const MAX_SHORTCUT = 30;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_URL = 2000;

export const SHORTCUT_FORMAT = /^\/[a-z0-9][a-z0-9_-]{0,29}$/;

// ── Que exige cada tipo ────────────────────────────────────────────────────

export type AssetField = "name" | "shortcut" | "description" | "tags" | "content" | "file" | "url" | "linkKind" | "caption";

export interface KindShape {
  /** Sin esto no se guarda. */
  required: readonly AssetField[];
  /** Lo que se puede cargar (incluye lo obligatorio). Lo demas tiene que quedar vacio. */
  allowed: readonly AssetField[];
}

const COMMON: readonly AssetField[] = ["name", "shortcut", "description", "tags"];

/**
 * La tabla de §5 del plano. La descripcion es obligatoria en todo menos el
 * texto: un audio, un video, una imagen, un PDF o un enlace no se "leen"
 * desde una lista, y el agente solo tiene la descripcion para decidir si ese
 * recurso contesta la pregunta.
 */
export const KIND_SHAPE: Record<AssetKind, KindShape> = {
  text: { required: ["name", "content"], allowed: [...COMMON, "content"] },
  audio: { required: ["name", "description", "file"], allowed: [...COMMON, "file"] },
  video: { required: ["name", "description", "file"], allowed: [...COMMON, "file", "caption"] },
  image: { required: ["name", "description", "file"], allowed: [...COMMON, "file", "caption"] },
  file: { required: ["name", "description", "file"], allowed: [...COMMON, "file", "caption"] },
  link: { required: ["name", "description", "url", "linkKind"], allowed: [...COMMON, "url", "linkKind"] },
};

export function isRequired(kind: AssetKind, field: AssetField): boolean {
  return KIND_SHAPE[kind].required.includes(field);
}

export function isAllowed(kind: AssetKind, field: AssetField): boolean {
  return KIND_SHAPE[kind].allowed.includes(field);
}

// ── Cada campo ─────────────────────────────────────────────────────────────

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateName(raw: string | null | undefined): FieldResult<string> {
  const name = (raw ?? "").trim();
  if (!name) return { ok: false, error: "Poné un nombre para el recurso" };
  if (name.length > MAX_NAME) return { ok: false, error: `El nombre es muy largo (máximo ${MAX_NAME} caracteres)` };
  return { ok: true, value: name };
}

/**
 * Deja el atajo como se guarda: minusculas, sin espacios y con una sola barra
 * adelante. Devuelve null cuando el campo vino vacio, que es valido.
 */
export function normalizeShortcut(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function validateShortcut(raw: string | null | undefined): FieldResult<string | null> {
  const shortcut = normalizeShortcut(raw);
  if (!shortcut) return { ok: true, value: null };
  if (shortcut.length > MAX_SHORTCUT + 1) {
    return { ok: false, error: `El atajo es muy largo (máximo ${MAX_SHORTCUT} caracteres)` };
  }
  if (!SHORTCUT_FORMAT.test(shortcut)) {
    return { ok: false, error: "El atajo solo puede tener letras, números, guiones y guiones bajos. Por ejemplo: /precio" };
  }
  return { ok: true, value: shortcut };
}

export function validateDescription(kind: AssetKind, raw: string | null | undefined): FieldResult<string | null> {
  const description = (raw ?? "").trim();
  if (!description) {
    if (isRequired(kind, "description")) {
      return {
        ok: false,
        error: "La descripción es obligatoria: es lo que lee el asistente para decidir cuándo usarlo, y lo que lee tu equipo para saber qué es sin abrirlo",
      };
    }
    return { ok: true, value: null };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `La descripción es muy larga (máximo ${MAX_DESCRIPTION} caracteres)` };
  }
  return { ok: true, value: description };
}

/** Solo un texto. Una variable inventada no rompe nada, pero casi siempre es un error de tipeo. */
export function validateContent(raw: string | null | undefined): FieldResult<string> {
  const content = (raw ?? "").trim();
  if (!content) return { ok: false, error: "El texto no puede quedar vacío" };
  if (content.length > MAX_CONTENT) return { ok: false, error: `El texto es muy largo (máximo ${MAX_CONTENT} caracteres)` };

  const { unknown } = usedVariables(content);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Esta variable no existe: {{${unknown[0]}}}. Usá el listado de variables disponibles.`,
    };
  }
  return { ok: true, value: content };
}

/**
 * Recorta, descarta vacias y duplicadas (sin distinguir mayusculas: "Precios"
 * y "precios" son la misma etiqueta), y respeta el tope de la base
 * (response_assets_tags_sane). Se guarda la primera grafia que aparece.
 */
export function validateTags(raw: readonly string[] | null | undefined): FieldResult<string[]> {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw ?? []) {
    const tag = value.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { ok: false, error: `Como mucho ${MAX_TAGS} etiquetas por recurso` };
  const tooLong = tags.find((t) => t.length > MAX_TAG_LENGTH);
  if (tooLong) return { ok: false, error: `La etiqueta "${tooLong.slice(0, 20)}…" es muy larga (máximo ${MAX_TAG_LENGTH} caracteres)` };
  return { ok: true, value: tags };
}

/** Separa un campo "precios, objeciones" en etiquetas. */
export function parseTagInput(raw: string): string[] {
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

/**
 * Normaliza una URL: le agrega https:// si vino sin esquema, y solo acepta
 * http y https. Un `javascript:` o un `file:` no tiene nada que hacer en un
 * mensaje a un contacto. Usa el parser del runtime (`URL`), que existe igual
 * en el navegador y en Node.
 */
export function normalizeUrl(raw: string | null | undefined): FieldResult<string> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Pegá la dirección del enlace" };
  if (/\s/.test(trimmed)) return { ok: false, error: "La dirección no puede tener espacios" };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Esa dirección no es válida. Probá copiarla de nuevo desde el navegador." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Solo se aceptan enlaces que empiecen con http:// o https://" };
  }
  // Un host sin punto ("hola") casi siempre es un tipeo, no una intranet.
  if (!parsed.hostname.includes(".")) {
    return { ok: false, error: "Esa dirección no parece completa. Por ejemplo: https://tusitio.com/agenda" };
  }
  const value = parsed.toString();
  if (value.length > MAX_URL) return { ok: false, error: "La dirección es demasiado larga" };
  return { ok: true, value };
}

/** El dominio de un enlace, para la lista y el widget ("calendly.com"). */
export function urlDomain(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function validateLinkKind(raw: string | null | undefined): FieldResult<LinkKind> {
  if (!isLinkKind(raw)) return { ok: false, error: "Elegí qué clase de enlace es" };
  return { ok: true, value: raw };
}

export function validateCaption(raw: string | null | undefined): FieldResult<string | null> {
  const caption = (raw ?? "").trim();
  if (!caption) return { ok: true, value: null };
  if (caption.length > MAX_CAPTION) return { ok: false, error: `El texto que acompaña es muy largo (máximo ${MAX_CAPTION} caracteres)` };
  return { ok: true, value: caption };
}

// ── El recurso entero ──────────────────────────────────────────────────────

export interface AssetFieldsInput {
  name?: string | null;
  shortcut?: string | null;
  description?: string | null;
  tags?: readonly string[] | null;
  content?: string | null;
  url?: string | null;
  linkKind?: string | null;
  caption?: string | null;
  /** El archivo, ya subido (alta) o el que ya tenia (edicion). */
  storagePath?: string | null;
}

/** Los campos ya validados y normalizados. Lo que no aplica al tipo va en null. */
export interface AssetFields {
  name: string;
  shortcut: string | null;
  description: string | null;
  tags: string[];
  content: string | null;
  url: string | null;
  linkKind: LinkKind | null;
  caption: string | null;
}

export type AssetValidation =
  | { ok: true; value: AssetFields }
  | { ok: false; field: AssetField; error: string };

/**
 * Valida un recurso entero segun su tipo y devuelve el primer error, con el
 * campo, para que el formulario lo marque. Lo que no aplica al tipo se
 * descarta (queda en null) en vez de rechazarse: un formulario que cambio de
 * tipo puede traer restos de otro, y la base los rechazaria.
 */
export function validateAssetFields(kind: AssetKind, input: AssetFieldsInput): AssetValidation {
  const name = validateName(input.name);
  if (!name.ok) return { ok: false, field: "name", error: name.error };

  const shortcut = validateShortcut(input.shortcut);
  if (!shortcut.ok) return { ok: false, field: "shortcut", error: shortcut.error };

  const description = validateDescription(kind, input.description);
  if (!description.ok) return { ok: false, field: "description", error: description.error };

  const tags = validateTags(input.tags);
  if (!tags.ok) return { ok: false, field: "tags", error: tags.error };

  let content: string | null = null;
  if (kind === "text") {
    const result = validateContent(input.content);
    if (!result.ok) return { ok: false, field: "content", error: result.error };
    content = result.value;
  }

  if (hasFile(kind) && !(input.storagePath ?? "").trim()) {
    return { ok: false, field: "file", error: "Falta el archivo" };
  }

  let url: string | null = null;
  let linkKind: LinkKind | null = null;
  if (kind === "link") {
    const urlResult = normalizeUrl(input.url);
    if (!urlResult.ok) return { ok: false, field: "url", error: urlResult.error };
    url = urlResult.value;
    const linkKindResult = validateLinkKind(input.linkKind);
    if (!linkKindResult.ok) return { ok: false, field: "linkKind", error: linkKindResult.error };
    linkKind = linkKindResult.value;
  }

  let caption: string | null = null;
  if (acceptsCaption(kind)) {
    const result = validateCaption(input.caption);
    if (!result.ok) return { ok: false, field: "caption", error: result.error };
    caption = result.value;
  }

  return {
    ok: true,
    value: {
      name: name.value,
      shortcut: shortcut.value,
      description: description.value,
      tags: tags.value,
      content,
      url,
      linkKind,
      caption,
    },
  };
}
