/**
 * "Cargar a mano" con canal (Extra I, F47): de donde vino una venta cuando el contacto no tiene el toque.
 *
 * El selector es de dos pasos: primero el CANAL (contenido organico, anuncio, referido, evento o llamada en frio,
 * otro) y despues el detalle de ese canal. Este modulo es la tabla de canales como datos, la validacion de lo que
 * eligio la persona y `buildManualTouch`, que lo convierte en el toque que el servidor registra con `recordTouch`
 * (`origin = 'manual'`) antes de crear la venta en modo `touch`.
 *
 * Que se guarda en el toque (la tabla del plano):
 *
 *   organic   channel organic · source = la red · medium organic_social · content_post_id / social_post_id · content = titulo
 *   paid      channel paid · source facebook|instagram · medium paid_social · ad_id / adset_id / campaign_id
 *   referral  channel referral · source referral · medium referral_person · raw.referrer_contact_id | raw.referrer_user_id
 *   event     channel direct · medium event · campaign = el nombre del evento
 *   other     channel direct · medium other · campaign = la nota (si hay)
 *   utm       "Avanzado": los campos UTM de siempre; el canal se calcula con `touchChannel`
 *
 * Reglas:
 *   - `occurredAt` es la fecha de la venta a las 12:00 de la zona del negocio (mismo ancla que `dateInputToIso`: se
 *     lee igual desde cualquier zona cercana);
 *   - `dedupeKey = 'sale-manual:<saleKey>'`: dos envios del mismo asistente (doble clic) dejan UN toque;
 *   - el canal va EXPLICITO en el toque aunque se podria deducir: la fila queda como la eligio la persona.
 *
 * Este modulo solo valida la FORMA. Que la pieza, el anuncio, el contacto y la persona sean del workspace lo
 * comprueba el servidor (`manualChoiceReferences` dice que ids hay que comprobar). Y los titulos que manda el
 * navegador se reemplazan por los de la base antes de guardar.
 *
 * Modulo PURO.
 */
import { z } from "zod";
import { touchChannel, type TouchChannel } from "@/lib/attribution/channel";
import { dateInputToIso } from "@/lib/dates";
import { MEDIUMS, SOURCES } from "@/lib/contacts/taxonomy";
import type { TouchInput } from "@/lib/contacts/touch";
import { localDate } from "./dates";

// ── La tabla de canales ──────────────────────────────────────────────────────

export const MANUAL_CHANNEL_KINDS = ["organic", "paid", "referral", "event", "other"] as const;
export type ManualChannelKind = (typeof MANUAL_CHANNEL_KINDS)[number];

export interface ManualChannelOption {
  kind: ManualChannelKind;
  label: string;
  /** Lo que se le pide en el segundo paso. */
  detail: string;
  /** Si el detalle es obligatorio (false = hay una salida "No sé"). */
  detailRequired: boolean;
  /** Texto de la salida "No sé", si la hay. */
  unknownLabel?: string;
  /** El canal que queda en el toque. */
  channel: TouchChannel;
}

export const MANUAL_CHANNELS: readonly ManualChannelOption[] = [
  {
    kind: "organic",
    label: "Contenido orgánico",
    detail: "Red y pieza de contenido",
    detailRequired: false,
    unknownLabel: "No sé qué pieza",
    channel: "organic",
  },
  {
    kind: "paid",
    label: "Anuncio",
    detail: "Red y anuncio del catálogo de Meta",
    detailRequired: false,
    unknownLabel: "No sé qué anuncio",
    channel: "paid",
  },
  {
    kind: "referral",
    label: "Referido",
    detail: "Quién lo recomendó: un contacto o una persona del equipo",
    detailRequired: true,
    channel: "referral",
  },
  {
    kind: "event",
    label: "Evento o llamada en frío",
    detail: "Nombre del evento",
    detailRequired: true,
    channel: "direct",
  },
  {
    kind: "other",
    label: "Otro / no se sabe",
    detail: "Un texto opcional",
    detailRequired: false,
    channel: "direct",
  },
];

/** Las redes del paso 2 de "Contenido orgánico". */
export const ORGANIC_NETWORKS = ["instagram", "tiktok", "youtube", "linkedin", "facebook", "other"] as const;
export type OrganicNetwork = (typeof ORGANIC_NETWORKS)[number];

export const ORGANIC_NETWORK_LABELS: Record<OrganicNetwork, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  other: "Otra",
};

/** Las redes del paso 2 de "Anuncio". */
export const PAID_NETWORKS = ["facebook", "instagram"] as const;
export type PaidNetwork = (typeof PAID_NETWORKS)[number];

// ── La eleccion de la persona (lo que viaja al servidor) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string().trim().regex(UUID_RE, message);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

const organicChoice = z.object({
  kind: z.literal("organic"),
  network: z.enum(ORGANIC_NETWORKS, { error: "Elegí una red" }),
  /** Null = "No sé qué pieza". */
  piece: z
    .object({
      contentPostId: uuid("La pieza no es válida"),
      /** Solo si la pieza tiene UNA publicación en esa red. */
      socialPostId: uuid("La publicación no es válida").nullish().transform((v) => v ?? null),
      /** El titulo que vio la persona; el servidor lo reemplaza por el de la base. */
      title: optionalText(300),
    })
    .nullish()
    .transform((v) => v ?? null),
});

const idText = z.string().trim().min(1).max(100);

const paidChoice = z.object({
  kind: z.literal("paid"),
  network: z.enum(PAID_NETWORKS, { error: "Elegí Facebook o Instagram" }),
  /** Null = "No sé qué anuncio": solo la red. Si hay, al menos un id (puede ser solo la campaña). */
  ad: z
    .object({
      adId: idText.nullish().transform((v) => v ?? null),
      adsetId: idText.nullish().transform((v) => v ?? null),
      campaignId: idText.nullish().transform((v) => v ?? null),
    })
    .refine((a) => a.adId || a.adsetId || a.campaignId, { message: "Elegí una campaña, un conjunto o un anuncio" })
    .nullish()
    .transform((v) => v ?? null),
});

const referralChoice = z.object({
  kind: z.literal("referral"),
  referrer: z.discriminatedUnion(
    "type",
    [
      z.object({ type: z.literal("contact"), contactId: uuid("El contacto no es válido") }),
      z.object({ type: z.literal("member"), userId: uuid("La persona no es válida") }),
    ],
    { error: "Elegí quién lo recomendó" },
  ),
});

const eventChoice = z.object({
  kind: z.literal("event"),
  name: z.string().trim().min(1, "Escribí el nombre del evento").max(120, "Máximo 120 caracteres"),
});

const otherChoice = z.object({
  kind: z.literal("other"),
  note: optionalText(200),
});

/** "Avanzado": los campos UTM de hoy (la misma lista cerrada de fuentes y medios). */
const utmChoice = z.object({
  kind: z.literal("utm"),
  source: z.enum(SOURCES, { error: "Elegí una fuente de la lista" }),
  medium: z.union([z.enum(MEDIUMS), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  campaign: optionalText(200),
  content: optionalText(200),
  term: optionalText(200),
});

export const manualChoiceSchema = z.discriminatedUnion("kind", [organicChoice, paidChoice, referralChoice, eventChoice, otherChoice, utmChoice], {
  error: "Elegí de dónde vino",
});

export type ManualChoice = z.output<typeof manualChoiceSchema>;
export type ManualChoiceInput = z.input<typeof manualChoiceSchema>;

export type ManualChoiceParse = { ok: true; choice: ManualChoice } | { ok: false; error: string };

/** Valida lo que mando el navegador. El mensaje de error esta listo para mostrar. */
export function parseManualChoice(raw: unknown): ManualChoiceParse {
  const parsed = manualChoiceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "La atribución no es válida" };
  return { ok: true, choice: parsed.data };
}

/** Los ids que el servidor tiene que comprobar que son del workspace antes de guardar. */
export interface ManualChoiceReferences {
  contentPostId: string | null;
  socialPostId: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  referrerContactId: string | null;
  referrerUserId: string | null;
}

export function manualChoiceReferences(choice: ManualChoice): ManualChoiceReferences {
  const refs: ManualChoiceReferences = {
    contentPostId: null,
    socialPostId: null,
    adId: null,
    adsetId: null,
    campaignId: null,
    referrerContactId: null,
    referrerUserId: null,
  };
  if (choice.kind === "organic" && choice.piece) {
    refs.contentPostId = choice.piece.contentPostId;
    refs.socialPostId = choice.piece.socialPostId;
  }
  if (choice.kind === "paid" && choice.ad) {
    refs.adId = choice.ad.adId;
    refs.adsetId = choice.ad.adsetId;
    refs.campaignId = choice.ad.campaignId;
  }
  if (choice.kind === "referral") {
    if (choice.referrer.type === "contact") refs.referrerContactId = choice.referrer.contactId;
    else refs.referrerUserId = choice.referrer.userId;
  }
  return refs;
}

// ── El toque ─────────────────────────────────────────────────────────────────

/** El toque que registra el servidor: un `TouchInput` con el canal explicito. */
export type ManualSaleTouch = TouchInput & { origin: "manual"; channel: TouchChannel };

export interface ManualTouchContext {
  /** La fecha de la venta: `YYYY-MM-DD` (o un instante, que se lleva a su fecha en la zona del negocio). */
  saleDate: string;
  /** La zona horaria del negocio (IANA). */
  timeZone: string;
  /** El id de la venta, o la `idempotency_key` del asistente si la venta todavia no existe. */
  saleKey: string;
}

const MAX_SALE_KEY = 150;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** El mediodia de la fecha de la venta en la zona del negocio, como instante ISO. Lanza si la fecha no es valida. */
export function manualOccurredAt(saleDate: string, timeZone: string): string {
  const day = DATE_ONLY.test(saleDate) ? saleDate : localDate(saleDate, timeZone);
  const iso = dateInputToIso(day, timeZone);
  if (!iso) throw new RangeError("La fecha de la venta no es válida");
  return iso;
}

/** La clave que evita el segundo toque si el asistente se envia dos veces. */
export function manualDedupeKey(saleKey: string): string {
  return `sale-manual:${saleKey}`;
}

/**
 * La eleccion convertida en el toque a registrar. Lanza `RangeError` si la fecha de la venta o la clave no sirven
 * (son datos del servidor, no de la persona).
 */
export function buildManualTouch(choice: ManualChoice, context: ManualTouchContext): ManualSaleTouch {
  const saleKey = (context.saleKey ?? "").trim();
  if (!saleKey || saleKey.length > MAX_SALE_KEY) throw new RangeError("La clave de la venta no es válida");

  const base = {
    origin: "manual" as const,
    occurredAt: manualOccurredAt(context.saleDate, context.timeZone),
    dedupeKey: manualDedupeKey(saleKey),
  };

  switch (choice.kind) {
    case "organic": {
      const piece = choice.piece;
      return {
        ...base,
        channel: "organic",
        // "Otra" red no es una fuente conocida: queda como alta manual en vez de inventar una.
        source: choice.network === "other" ? "manual" : choice.network,
        medium: "organic_social",
        contentPostId: piece?.contentPostId ?? null,
        socialPostId: piece?.socialPostId ?? null,
        content: piece?.title ?? null,
        raw: { channel: "organic" },
      };
    }

    case "paid":
      return {
        ...base,
        channel: "paid",
        source: choice.network,
        medium: "paid_social",
        adId: choice.ad?.adId ?? null,
        adsetId: choice.ad?.adsetId ?? null,
        campaignId: choice.ad?.campaignId ?? null,
        raw: { channel: "paid" },
      };

    case "referral":
      return {
        ...base,
        channel: "referral",
        source: "referral",
        medium: "referral_person",
        raw: {
          channel: "referral",
          ...(choice.referrer.type === "contact" ? { referrer_contact_id: choice.referrer.contactId } : { referrer_user_id: choice.referrer.userId }),
        },
      };

    case "event":
      return { ...base, channel: "direct", source: "manual", medium: "event", campaign: choice.name, raw: { channel: "direct" } };

    case "other":
      return { ...base, channel: "direct", source: "manual", medium: "other", campaign: choice.note, raw: { channel: "direct" } };

    case "utm": {
      const channel = touchChannel({ origin: "manual", medium: choice.medium, source: choice.source });
      return {
        ...base,
        channel,
        source: choice.source,
        medium: choice.medium,
        campaign: choice.campaign,
        content: choice.content,
        term: choice.term,
        raw: { channel },
      };
    }
  }
}
