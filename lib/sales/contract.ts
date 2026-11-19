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
import { fromCents, toCents } from "@/lib/shared/money";
import { formatMoney } from "@/lib/shared/format";
import { snapshotText } from "./sale-text";
import { contractDate, type ContractLinkContext } from "@/lib/forms/contract/variables";
import { paymentStatusLabel, paymentTypeLabel } from "./labels";

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
  /** Los pagos de la venta, para `{{venta.plan_pagos}}`. Sin ellos (o null si no se pudieron leer), la variable queda en «—». */
  payments?: readonly ContractPayment[] | null;
}

/** Un pago de la venta tal como lo lee el link firmado (`lib/forms/contract/link-context.ts`). */
export interface ContractPayment {
  type: string;
  status: string;
  amount: unknown;
  due_date: string | null;
  paid_on: string | null;
  paid_at: string | null;
  created_at: string;
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

/**
 * Los datos de la venta y del contacto para las variables del contrato en modo Contrato (`{{contacto.*}}`,
 * `{{venta.*}}`, `lib/forms/contract/variables.ts`). Los mismos valores que el prellenado de siempre.
 */
export function contractLinkValues(sale: ContractSale | null, contact: ContractContact | null, timeZone = "UTC"): ContractLinkContext {
  const empty: ContractContact = { display_name: null, email: null, phone: null };
  const c = contact ?? empty;
  return {
    contacto: { nombre: valueOf("name", saleOrEmpty(sale), c), email: valueOf("email", saleOrEmpty(sale), c), telefono: valueOf("phone", saleOrEmpty(sale), c) },
    venta: sale
      ? {
          producto: valueOf("product", sale, c),
          variante: valueOf("variant", sale, c),
          monto: valueOf("amount", sale, c),
          inicio_servicio: valueOf("service_start", sale, c),
          ...(sale.payments !== undefined ? { plan_pagos: sale.payments ? paymentPlanLines(sale.payments, timeZone) : null } : {}),
        }
      : {},
  };
}

/** `2026-12-03` → «3 de diciembre de 2026». Una fecha civil: se escribe tal cual, sin pasar por ninguna zona. */
function civilDate(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : contractDate(parsed, "UTC");
}

/** El día en que se cobró: `paid_on` (fecha civil) o, si no está, `paid_at` en la zona del negocio. */
function paidDate(payment: ContractPayment, timeZone: string): string | null {
  const civil = civilDate(payment.paid_on);
  if (civil) return civil;
  if (!payment.paid_at) return null;
  const parsed = new Date(payment.paid_at);
  return Number.isNaN(parsed.getTime()) ? null : contractDate(parsed, timeZone);
}

function statusText(payment: ContractPayment, timeZone: string): string {
  const due = civilDate(payment.due_date);
  switch (payment.status) {
    case "paid": {
      const on = paidDate(payment, timeZone);
      return on ? `Cobrado el ${on}` : paymentStatusLabel("paid");
    }
    case "scheduled":
      return due ? `Programado para el ${due}` : paymentStatusLabel("scheduled");
    case "overdue":
      return due ? `Moroso, vencía el ${due}` : paymentStatusLabel("overdue");
    default:
      return paymentStatusLabel(payment.status);
  }
}

/**
 * Los renglones del plan de pagos de una venta (`{{venta.plan_pagos}}`), en texto plano: uno por pago, en orden de
 * vencimiento (los que no tienen fecha, al final; empatados, por alta). Afuera quedan los anulados y las filas de
 * devolución. Las cuotas se numeran «Cuota N de M». Una foto del momento: el contrato firmado no cambia después.
 */
export function paymentPlanLines(payments: readonly ContractPayment[], timeZone = "UTC"): string[] {
  const visible = payments
    .filter((p) => p.status !== "cancelled" && p.type !== "refund")
    .sort((a, b) => {
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date < b.due_date ? -1 : 1;
      }
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    });
  const installments = visible.filter((p) => p.type === "installment").length;
  let installment = 0;
  return visible.map((payment) => {
    const label = payment.type === "installment" ? `Cuota ${++installment} de ${installments}` : paymentTypeLabel(payment.type);
    const amount = `USD ${formatMoney(payment.amount).replace("$", "")}`;
    return `${label} — ${amount} — ${statusText(payment, timeZone)}`;
  });
}

function saleOrEmpty(sale: ContractSale | null): ContractSale {
  return sale ?? { product_snapshot: null, final_amount: null, service_starts_at: null };
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
