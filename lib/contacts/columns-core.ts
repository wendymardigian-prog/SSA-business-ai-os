/**
 * Las columnas de la lista de contactos que salen de la tabla `contacts`.
 * Las de cada área (agendas, ventas…) viven en `./related/*`.
 *
 * El orden de esta lista es el orden de la tabla. Las que existían antes del
 * catálogo arrancan visibles; las nuevas, ocultas.
 */
import { GROUPS } from "./filters/catalog";
import { countryLabel } from "./filters/options";
import type { CellValue, ContactColumnDef, ContactRecord } from "./filters/types";
import { LEAD_TEMPERATURE_LABELS } from "./fields";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const text = (v: unknown): CellValue => {
  const s = str(v);
  return s ? { t: "text", text: s } : null;
};
const day = (v: unknown): CellValue => {
  const s = str(v);
  return s ? { t: "date", at: s, mode: "day" } : null;
};
const handle = (v: unknown): CellValue => {
  const s = str(v);
  return s ? { t: "text", text: `@${s.replace(/^@/, "")}` } : null;
};
const yes = (v: unknown, label: string, tone: "green" | "blue" | "red" | "muted", sub?: string | null): CellValue =>
  v === true ? { t: "badge", text: label, tone, ...(sub ? { sub } : {}) } : null;

/** Una columna de la tabla `contacts` que se arma en el servidor. */
function contactColumn(key: string, label: string, group: ContactColumnDef["group"], cell: (row: ContactRecord) => CellValue, keywords?: string): ContactColumnDef {
  return { key, label, group, hideable: true, defaultVisible: false, source: "contact", cell, keywords };
}

export const CORE_COLUMNS: readonly ContactColumnDef[] = [
  { key: "name", label: "Nombre", group: GROUPS.data, hideable: false, defaultVisible: true, source: "special" },
  { key: "status", label: "Último estado", group: GROUPS.pipeline, hideable: true, defaultVisible: true, source: "special", keywords: "estado" },
  { key: "contact", label: "Email y teléfono", group: GROUPS.data, hideable: true, defaultVisible: true, source: "special", keywords: "contacto" },
  { key: "setter", label: "Setter", group: GROUPS.assignment, hideable: true, defaultVisible: true, source: "special" },
  { key: "vendedor", label: "Vendedor", group: GROUPS.assignment, hideable: true, defaultVisible: true, source: "special", keywords: "closer" },
  { key: "product", label: "Producto de interés", group: GROUPS.pipeline, hideable: true, defaultVisible: true, source: "special" },
  { key: "email_status", label: "Estado de email", group: GROUPS.email, hideable: true, defaultVisible: false, source: "special", keywords: "suscripcion" },
  { key: "tags", label: "Etiquetas", group: GROUPS.tags, hideable: true, defaultVisible: true, source: "special", keywords: "tags" },
  { key: "last_interaction", label: "Última interacción", group: GROUPS.data, hideable: true, defaultVisible: true, source: "special", keywords: "ultima fecha" },

  // Nuevas (bloque 4): todas ocultas hasta que alguien las elija.
  contactColumn("email", "Email", GROUPS.data, (r) => text(r.email), "correo"),
  contactColumn("phone", "Teléfono", GROUPS.data, (r) => text(r.phone)),
  contactColumn("whatsapp", "WhatsApp", GROUPS.data, (r) => text(r.whatsapp_phone)),
  contactColumn("country", "País", GROUPS.data, (r) => {
    const c = str(r.country);
    return c ? { t: "text", text: countryLabel(c) } : null;
  }),
  contactColumn("timezone", "Zona horaria", GROUPS.data, (r) => text(r.timezone), "huso"),
  contactColumn("instagram", "Instagram", GROUPS.data, (r) => handle(r.instagram_username), "redes"),
  contactColumn("tiktok", "TikTok", GROUPS.data, (r) => handle(r.tiktok_username), "redes"),
  contactColumn("twitter", "X (Twitter)", GROUPS.data, (r) => handle(r.twitter_username), "redes twitter"),
  contactColumn("linkedin", "LinkedIn", GROUPS.data, (r) => {
    const url = str(r.linkedin_profile_url);
    return url ? { t: "text", text: url.replace(/^https?:\/\/(www\.)?/, ""), title: url } : null;
  }, "redes"),
  contactColumn("created_at", "Creado", GROUPS.data, (r) => day(r.created_at), "alta fecha"),
  contactColumn("next_followup", "Próximo seguimiento", GROUPS.data, (r) => day(r.next_followup_date), "followup fecha"),
  contactColumn("temperature", "Temperatura", GROUPS.data, (r) => {
    const t = str(r.lead_temperature) as keyof typeof LEAD_TEMPERATURE_LABELS | null;
    if (!t || !(t in LEAD_TEMPERATURE_LABELS)) return null;
    return { t: "badge", text: LEAD_TEMPERATURE_LABELS[t], tone: t === "hot" ? "red" : t === "warm" ? "amber" : "blue" };
  }),
  contactColumn("notes", "Notas", GROUPS.data, (r) => {
    const n = str(r.notes);
    return n ? { t: "text", text: n.length > 80 ? `${n.slice(0, 80)}…` : n, title: n.slice(0, 500) } : null;
  }),
  contactColumn("referred_by", "Referido por", GROUPS.assignment, (r) => {
    const user = str(r.referred_by_user_id);
    if (user) return { t: "member", userId: user };
    const contactId = str(r.referred_by_contact_id);
    return contactId ? { t: "text", text: "Otro contacto", href: `/dashboard/contacts/${contactId}` } : null;
  }, "referencia"),
  { key: "setter_status", label: "Estado de setter", group: GROUPS.pipeline, hideable: true, defaultVisible: false, source: "special" },
  { key: "closer_status", label: "Estado de vendedor", group: GROUPS.pipeline, hideable: true, defaultVisible: false, source: "special", keywords: "closer" },
  contactColumn("last_status_at", "Fecha del último estado", GROUPS.pipeline, (r) => day(r.last_status_at)),
  contactColumn("is_customer", "Cliente", GROUPS.marks, (r) => yes(r.is_customer, "Cliente", "green")),
  contactColumn("is_known", "Conocido", GROUPS.marks, (r) => yes(r.is_known, "Conocido", "blue")),
  contactColumn("do_not_contact", "No contactar", GROUPS.marks, (r) => yes(r.do_not_contact, "No contactar", "red", str(r.do_not_contact_reason)), "baja motivo"),
  contactColumn("is_anonymous", "Sin datos", GROUPS.marks, (r) => yes(r.is_anonymous, "Sin datos", "muted"), "anonimo"),
];

/** Antes de esta clave van los campos personalizados (como antes del catálogo). */
export const CUSTOM_COLUMNS_BEFORE = "tags";
