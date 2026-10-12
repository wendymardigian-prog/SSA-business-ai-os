/**
 * El contexto sobre el que se evalúan las condiciones de asignación (plano F14).
 *
 * Se arma SOBRE `readAttribution(contact.attribution)`: los UTMs del primer y del
 * último toque canónicos. Nunca columnas `utm_*` planas (el v1.1 de prevxcrm las
 * leía de ahí). Un contacto cuya atribución está en la forma vieja produce
 * `first_source`, no `first_utm_source`.
 *
 * Todos los valores son texto: lo que falta es "" (así `is_empty` funciona).
 */
import { readAttribution, type AttributionTouch } from "@/lib/contacts/attribution";
import { MEDIUM_LABELS, MEDIUMS, SOURCE_LABELS, SOURCES, mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";

export const TOUCH_FIELDS = [
  "source",
  "medium",
  "campaign",
  "content",
  "term",
  "ad_id",
  "adset_id",
  "campaign_id",
  "fbclid",
  "gclid",
  "ttclid",
  "referrer_url",
  "landing_page",
  "origin",
  "social_post_id",
  "content_post_id",
] as const;

export type AssignmentContext = Record<string, string>;

export interface ContactForAssignment {
  attribution: unknown;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp_phone?: string | null;
}

export interface ContextExtras {
  /** La plataforma de la conversación más reciente del contacto (la pasa quien llama). */
  channel?: string | null;
}

/** `source|medium|campaign|content|term` del toque, en minúsculas. */
function combined(touch: AttributionTouch | undefined): string {
  if (!touch) return "";
  return [touch.source, touch.medium, touch.campaign, touch.content, touch.term].map((v) => (v ?? "").toLowerCase()).join("|");
}

export function buildAssignmentContext(contact: ContactForAssignment, extras: ContextExtras = {}): AssignmentContext {
  const attribution = readAttribution(contact.attribution);
  const ctx: AssignmentContext = {};

  for (const [prefix, touch] of [["first", attribution.first_touch], ["last", attribution.last_touch]] as const) {
    for (const field of TOUCH_FIELDS) {
      ctx[`${prefix}_${field}`] = (touch?.[field as keyof AttributionTouch] as string | undefined) ?? "";
    }
    ctx[`${prefix}_combined`] = combined(touch);
  }

  ctx.country = (contact.country ?? "").trim();
  ctx.channel = (extras.channel ?? "").trim();
  ctx.has_email = contact.email && contact.email.trim() ? "true" : "false";
  ctx.has_phone = (contact.phone && contact.phone.trim()) || (contact.whatsapp_phone && contact.whatsapp_phone.trim()) ? "true" : "false";
  return ctx;
}

export interface ContextFieldDef {
  value: string;
  label: string;
  group: "Primer toque" | "Último toque" | "Contacto";
  /** Si el campo tiene una lista cerrada (taxonomía), sus opciones para el selector del valor. */
  options?: Array<{ value: string; label: string }>;
}

const FIELD_LABELS: Record<string, string> = {
  source: "fuente",
  medium: "medio",
  campaign: "campaña",
  content: "contenido",
  term: "término",
  ad_id: "ID del anuncio",
  adset_id: "ID del conjunto",
  campaign_id: "ID de la campaña",
  fbclid: "fbclid",
  gclid: "gclid",
  ttclid: "ttclid",
  referrer_url: "página de origen",
  landing_page: "página de aterrizaje",
  origin: "origen",
  social_post_id: "publicación",
  content_post_id: "pieza de contenido",
};

const SOURCE_OPTIONS = SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));
const MEDIUM_OPTIONS = MEDIUMS.map((m) => ({ value: m, label: MEDIUM_LABELS[m] }));

/** Los campos que ofrece el constructor de condiciones, con sus etiquetas y la taxonomía cerrada donde corresponde. */
export const ASSIGNMENT_FIELDS: ContextFieldDef[] = [
  ...(["Primer toque", "Último toque"] as const).flatMap((group) => {
    const prefix = group === "Primer toque" ? "first" : "last";
    const label = (text: string) => `${group.startsWith("Primer") ? "Primer" : "Último"} toque: ${text}`;
    return [
      ...TOUCH_FIELDS.map((f) => ({
        value: `${prefix}_${f}`,
        label: label(FIELD_LABELS[f]),
        group,
        ...(f === "source" ? { options: SOURCE_OPTIONS } : f === "medium" ? { options: MEDIUM_OPTIONS } : {}),
      })),
      { value: `${prefix}_combined`, label: label("todo junto (fuente|medio|campaña|contenido|término)"), group },
    ];
  }),
  { value: "country", label: "País", group: "Contacto" },
  { value: "channel", label: "Canal de la conversación", group: "Contacto" },
  { value: "has_email", label: "Tiene email (true / false)", group: "Contacto" },
  { value: "has_phone", label: "Tiene teléfono (true / false)", group: "Contacto" },
];

export const ASSIGNMENT_FIELD_KEYS: string[] = ASSIGNMENT_FIELDS.map((f) => f.value);

/** El texto de un valor del contexto para mostrar (probador): fuente y medio con su etiqueta. */
export function contextValueLabel(field: string, value: string): string {
  if (!value) return "—";
  if (field.endsWith("_source")) return sourceLabel(value);
  if (field.endsWith("_medium")) return mediumLabel(value);
  return value;
}
