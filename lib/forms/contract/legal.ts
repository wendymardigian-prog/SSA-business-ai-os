/**
 * Los datos de aceptación de un contrato (F26). PURO.
 *
 * Lo que es evidencia sale del SERVIDOR (la IP del pedido, el `User-Agent` de la
 * cabecera, la hora): el navegador solo aporta lo que declara (zona horaria e
 * idioma), y así se guarda, como "declarado". La IP se guarda en claro SOLO acá
 * (es evidencia legal); en el resto del sistema va hasheada.
 */

export interface ParsedUserAgent {
  device: "mobile" | "tablet" | "desktop" | "unknown";
  os: string;
  browser: string;
}

/** Reglas simples y sin dependencias: alcanzan para decir "iPhone, iOS, Safari". */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const text = (ua ?? "").slice(0, 400);
  if (!text.trim()) return { device: "unknown", os: "Desconocido", browser: "Desconocido" };

  let os = "Desconocido";
  if (/iPhone|iPad|iPod/i.test(text)) os = "iOS";
  else if (/Android/i.test(text)) os = "Android";
  else if (/Windows/i.test(text)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(text)) os = "macOS";
  else if (/CrOS/i.test(text)) os = "ChromeOS";
  else if (/Linux/i.test(text)) os = "Linux";

  let device: ParsedUserAgent["device"] = "desktop";
  if (/iPad|Tablet/i.test(text) || (/Android/i.test(text) && !/Mobile/i.test(text))) device = "tablet";
  else if (/iPhone|iPod|Mobile|Android/i.test(text)) device = "mobile";

  // El orden importa: Edge, Opera y Chrome en iOS traen "Safari"; Chrome trae "Safari".
  let browser = "Desconocido";
  if (/EdgiOS|Edg\//i.test(text)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(text)) browser = "Opera";
  else if (/FxiOS|Firefox/i.test(text)) browser = "Firefox";
  else if (/CriOS|Chrome\//i.test(text)) browser = "Chrome";
  else if (/Safari\//i.test(text)) browser = "Safari";

  return { device, os, browser };
}

export interface LegalInput {
  ip: string | null;
  userAgent: string | null;
  timezone?: string | null;
  locale?: string | null;
  attribution?: Record<string, unknown>;
  acceptedLabel: string;
  signatureStrokes: number;
}

const str = (value: unknown, max = 300): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** El `legal` jsonb de `contract_signatures`. */
export function buildLegal(input: LegalInput): Record<string, unknown> {
  const parsed = parseUserAgent(input.userAgent);
  const attribution = input.attribution ?? {};
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = str(attribution[key]);
    if (value) utm[key] = value;
  }
  return {
    ip: str(input.ip, 64),
    user_agent: str(input.userAgent, 300),
    device: parsed.device,
    os: parsed.os,
    browser: parsed.browser,
    // Declarados por el navegador: no son evidencia, y se rotulan así en el PDF.
    timezone: str(input.timezone, 64),
    locale: str(input.locale, 35),
    utm,
    referrer: str(attribution.referrer_url, 500),
    landing: str(attribution.landing_page, 500),
    accepted_label: input.acceptedLabel.slice(0, 200),
    signature_strokes: Math.max(0, Math.round(input.signatureStrokes || 0)),
  };
}

export const DEVICE_LABELS: Record<ParsedUserAgent["device"], string> = {
  mobile: "Teléfono",
  tablet: "Tablet",
  desktop: "Computadora",
  unknown: "Desconocido",
};
