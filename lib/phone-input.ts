/**
 * El campo de teléfono con país (`components/ui/phone-input.tsx`), puro: separa un teléfono guardado en país + número
 * y los vuelve a juntar. Lo que se guarda es siempre `+<dígitos>` (E.164); quien usa el campo sigue validando como
 * antes (`isE164`, `normalizePhone`).
 *
 * El país sale del prefijo (`countryFromPhone`). Si es de un país que no está en la lista del selector
 * (`PHONE_COUNTRIES`), el campo queda en «Otro» con el número entero, con su +: nunca se pierde ni se cambia.
 */
import { countryFromPhone } from "@/lib/phone-country";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, findPhoneCountry } from "@/lib/scheduling/phone-countries";

/** «Otro»: se escribe el número completo, con el + y el código de país. */
export const OTHER_COUNTRY = "";

export interface PhoneParts {
  /** ISO del país elegido, o `OTHER_COUNTRY`. */
  country: string;
  /** Lo que se ve en el campo: el número sin el prefijo (o entero, con +, en «Otro»). */
  number: string;
}

export function splitPhone(value: string | null | undefined, fallbackCountry: string = DEFAULT_PHONE_COUNTRY): PhoneParts {
  const raw = (value ?? "").trim();
  const fallback = findPhoneCountry(fallbackCountry)?.code ?? DEFAULT_PHONE_COUNTRY;
  if (!raw) return { country: fallback, number: "" };
  if (!/^(\+|00)/.test(raw.replace(/[\s().-]/g, ""))) return { country: fallback, number: raw };
  const info = countryFromPhone(raw);
  const listed = info ? PHONE_COUNTRIES.find((c) => c.code === info.code) : null;
  if (!info || !listed) return { country: OTHER_COUNTRY, number: raw };
  const digits = raw.replace(/\D/g, "").replace(/^00/, "");
  return { country: listed.code, number: digits.slice(info.dial.length) };
}

/**
 * País + número → lo que se guarda. Vacío si no hay número. Lo que se escribe con + (o 00) se toma como completo,
 * aunque haya un país elegido. Un cero de adelante del número local se saca (habitual en Argentina).
 */
export function joinPhone(country: string, number: string): string {
  const compact = number.trim().replace(/[\s().-]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return `+${compact.slice(1).replace(/\D/g, "")}`;
  if (compact.startsWith("00")) return `+${compact.slice(2).replace(/\D/g, "")}`;
  const digits = compact.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  const c = findPhoneCountry(country);
  // En «Otro» sin +, no se puede saber el país: se guarda lo escrito con + para que la validación diga qué falta.
  return c ? `+${c.dial}${digits}` : `+${digits}`;
}
