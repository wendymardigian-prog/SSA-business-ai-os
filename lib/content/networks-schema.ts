/**
 * Lo que el servidor acepta como `networks` y como media de una pieza (F92,
 * F93, §7 del plano).
 *
 * Hasta ahora `savePostDraft` escribia lo que llegaba del navegador tal cual:
 * un `jsonb` sin forma, que cualquier cliente (o un bug) podia llenar de
 * cualquier cosa. Aca esta la forma. Es estricta con lo que importa (la red,
 * la fecha, el tipo de CTA, el formato y los ids de archivo) y deja pasar lo
 * que no conoce (`passthrough`), porque una clave de un bloque futuro no tiene
 * que perderse al guardar.
 *
 * Los archivos se contrastan con la biblioteca REAL de la pieza: un id que otra
 * pestaña ya quito se descarta en vez de dejar una red apuntando a la nada.
 */

import { z } from "zod";
import { ALLOWED_MEDIA, MAX_MEDIA_BYTES, type MediaEntry } from "./media";
import { idOf, mediaIdFor } from "./media-library";
import { getFormat } from "./network-format";
import type { NetworkEntry } from "./redistribution";

const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "threads"] as const;

/** Un techo para texto libre: la red tiene su limite real, esto solo frena abusos. */
const MAX_TEXT = 20_000;
const MAX_FILES_PER_NETWORK = 35;

const isDate = (value: string) => !Number.isNaN(Date.parse(value));

const networkEntrySchema = z
  .object({
    platform: z.enum(PLATFORMS, {
      message: "La plataforma no es una de las cinco (instagram, tiktok, youtube, linkedin, threads)",
    }),
    planned_at: z
      .string()
      .refine(isDate, { message: "La fecha de la red no es válida" })
      .nullable()
      .optional(),
    caption: z.string().max(MAX_TEXT, { message: "El caption de la red es demasiado largo" }).nullable().optional(),
    format: z.string().max(30).nullable().optional(),
    files: z
      .array(z.string().min(1).max(200))
      .max(MAX_FILES_PER_NETWORK, { message: `Una red usa hasta ${MAX_FILES_PER_NETWORK} archivos` })
      .optional(),
    // Modelo anterior: una copia de la media. Se acepta tal cual.
    media: z.array(z.unknown()).nullable().optional(),
    cta: z
      .object({
        type: z.enum(["comment", "dm", "link", "none"], { message: "El tipo de CTA no existe" }),
        keyword: z.string().max(200).nullable().optional(),
        url: z.string().max(2000).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    options: z
      .record(z.string(), z.unknown(), { message: "Las opciones de la red tienen que ser un objeto" })
      .optional(),
    publisher: z.string().max(60).nullable().optional(),
    youtube_title: z.string().max(500).nullable().optional(),
    needs_review: z.boolean().optional(),
  })
  .passthrough();

const networksSchema = z.array(networkEntrySchema).max(PLATFORMS.length, {
  message: `Una pieza tiene hasta ${PLATFORMS.length} redes`,
});

export type NetworksResult = { ok: true; networks: NetworkEntry[] } | { ok: false; error: string };

/**
 * Valida y limpia las redes que llegan a `savePostDraft`.
 *
 *  - La forma se revisa con Zod.
 *  - Una red aparece una sola vez (hay una publicacion por red y pieza).
 *  - El formato tiene que existir en esa red; con formato, `files` es siempre
 *    una lista (vacia si no vino): "sin lista" quiere decir "toda la base", que
 *    es el modelo anterior y no lo que alguien eligio al poner un formato.
 *  - Los ids de `files` se limpian contra la biblioteca: sin repetidos, sin
 *    los que no existen, en el orden recibido.
 */
export function normalizeNetworks(raw: unknown, library: MediaEntry[]): NetworksResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Las redes no tienen el formato esperado: tiene que ser una lista." };
  }

  const parsed = networksSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Las redes no tienen el formato esperado." };
  }

  const seen = new Set<string>();
  for (const network of parsed.data) {
    if (seen.has(network.platform)) {
      return {
        ok: false,
        error: `La red ${network.platform} aparece dos veces: una pieza tiene una publicación por red.`,
      };
    }
    seen.add(network.platform);
  }

  const known = new Set(library.filter((m) => !m.deleted_at).map(idOf));

  const networks: NetworkEntry[] = [];
  for (const network of parsed.data) {
    const entry = network as unknown as NetworkEntry;

    if (entry.format) {
      if (!getFormat(entry.platform, entry.format)) {
        return { ok: false, error: `El formato "${entry.format}" no existe en ${entry.platform}.` };
      }
    }

    if (entry.format || Array.isArray(entry.files)) {
      const files: string[] = [];
      for (const id of entry.files ?? []) {
        if (known.has(id) && !files.includes(id)) files.push(id);
      }
      networks.push({ ...entry, files });
    } else {
      networks.push(entry);
    }
  }

  return { ok: true, networks };
}

// ── Una subida nueva ───────────────────────────────────────────────────────

const newMediaSchema = z.object({
  path: z.string().min(1).max(500),
  mime: z.string().refine((m) => m in ALLOWED_MEDIA, { message: "Ese tipo de archivo no se puede publicar" }),
  kind: z.enum(["image", "video", "document"]),
  sizeBytes: z.number().int().min(1, { message: "El archivo está vacío" }).max(MAX_MEDIA_BYTES, {
    message: "El archivo supera el máximo de 1 GB",
  }),
  name: z.string().optional().nullable(),
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  durationMs: z.number().optional().nullable(),
  altText: z.string().max(500).optional().nullable(),
  isCover: z.boolean().optional(),
});

/** Un dato de dimension razonable, o null: lo que viene del navegador es una pista, no un hecho. */
const sane = (value: number | null | undefined, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= max ? Math.round(value) : null;

/** El nombre del archivo, sin separadores de ruta ni caracteres de control. */
function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim().slice(0, 200);
  return name === "" ? null : name;
}

export type NewMediaResult = { ok: true; entry: MediaEntry } | { ok: false; error: string };

/**
 * Arma la entrada de la biblioteca para un archivo recien subido.
 *
 * El tipo tiene que cuadrar con el mime (un jpg no es un video), y las
 * dimensiones y la duracion se aceptan solo si son razonables: sirven para
 * mostrar la proporcion y para avisar de un Reel muy largo, pero la red mira
 * el archivo de verdad.
 */
export function parseNewMediaEntry(input: unknown): NewMediaResult {
  const parsed = newMediaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Los datos del archivo no son válidos" };
  }

  const v = parsed.data;
  const expectedKind = ALLOWED_MEDIA[v.mime as keyof typeof ALLOWED_MEDIA].kind;
  if (v.kind !== expectedKind) {
    return { ok: false, error: `El archivo es ${v.mime} pero se anotó como ${v.kind}.` };
  }

  return {
    ok: true,
    entry: {
      id: mediaIdFor(v.path),
      name: cleanName(v.name),
      storage_path: v.path,
      mime_type: v.mime,
      kind: v.kind,
      size_bytes: v.sizeBytes,
      width: sane(v.width, 20_000),
      height: sane(v.height, 20_000),
      duration_ms: sane(v.durationMs, 12 * 60 * 60 * 1000),
      is_cover: v.isCover ?? false,
      alt_text: v.altText ?? null,
    },
  };
}
