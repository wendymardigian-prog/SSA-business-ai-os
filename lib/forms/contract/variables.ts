/**
 * Las variables del contrato en modo "Contrato" (21/10/2026). PURO: lo usan el editor (insertar y validar), la página
 * pública (mostrar el paso 2) y el servidor al firmar (armar el texto que se guarda).
 *
 * Una variable es `{{nombre}}` dentro del texto: `{{respuesta.<clave>}}` (lo que la persona contestó en el paso 1),
 * `{{contacto.*}}` y `{{venta.*}}` (solo con un link firmado desde una venta), `{{negocio.nombre}}` y `{{fecha}}`
 * (el día de la firma). Una variable que no está en esta lista no deja publicar.
 *
 * `{{venta.plan_pagos}}` es la única con VARIOS renglones (un pago por renglón): sola en su renglón se vuelve una
 * lista numerada; dentro de una frase, una sola línea separada por «; ».
 *
 * El texto final lo arma SIEMPRE el servidor (`renderContractTemplate`) con la plantilla congelada de la versión y
 * las respuestas ya validadas; la base comprueba con `contract_render_matches` (la gemela de `renderMatchesTemplate`)
 * que sea la plantilla con solo los huecos completados. Lo que manda el navegador nunca entra.
 */
import { escapeInline } from "./editor-markdown";

/** `{{respuesta.empresa}}`, `{{ fecha }}`. Mismo patrón que la base (00242). */
export const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export const FIXED_VARIABLES: ReadonlyArray<{ name: string; label: string; needsLink?: boolean }> = [
  { name: "contacto.nombre", label: "Nombre del contacto", needsLink: true },
  { name: "contacto.email", label: "Email del contacto", needsLink: true },
  { name: "contacto.telefono", label: "Teléfono del contacto", needsLink: true },
  { name: "venta.producto", label: "Producto de la venta", needsLink: true },
  { name: "venta.variante", label: "Variante de la venta", needsLink: true },
  { name: "venta.monto", label: "Monto de la venta (USD)", needsLink: true },
  { name: "venta.inicio_servicio", label: "Inicio del servicio", needsLink: true },
  { name: "venta.plan_pagos", label: "Plan de pagos de la venta", needsLink: true },
  { name: "negocio.nombre", label: "Nombre del negocio" },
  { name: "fecha", label: "Fecha de la firma" },
];

/** Lo que se muestra en lugar de un dato que no hay (una pregunta opcional sin responder, una venta que no vino). */
export const MISSING_VALUE = "—";

/** Las variables que usa un texto, sin repetir y en orden. */
export function templateVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) seen.add(match[1]);
  return [...seen];
}

/** Las variables que se pueden usar con estas preguntas (para el menú "Insertar variable"). */
export function availableVariables(fieldKeys: readonly string[]): string[] {
  return [...fieldKeys.map((key) => `respuesta.${key}`), ...FIXED_VARIABLES.map((v) => v.name)];
}

/** Las que el texto usa y no existen (una pregunta borrada, un nombre mal escrito). */
export function unknownVariables(template: string, fieldKeys: readonly string[]): string[] {
  const known = new Set(availableVariables(fieldKeys));
  return templateVariables(template).filter((name) => !known.has(name));
}

/**
 * Un valor dentro del Markdown del contrato: en una sola línea (un salto podría abrir una lista o un título) y con los
 * caracteres de formato escapados (una respuesta con `**` no se vuelve negrita).
 */
export function markdownValue(value: string | null | undefined): string {
  const flat = (value ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
  return flat ? escapeInline(flat) : MISSING_VALUE;
}

/** El valor de una variable: un texto, o varios renglones (el plan de pagos). */
export type ContractValue = string | readonly string[] | null | undefined;

/** Una variable sola en su renglón (sin nada más que espacios alrededor). */
const ALONE_ON_LINE = /^(\s*)\{\{\s*([a-zA-Z][\w.]*)\s*\}\}\s*$/;

/** Varios renglones dentro de una frase: una sola línea separada por «; ». */
function inlineValue(value: ContractValue): string {
  if (Array.isArray(value)) return value.length > 0 ? value.map((line) => markdownValue(line)).join("; ") : MISSING_VALUE;
  return markdownValue(value as string | null | undefined);
}

/**
 * El texto con cada variable reemplazada por su valor (o "—" si no hay). Los pedazos fijos quedan intactos. Un valor de
 * varios renglones sola en su renglón se escribe como lista numerada (`1. …`), cada renglón escapado.
 */
export function renderContractTemplate(template: string, values: Readonly<Record<string, ContractValue>>): string {
  // Sin ningún valor de varios renglones, exactamente el reemplazo de siempre (los contratos de antes no cambian ni un byte).
  if (!Object.values(values).some((value) => Array.isArray(value) && value.length > 0)) {
    return template.replace(VARIABLE_PATTERN, (_token, name: string) => inlineValue(values[name]));
  }
  return template
    .split("\n")
    .map((line) => {
      const alone = ALONE_ON_LINE.exec(line.replace(/\r$/, ""));
      const value = alone ? values[alone[2]] : undefined;
      if (alone && Array.isArray(value) && value.length > 0) {
        const items = value.map((item, i) => `${i + 1}. ${markdownValue(item)}`).join("\n");
        return line.replace(/\{\{\s*[a-zA-Z][\w.]*\s*\}\}/, () => items);
      }
      return line.replace(VARIABLE_PATTERN, (_token, name: string) => inlineValue(values[name]));
    })
    .join("\n");
}

/**
 * ¿`rendered` es `template` con SOLO los huecos completados? Gemela de `public.contract_render_matches` (00242): los
 * pedazos fijos tienen que estar todos, en orden; el primero al principio y el último al final. Garantiza que el
 * texto fijo del contrato no cambió; lo que va en el lugar de una variable no lo puede juzgar (por eso lo arma solo
 * el servidor, nunca el navegador).
 */
export function renderMatchesTemplate(template: string, rendered: string): boolean {
  const parts = template.split(/\{\{\s*[a-zA-Z][\w.]*\s*\}\}/);
  if (parts.length === 1) return template === rendered;
  if (!rendered.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    const at = rendered.indexOf(part, pos);
    if (at === -1) return false;
    pos = at + part.length;
  }
  const last = parts[parts.length - 1];
  return rendered.endsWith(last) && rendered.length - last.length >= pos;
}

/** El día de la firma, como se escribe en un contrato ("21 de octubre de 2026"), en la zona del negocio. */
export function contractDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  }
}

export interface ContractLinkContext {
  contacto?: { nombre?: string | null; email?: string | null; telefono?: string | null };
  venta?: {
    producto?: string | null;
    variante?: string | null;
    monto?: string | null;
    inicio_servicio?: string | null;
    /** Un renglón por pago (`paymentPlanLines`); null si no se pudieron leer. */
    plan_pagos?: readonly string[] | null;
  };
}

/** Todos los valores de las variables: las respuestas (ya en texto), el link firmado, el negocio y la fecha. */
export function contractValues(input: {
  answers: Readonly<Record<string, string>>;
  link?: ContractLinkContext | null;
  businessName: string;
  date: string;
}): Record<string, string | readonly string[] | null> {
  const values: Record<string, string | readonly string[] | null> = {};
  for (const [key, value] of Object.entries(input.answers)) values[`respuesta.${key}`] = value;
  const c = input.link?.contacto;
  const v = input.link?.venta;
  values["contacto.nombre"] = c?.nombre ?? null;
  values["contacto.email"] = c?.email ?? null;
  values["contacto.telefono"] = c?.telefono ?? null;
  values["venta.producto"] = v?.producto ?? null;
  values["venta.variante"] = v?.variante ?? null;
  values["venta.monto"] = v?.monto ?? null;
  values["venta.inicio_servicio"] = v?.inicio_servicio ?? null;
  values["venta.plan_pagos"] = v?.plan_pagos ?? null;
  values["negocio.nombre"] = input.businessName;
  values["fecha"] = input.date;
  return values;
}
