/**
 * Enviar el contrato desde la venta (plano F26b). Puro.
 *
 * Formularios prellena SOLO por parámetros de URL (`prefillFromParams`): cada campo declara
 * con qué nombres se puede prellenar (`field.prefill.params`, o su propia clave por defecto).
 * `buildContractPrefill` mira qué campos del contrato declaran un nombre conocido (nombre,
 * email, teléfono, producto, variante, monto, inicio del servicio) y devuelve los parámetros
 * que hay que sumar al link firmado. Lo que el formulario no declara se ignora. El `sale_id`
 * NUNCA va como parámetro suelto: viaja dentro del token firmado (`signFormLink`).
 */
import { effectivePrefill } from "@/lib/forms/prefill";
import type { FormField } from "@/lib/forms/fields";
import { fromCents, toCents } from "./money";
import { snapshotText } from "./sale-text";

export type ContractConceptKey = "name" | "email" | "phone" | "product" | "variant" | "amount" | "service_start";

export const CONTRACT_CONCEPTS: ReadonlyArray<{ key: ContractConceptKey; label: string; params: readonly string[] }> = [
  { key: "name", label: "Nombre", params: ["nombre", "name", "full_name", "display_name", "nombre_completo"] },
  { key: "email", label: "Email", params: ["email", "correo", "mail"] },
  { key: "phone", label: "Teléfono", params: ["telefono", "phone", "whatsapp", "tel", "celular"] },
  { key: "product", label: "Producto", params: ["producto", "product"] },
  { key: "variant", label: "Variante", params: ["variante", "variant"] },
  { key: "amount", label: "Monto", params: ["monto", "amount", "precio", "price", "total"] },
  { key: "service_start", label: "Inicio del servicio", params: ["inicio_servicio", "inicio", "fecha_inicio", "service_start", "start_date"] },
];

export interface ContractSale {
  product_snapshot: unknown;
  final_amount: unknown;
  service_starts_at: string | null;
}

export interface ContractContact {
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ContractPrefill {
  /** Los parámetros a sumar al link, con el nombre exacto que declara cada campo. */
  params: Record<string, string>;
  /** Para mostrar en el modal: qué se va a prellenar y con qué. */
  preview: Array<{ label: string; value: string; fieldKey: string }>;
}

function valueOf(key: ContractConceptKey, sale: ContractSale, contact: ContractContact): string | null {
  const snapshot = (sale.product_snapshot ?? {}) as { product_name?: unknown; variant_name?: unknown };
  switch (key) {
    case "name": return contact.display_name?.trim() || null;
    case "email": return contact.email?.trim() || null;
    case "phone": return contact.phone?.trim() || null;
    case "product": return typeof snapshot.product_name === "string" ? snapshot.product_name : snapshotText(sale.product_snapshot);
    case "variant": return typeof snapshot.variant_name === "string" ? snapshot.variant_name : null;
    case "amount": return fromCents(toCents(sale.final_amount)).toFixed(2);
    case "service_start": return sale.service_starts_at || null;
  }
}

export function buildContractPrefill(sale: ContractSale, contact: ContractContact, fields: readonly FormField[]): ContractPrefill {
  const params: Record<string, string> = {};
  const preview: ContractPrefill["preview"] = [];

  for (const concept of CONTRACT_CONCEPTS) {
    const value = valueOf(concept.key, sale, contact);
    if (!value) continue;
    for (const field of fields) {
      const declared = effectivePrefill(field)?.params ?? [];
      const match = declared.find((p) => concept.params.includes(p.toLowerCase()));
      if (!match || match in params) continue;
      params[match] = value;
      preview.push({ label: concept.label, value, fieldKey: field.key });
      break;
    }
  }
  return { params, preview };
}

export interface SentContract {
  form_id: string;
  sent_at: string;
}

export interface SignedContract {
  form_id: string;
  signed_at: string;
}

/** Los formularios enviados que todavía no tienen una firma posterior al envío: «Enviado sin firmar». */
export function unsignedContracts(sent: readonly SentContract[], signatures: readonly SignedContract[]): SentContract[] {
  const latestByForm = new Map<string, SentContract>();
  for (const s of sent) {
    const current = latestByForm.get(s.form_id);
    if (!current || Date.parse(s.sent_at) > Date.parse(current.sent_at)) latestByForm.set(s.form_id, s);
  }
  return [...latestByForm.values()].filter(
    (s) => !signatures.some((sig) => sig.form_id === s.form_id && Date.parse(sig.signed_at) >= Date.parse(s.sent_at)),
  );
}

/** El texto que se manda por mensaje o email, con el link ya armado. */
export function contractMessage(input: { contactName: string | null; formName: string; url: string }): string {
  const first = (input.contactName ?? "").trim().split(/\s+/)[0];
  return `${first ? `Hola ${first}! ` : "Hola! "}Te dejo el link para firmar ${input.formName}: ${input.url}`;
}
