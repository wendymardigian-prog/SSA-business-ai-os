/**
 * La forma de `social_accounts.publishers` (F13).
 *
 * Una red puede tener mas de un camino para publicar: YouTube se puede subir
 * por Postproxy o por la API oficial de Google, e Instagram sale por Zernio.
 * Cada camino tiene su propio estado, porque uno puede estar disponible y otro
 * no (la API de YouTube no publica en publico hasta que Google audita la app).
 *
 * Es un jsonb y no una tabla porque son dos o tres entradas por cuenta, se
 * leen siempre juntas y se reescriben enteras al sincronizar. Pero un jsonb
 * sin validar es un campo de texto con ilusiones: se valida con Zod en cada
 * escritura, y la base ademas exige que sea un array.
 */

import { z } from "zod";

/** Por donde sale una publicacion. */
export const PUBLISHER_IDS = [
  "zernio",
  "postproxy",
  "youtube_api",
  "linkedin_api",
  "threads_api",
] as const;

export type PublisherId = (typeof PUBLISHER_IDS)[number];

export const PUBLISHER_LABELS: Record<PublisherId, string> = {
  zernio: "Zernio",
  postproxy: "Postproxy",
  youtube_api: "YouTube (API oficial)",
  linkedin_api: "LinkedIn",
  threads_api: "Threads",
};

/**
 * available: se puede publicar ya.
 * unverified: deberia andar, pero todavia no se probo (YouTube hasta F38).
 * unavailable: no se puede, y `status_reason` dice por que.
 */
export const PUBLISHER_STATUSES = ["available", "unverified", "unavailable"] as const;
export type PublisherStatus = (typeof PUBLISHER_STATUSES)[number];

export const publisherEntrySchema = z.object({
  publisher: z.enum(PUBLISHER_IDS),
  /** Con que cuenta publica este camino (el id en Zernio, el canal de YouTube). */
  account_ref: z.string().min(1).nullable().default(null),
  status: z.enum(PUBLISHER_STATUSES),
  /** Por que no se puede usar, en palabras. Obligatorio si no esta disponible. */
  status_reason: z.string().nullable().default(null),
  /** Cuando se comprobo por ultima vez que funciona. */
  verified_at: z.string().nullable().default(null),
  /** Alguien lo habilito a mano a pesar de la advertencia (F38). */
  manually_enabled: z.boolean().default(false),
});

export type PublisherEntry = z.infer<typeof publisherEntrySchema>;

export const publishersSchema = z
  .array(publisherEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.publisher)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "publisher"],
          message: `"${entry.publisher}" aparece dos veces: cada publicador va una sola vez por cuenta`,
        });
      }
      seen.add(entry.publisher);

      if (entry.status === "unavailable" && !entry.status_reason) {
        ctx.addIssue({
          code: "custom",
          path: [index, "status_reason"],
          // Sin motivo, la pantalla diria "no se puede publicar" y nadie sabria
          // que hacer para arreglarlo.
          message: "Un publicador no disponible tiene que decir por que",
        });
      }
    }
  });

/**
 * El orden en que se elige un publicador cuando el preferido deja de estar.
 *
 * Para YouTube: primero la API oficial (es de la cuenta del negocio y no tiene
 * tope mensual), despues Postproxy.
 */
export const PUBLISHER_FALLBACK_ORDER: PublisherId[] = [
  "youtube_api",
  "postproxy",
  "zernio",
  "linkedin_api",
  "threads_api",
];

/** Los publicadores que se pueden usar ahora mismo. */
export function usablePublishers(entries: PublisherEntry[]): PublisherEntry[] {
  return entries.filter((e) => e.status === "available" || e.manually_enabled);
}

/**
 * Cual conviene usar por defecto.
 *
 * Se respeta el elegido a mano mientras siga usable. Si dejo de estarlo, se
 * pasa al siguiente del orden y quien llama avisa: cambiar en silencio por
 * donde sale el contenido del negocio no es aceptable.
 */
export function resolveDefaultPublisher(
  entries: PublisherEntry[],
  preferred: string | null,
): { publisher: PublisherId | null; changed: boolean } {
  const usable = usablePublishers(entries);

  if (preferred && usable.some((e) => e.publisher === preferred)) {
    return { publisher: preferred as PublisherId, changed: false };
  }

  const next = PUBLISHER_FALLBACK_ORDER.find((id) => usable.some((e) => e.publisher === id));
  return { publisher: next ?? null, changed: true };
}

/** Valida lo que se va a guardar. Devuelve el error en palabras, sin stack. */
export function parsePublishers(
  value: unknown,
): { ok: true; publishers: PublisherEntry[] } | { ok: false; error: string } {
  const result = publishersSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: first?.message ?? "Los publicadores no tienen la forma esperada" };
  }
  return { ok: true, publishers: result.data };
}
