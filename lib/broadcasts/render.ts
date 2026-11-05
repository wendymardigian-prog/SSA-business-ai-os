/**
 * El mensaje de un broadcast para UN destinatario. Puro: lo usan la vista previa
 * (en el navegador) y el despachador (en el servidor), así lo que se ve es lo que sale.
 *
 * - Variables del contacto, del negocio y de los campos personalizados:
 *   `{{contact.first_name}}`, `{{workspace.name}}`, `{{custom.<slug>}}`.
 * - Valor de respaldo: `{{contact.first_name|amigo}}` usa "amigo" si el dato
 *   está vacío. Sin respaldo, un dato vacío deja un hueco y se cuenta en
 *   `missing` (el broadcast puede saltear a ese contacto).
 * - Un nombre que es un relleno (el id de la plataforma o un "@usuario", ver
 *   `isPlaceholderName`) cuenta como vacío: "Hola 1784…" es peor que "Hola amigo".
 * - Lo que no es de estas tres raíces (por ejemplo `{{unsubscribe_url}}`) queda
 *   tal cual: lo resuelve después quien envía.
 * - Variantes: cada destinatario tiene la suya (`pickVariant`, estable por id),
 *   así un reintento manda el mismo texto.
 */

import { resolveVariablePath } from "@/lib/flow-engine/interpolate";
import { firstNameOf } from "@/lib/flow-engine/variable-catalog";
import { isPlaceholderName } from "@/lib/contacts/anonymous";
import { displayCustomValue } from "@/lib/custom-fields";
import { dropDanglingComma, escapeHtml, finalizeEmailHtml, isHtmlTemplate, withPreheader } from "@/lib/email/html";

export const MAX_VARIANTS = 5;
export const MAX_VARIANT_LENGTH = 4000;

/** Las raíces que resuelve un broadcast. Lo demás no se toca. */
const ROOTS = new Set(["contact", "workspace", "custom"]);

const TOKEN = /\{\{\s*([\w-]+(?:\.[\w-]+)*)\s*(?:\|([^{}]*))?\}\}/g;

export const BROADCAST_CONTACT_VARIABLES = [
  "contact.first_name",
  "contact.display_name",
  "contact.email",
  "contact.phone",
  "workspace.name",
] as const;

/** Las variables que ofrece el editor: las fijas y una por campo personalizado. */
export function broadcastVariableList(customFields: readonly { slug: string }[]): string[] {
  return [...BROADCAST_CONTACT_VARIABLES, ...customFields.map((f) => `custom.${f.slug}`)];
}

export interface RenderContact {
  display_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_phone?: string | null;
}

export interface RenderCustomField {
  slug: string;
  type: string;
}

/** El objeto de variables de un contacto. `customValues` es slug → valor guardado. */
export function broadcastVariables(
  contact: RenderContact,
  workspace: { name: string | null },
  customFields: readonly RenderCustomField[] = [],
  customValues: Readonly<Record<string, string | null>> = {},
): Record<string, unknown> {
  const realName = contact.display_name && !isPlaceholderName(contact.display_name) ? contact.display_name.trim() : "";
  const custom: Record<string, string> = {};
  for (const f of customFields) custom[f.slug] = displayCustomValue(f.type, customValues[f.slug] ?? null);
  return {
    contact: {
      display_name: realName,
      name: realName,
      first_name: firstNameOf(realName),
      email: contact.email ?? "",
      phone: contact.phone ?? contact.whatsapp_phone ?? "",
    },
    workspace: { name: workspace.name ?? "" },
    custom,
  };
}

export interface Rendered {
  text: string;
  /** Las variables que quedaron vacías y no tenían respaldo (sin repetir). */
  missing: string[];
}

/** Pega las variables. Con `escape`, cada valor se escapa como HTML (el respaldo también). */
export function renderTemplate(template: string, variables: Record<string, unknown>, escape = false): Rendered {
  const missing = new Set<string>();
  const text = template.replace(TOKEN, (token, path: string, fallback: string | undefined) => {
    if (!ROOTS.has(path.split(".")[0])) return token;
    const value = resolveVariablePath(variables, path);
    const str = value === null || value === undefined ? "" : typeof value === "object" ? "" : String(value).trim();
    const out = str !== "" ? str : (fallback ?? "").trim();
    if (out === "" && fallback === undefined) missing.add(path);
    return escape ? escapeHtml(out) : out;
  });
  return { text, missing: [...missing] };
}

/** Las variables que usa un texto (para avisar cuáles no tienen respaldo). */
export function templateVariables(template: string): { path: string; hasFallback: boolean }[] {
  const out = new Map<string, boolean>();
  for (const m of template.matchAll(TOKEN)) {
    if (!ROOTS.has(m[1].split(".")[0])) continue;
    out.set(m[1], (out.get(m[1]) ?? false) || m[2] !== undefined);
  }
  return [...out].map(([path, hasFallback]) => ({ path, hasFallback }));
}

/** Variables que el broadcast no sabe resolver (una errata como `{{contact.nombre}}`). */
export function unknownVariables(template: string, customFields: readonly { slug: string }[]): string[] {
  const known = new Set<string>([...broadcastVariableList(customFields), "contact.name"]);
  return templateVariables(template)
    .map((v) => v.path)
    .filter((p) => !known.has(p));
}

/** FNV-1a de 32 bits: la misma variante para el mismo destinatario, siempre. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickVariant(seed: string, count: number): number {
  if (count <= 1) return 0;
  return hash(seed) % count;
}

/** Las variantes que valen: con texto, sin pasar el máximo. */
export function cleanVariants(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.slice(0, MAX_VARIANT_LENGTH))
    .filter((v) => v.trim() !== "")
    .slice(0, MAX_VARIANTS);
}

/** Un mensaje de chat (WhatsApp): texto plano. */
export function renderChatMessage(variants: readonly string[], variantIndex: number, variables: Record<string, unknown>): Rendered {
  const template = variants[variantIndex] ?? variants[0] ?? "";
  return renderTemplate(template, variables, false);
}

/**
 * Un email: el asunto en texto y el cuerpo listo para el proveedor. Si el cuerpo
 * es HTML lo decide la PLANTILLA (nunca el texto ya pegado), los valores se
 * escapan y el resultado se limpia (`finalizeEmailHtml`). El preheader se pega
 * sin escapar y lo escapa `withPreheader`, que lo pone sobre lo ya limpio.
 */
export function renderEmail(
  subject: string,
  body: string,
  variables: Record<string, unknown>,
  preheader?: string | null,
): { subject: string; preheader: string; html: string; missing: string[] } {
  const s = renderTemplate(subject, variables, false);
  const wasHtml = isHtmlTemplate(body);
  const b = renderTemplate(body, variables, wasHtml);
  const p = renderTemplate(preheader ?? "", variables, false);
  const previewLine = dropDanglingComma(preheader ?? "", p.text).replace(/\s+/g, " ").trim();
  return {
    subject: dropDanglingComma(subject, s.text).replace(/\s+/g, " ").trim(),
    preheader: previewLine,
    html: withPreheader(dropDanglingComma(body, finalizeEmailHtml(b.text, wasHtml)), previewLine),
    missing: [...new Set([...s.missing, ...b.missing, ...p.missing])],
  };
}
