/**
 * A qué número va «Enviar WhatsApp a un número» (Tirón 2, D3). PURO y sin base ni red: lo importan el paso (servidor), el
 * simulador y el editor (navegador), así los tres leen el destino igual.
 */
import { interpolateVariables } from "./interpolate";
import { normalizePhone } from "@/lib/phone";

export interface WhatsAppTargetData {
  to?: "fixed" | "variable";
  /** Solo `to: "fixed"`: el número tal como lo escribió la persona. */
  fixedPhone?: string;
  /** Solo `to: "variable"`: `{{webhook.payload.telefono}}` (también se acepta sin las llaves). */
  toVariable?: string;
}

export type TargetResolution = { ok: true; phone: string } | { ok: false; reason: string };

/** El número al que va: el fijo o el de la variable, normalizado. Puro. */
export function resolveWhatsAppTarget(data: WhatsAppTargetData, variables: Record<string, unknown>): TargetResolution {
  const mode = data.to ?? "fixed";
  let raw: string;
  if (mode === "variable") {
    const template = (data.toVariable ?? "").trim();
    if (!template) return { ok: false, reason: "No elegiste de qué variable sale el número." };
    const wrapped = /\{\{[^}]+\}\}/.test(template) ? template : `{{${template}}}`;
    raw = interpolateVariables(wrapped, variables).trim();
    // Una variable que no existe queda escrita tal cual (`{{algo}}`): tampoco es un número.
    if (!raw || hasUnresolvedVariable(raw)) return { ok: false, reason: "La variable del número no existe o está vacía." };
  } else {
    raw = (data.fixedPhone ?? "").trim();
    if (!raw) return { ok: false, reason: "Falta el número de WhatsApp." };
  }
  const phone = normalizePhone(raw);
  if (!phone) return { ok: false, reason: "El número no es válido (tiene que ser un número internacional, con código de país)." };
  return { ok: true, phone };
}

/** Una variable que quedó sin resolver (`{{algo}}` literal) no es un número: se detecta antes de normalizar. */
export function hasUnresolvedVariable(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}

