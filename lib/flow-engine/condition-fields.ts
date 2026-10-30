/**
 * Catalogo de campos del nodo Condition, compartido entre el panel y el motor.
 *
 * El panel guardaba `field: "tag"` y el registro busca `"tag:"` — con los dos
 * puntos y el nombre del tag detras. Nunca coincidian, asi que **ninguna**
 * condicion dibujada a mano resolvia: todas caian al fallback de campo
 * personalizado y devolvian undefined. Encima el panel no tenia donde escribir
 * el argumento (que tag, que variable, que secuencia).
 *
 * Este modulo es la unica fuente de esos prefijos. Es puro y sin Supabase, asi
 * que lo importan el panel (cliente) y los tests de consistencia.
 */

import type { ConditionValueType, FieldOption } from "./condition-eval";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/platforms";

/** Que hay que pedirle al usuario despues de elegir el campo. */
export type ConditionArgumentKind =
  /** Nada: el campo se llama exactamente asi. */
  | "none"
  /** Texto libre (nombre de un tag, de una variable, slug de un campo). */
  | "text"
  /** Una secuencia del workspace, elegida de una lista. */
  | "sequence";

/** Que forma tiene el valor a comparar. */
export type ConditionValueKind = "text" | "boolean";

export interface ConditionFieldOption {
  /** Prefijo con dos puntos ("tag:") o nombre exacto ("platform"). */
  prefix: string;
  label: string;
  argument: ConditionArgumentKind;
  argumentLabel?: string;
  argumentPlaceholder?: string;
  valueKind: ConditionValueKind;
  hint?: string;
  /**
   * El tipo con el que se compara en el nodo `branch` ("Condiciones"). El nodo
   * viejo (`condition`) no lo mira: compara texto con `valueKind`.
   */
  valueType: ConditionValueType;
  /** Solo en las selecciones. */
  options?: FieldOption[];
  /** Como se agrupa en el selector de campos del `branch`. */
  group: "contact" | "calls" | "sales";
}

const PLATFORM_OPTIONS: FieldOption[] = PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }));

export const CONDITION_FIELDS: ConditionFieldOption[] = [
  {
    prefix: "tag:",
    label: "Tiene el tag",
    argument: "text",
    argumentLabel: "Nombre del tag",
    argumentPlaceholder: "interesado",
    valueKind: "boolean", valueType: "boolean", group: "contact",
  },
  {
    prefix: "sequence:",
    label: "Está en la secuencia",
    argument: "sequence",
    argumentLabel: "Secuencia",
    valueKind: "boolean", valueType: "boolean", group: "contact",
    hint: "Cuenta si la inscripción sigue viva, aunque esté pausada porque respondió.",
  },
  {
    prefix: "sequence_ever:",
    label: "Estuvo alguna vez en la secuencia",
    argument: "sequence",
    argumentLabel: "Secuencia",
    valueKind: "boolean", valueType: "boolean", group: "contact",
    hint: "Cuenta también las que ya terminaron o se cancelaron.",
  },
  {
    prefix: "platform",
    label: "Canal",
    argument: "none",
    valueKind: "text", valueType: "single_select", group: "contact", options: PLATFORM_OPTIONS,
  },
  {
    prefix: "is_subscribed",
    // Solo las difusiones por chat (broadcasts). La suscripcion a emails es "Estado de email".
    label: "Recibe difusiones por chat",
    argument: "none",
    valueKind: "boolean", valueType: "boolean", group: "contact",
  },
  {
    prefix: "email_status",
    label: "Estado de email",
    argument: "none",
    valueKind: "text", valueType: "single_select", group: "contact",
    options: [
      { value: "subscribed", label: "Suscripto" },
      { value: "unsubscribed", label: "Dado de baja" },
      { value: "bounced", label: "Rebota" },
      { value: "complained", label: "Marcó spam" },
    ],
    hint: "Si la persona puede recibir emails de marketing. Un email de marketing no le llega a quien no está suscripto aunque la automatización lo mande.",
  },
  {
    prefix: "variable:",
    label: "Variable del flow",
    argument: "text",
    argumentLabel: "Nombre de la variable",
    argumentPlaceholder: "ai_response",
    valueKind: "text", valueType: "text", group: "contact",
  },
  // @plantilla-desde(llamadas)
  // Llamadas (F32): todos sobre la ultima llamada analizada del contacto. Sin
  // llamada analizada comparan contra vacio.
  {
    prefix: "last_call_outcome:",
    label: "Resultado de la última llamada",
    argument: "none",
    valueKind: "text", valueType: "text", group: "calls",
    hint: "Por ejemplo: venta, no_venta, seguimiento_con_fecha.",
  },
  {
    prefix: "last_call_lead_score:",
    label: "Puntaje del lead en la última llamada",
    argument: "none",
    valueKind: "text", valueType: "number", group: "calls",
    hint: "Un número de 0 a 100. Se compara con mayor o menor que.",
  },
  {
    prefix: "last_call_type:",
    label: "Tipo de la última llamada",
    argument: "none",
    valueKind: "text", valueType: "text", group: "calls",
    hint: "Por ejemplo: cierre, seguimiento, triaje.",
  },
  // @plantilla-hasta(llamadas)
  // @plantilla-desde(ventas)
  // Ventas (F37): sobre las ventas y los pagos del contacto. Los de `sale_*` miran LA VENTA que
  // disparo el flujo (o, sin ella, la ultima del contacto).
  {
    prefix: "has_active_sale:",
    label: "Tiene una venta activa",
    argument: "text",
    argumentLabel: "Producto o variante (opcional)",
    argumentPlaceholder: "id del producto",
    valueKind: "boolean", valueType: "boolean", group: "sales",
    hint: "Activa = que no esta cancelada, reembolsada ni dada de baja. Sin elegir un producto, mira todas.",
  },
  { prefix: "last_sale_status", label: "Estado de su última venta", argument: "none", valueKind: "text", valueType: "text", group: "sales", hint: "Por ejemplo: paid, overdue, reserved, cancelled." },
  { prefix: "do_not_contact", label: "Está marcado como no contactar", argument: "none", valueKind: "boolean", valueType: "boolean", group: "contact", hint: "Los flujos de cobranza lo usan como puerta." },
  { prefix: "has_overdue_payments", label: "Tiene pagos morosos", argument: "none", valueKind: "boolean", valueType: "boolean", group: "sales" },
  {
    prefix: "late_payments_count:",
    label: "Pagos cobrados con atraso mayor a N días",
    argument: "text",
    argumentLabel: "Más de cuántos días",
    argumentPlaceholder: "7",
    valueKind: "text", valueType: "number", group: "sales",
    hint: "Devuelve una cantidad. Se compara con mayor o menor que.",
  },
  { prefix: "total_purchased", label: "Monto total comprado", argument: "none", valueKind: "text", valueType: "number", group: "sales", hint: "Lo cobrado neto de todas sus ventas, en dólares. Se compara con mayor o menor que." },
  {
    prefix: "sale_utm:",
    label: "UTM de la venta",
    argument: "text",
    argumentLabel: "Cuál: source, medium o campaign",
    argumentPlaceholder: "source",
    valueKind: "text", valueType: "text", group: "sales",
  },
  { prefix: "sale_attribution_type", label: "Tipo de atribución de la venta", argument: "none", valueKind: "text", valueType: "single_select", group: "sales", options: [{ value: "last_touch", label: "Último toque" }, { value: "manual", label: "Manual" }, { value: "none", label: "Sin atribución" }], hint: "last_touch (último toque), manual o none (sin atribución)." },
  { prefix: "sale_from_booking", label: "La venta vino de una agenda", argument: "none", valueKind: "boolean", valueType: "boolean", group: "sales" },
  { prefix: "sale_booking_event_type", label: "Tipo de evento de la agenda de la venta", argument: "none", valueKind: "text", valueType: "text", group: "sales", hint: "El id del tipo de evento de agenda; vacío si la venta no vino de una agenda." },
  // @plantilla-hasta(ventas)
  {
    // Sin prefijo: el campo es el slug del campo personalizado tal cual.
    prefix: "",
    label: "Campo personalizado",
    argument: "text",
    argumentLabel: "Identificador del campo",
    argumentPlaceholder: "presupuesto",
    valueKind: "text", valueType: "text", group: "contact",
  },
];

export function findConditionField(prefix: string): ConditionFieldOption | undefined {
  return CONDITION_FIELDS.find((f) => f.prefix === prefix);
}

/**
 * Parte un `field` guardado en prefijo + argumento.
 *
 * Se prueban los prefijos mas largos primero: sin eso "sequence_ever:abc"
 * podria caer en "sequence:" y evaluar la condicion equivocada.
 */
export function splitConditionField(field: string): { prefix: string; argument: string } {
  const withColon = CONDITION_FIELDS.filter((f) => f.prefix.endsWith(":")).sort(
    (a, b) => b.prefix.length - a.prefix.length
  );

  for (const option of withColon) {
    if (field.startsWith(option.prefix)) {
      return { prefix: option.prefix, argument: field.slice(option.prefix.length) };
    }
  }

  const exact = CONDITION_FIELDS.find((f) => f.prefix !== "" && !f.prefix.endsWith(":") && f.prefix === field);
  if (exact) return { prefix: exact.prefix, argument: "" };

  // Cualquier otra cosa es el slug de un campo personalizado.
  return { prefix: "", argument: field };
}

export function joinConditionField(prefix: string, argument: string): string {
  if (prefix.endsWith(":")) return `${prefix}${argument.trim()}`;
  if (prefix === "") return argument.trim();
  return prefix;
}
