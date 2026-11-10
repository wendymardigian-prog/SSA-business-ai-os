/**
 * Prellenado de un formulario desde el link firmado (`?c=`): el nombre, el email y el teléfono de la persona a la
 * que se le mandó el link. PURO.
 *
 * El link ya dice de qué contacto es (y de qué servicio y venta). Con eso, el formulario puede abrirse con sus
 * datos puestos para que los revise y los corrija, en vez de pedírselos de cero. Solo viajan estos tres datos
 * (nombre, email, teléfono): nada más del contacto sale al navegador.
 *
 * Qué campo recibe qué dato lo dice el mapeo al contacto del formulario (`contact_config.map`). Si el formulario no
 * tiene mapeo para un dato, se usa el primer campo de ese tipo (el primer email, el primer teléfono). Un nombre de
 * relleno ("Instagram User", un id) no se prellena: no es un dato de la persona.
 */
import { isPlaceholderName } from "@/lib/contacts/anonymous";

export interface LinkPrefillContact {
  display_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
}

export interface LinkPrefillField {
  key: string;
  type: string;
}

export interface LinkPrefillMapEntry {
  fieldKey: string;
  target: string;
}

type Kind = "name" | "email" | "phone";

const TARGET_KIND: Record<string, Kind> = {
  "contact.display_name": "name",
  "contact.email": "email",
  "contact.phone": "phone",
  "contact.whatsapp_phone": "phone",
};

/** Qué tipos de campo pueden recibir cada dato. */
const ACCEPTS: Record<Kind, readonly string[]> = {
  name: ["short_text"],
  email: ["email", "short_text"],
  phone: ["phone", "short_text"],
};

const clean = (v: string | null | undefined): string => (typeof v === "string" ? v.trim() : "");

function valueFor(contact: LinkPrefillContact, kind: Kind, target?: string): string {
  if (kind === "name") {
    const name = clean(contact.display_name).replace(/\s+/g, " ");
    return name && !isPlaceholderName(name) ? name : "";
  }
  if (kind === "email") return clean(contact.email);
  // El campo de WhatsApp prefiere el WhatsApp; el de teléfono, el teléfono. Si falta uno, sirve el otro.
  const phone = clean(contact.phone);
  const whatsapp = clean(contact.whatsapp_phone);
  return target === "contact.whatsapp_phone" ? whatsapp || phone : phone || whatsapp;
}

/**
 * `{ clave del campo → valor }` para el prellenado. Un campo que ya recibió un dato no recibe otro, y un dato que
 * el contacto no tiene no se escribe (queda vacío, como siempre).
 */
export function linkPrefillValues(
  contact: LinkPrefillContact,
  fields: readonly LinkPrefillField[],
  map: readonly LinkPrefillMapEntry[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const covered = new Set<Kind>();

  for (const entry of map) {
    const kind = TARGET_KIND[entry.target];
    const field = byKey.get(entry.fieldKey);
    if (!kind || !field || !ACCEPTS[kind].includes(field.type)) continue;
    covered.add(kind);
    if (out[field.key] !== undefined) continue;
    const value = valueFor(contact, kind, entry.target);
    if (value) out[field.key] = value;
  }

  // Sin mapeo para ese dato: el primer campo del tipo exacto (nunca un texto corto al azar).
  for (const [kind, type] of [["email", "email"], ["phone", "phone"]] as const) {
    if (covered.has(kind)) continue;
    const field = fields.find((f) => f.type === type && out[f.key] === undefined);
    if (!field) continue;
    const value = valueFor(contact, kind);
    if (value) out[field.key] = value;
  }
  return out;
}

/** Saca del prellenado los campos que la URL ya trae: lo que se escribe en la URL gana sobre el link. */
export function withoutUrlOverrides(values: Record<string, string>, params: Record<string, string>): Record<string, string> {
  const inUrl = new Set(Object.keys(params).map((k) => k.toLowerCase()));
  return Object.fromEntries(Object.entries(values).filter(([key]) => !inUrl.has(key.toLowerCase())));
}
