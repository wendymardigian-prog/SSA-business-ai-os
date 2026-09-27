/**
 * Países y prefijos para los inputs de teléfono (F20).
 *
 * Decisión de Wendy: todo input de teléfono lleva un selector de país, así
 * los números se guardan siempre con prefijo internacional. Esta es la lista
 * del selector; vive en código (no es una tabla de la base). El valor
 * validado es siempre `+<dígitos>` (E.164), como lo guarda `contacts.phone`.
 */
import { normalizePhone } from "@/lib/phone";

export interface PhoneCountry {
  /** ISO 3166-1 alfa-2. */
  code: string;
  /** Prefijo internacional, sin "+". */
  dial: string;
  label: string;
}

export const DEFAULT_PHONE_COUNTRY = "CR";

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "CR", dial: "506", label: "Costa Rica" },
  { code: "AR", dial: "54", label: "Argentina" },
  { code: "MX", dial: "52", label: "México" },
  { code: "CO", dial: "57", label: "Colombia" },
  { code: "CL", dial: "56", label: "Chile" },
  { code: "PE", dial: "51", label: "Perú" },
  { code: "EC", dial: "593", label: "Ecuador" },
  { code: "UY", dial: "598", label: "Uruguay" },
  { code: "PY", dial: "595", label: "Paraguay" },
  { code: "BO", dial: "591", label: "Bolivia" },
  { code: "VE", dial: "58", label: "Venezuela" },
  { code: "PA", dial: "507", label: "Panamá" },
  { code: "GT", dial: "502", label: "Guatemala" },
  { code: "SV", dial: "503", label: "El Salvador" },
  { code: "HN", dial: "504", label: "Honduras" },
  { code: "NI", dial: "505", label: "Nicaragua" },
  { code: "DO", dial: "1", label: "República Dominicana" },
  { code: "PR", dial: "1", label: "Puerto Rico" },
  { code: "US", dial: "1", label: "Estados Unidos" },
  { code: "CA", dial: "1", label: "Canadá" },
  { code: "BR", dial: "55", label: "Brasil" },
  { code: "ES", dial: "34", label: "España" },
  { code: "PT", dial: "351", label: "Portugal" },
  { code: "IT", dial: "39", label: "Italia" },
  { code: "FR", dial: "33", label: "Francia" },
  { code: "DE", dial: "49", label: "Alemania" },
  { code: "GB", dial: "44", label: "Reino Unido" },
];

export function findPhoneCountry(code: string | null | undefined): PhoneCountry | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return PHONE_COUNTRIES.find((c) => c.code === upper) ?? null;
}

/** Lo que manda el input: el número solo (ya internacional) o país + número local. */
export type PhoneInput = string | { country?: string | null; number: string };

/**
 * Arma `+<prefijo><número>` y valida que quede E.164 (8 a 15 dígitos).
 *
 * - Un string que ya empieza con `+` o `00` se toma como internacional.
 * - Un string sin prefijo usa `defaultCountry`.
 * - Un objeto usa su país; si no lo trae, `defaultCountry`.
 * - Un país desconocido, o un número sin país ni prefijo, es null.
 * - Un cero inicial del número local (habitual en Argentina) se quita.
 */
export function normalizePhoneWithCountry(
  input: PhoneInput | null | undefined,
  defaultCountry: string | null = DEFAULT_PHONE_COUNTRY,
): string | null {
  if (input === null || input === undefined) return null;

  const raw = typeof input === "string" ? input : input.number;
  const countryCode = typeof input === "string" ? defaultCountry : (input.country ?? defaultCountry);
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.startsWith("+") || compact.startsWith("00")) return normalizePhone(compact);

  const country = findPhoneCountry(countryCode);
  if (!country) return null;

  const digits = compact.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  return normalizePhone(`+${country.dial}${digits}`);
}

/** Verdadero si es un `+<dígitos>` E.164 tal como se guarda. */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+\d{8,15}$/.test(value);
}
