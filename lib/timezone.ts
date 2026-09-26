/**
 * Zonas horarias IANA para el selector del workspace (F3).
 *
 * La validación corre en cliente Y servidor con la misma función. La lista se
 * arma con `Intl.supportedValuesOf("timeZone")` cuando está disponible; si no,
 * cae a un puñado de zonas de la región. Guardar una zona inválida se rechaza.
 */

const FALLBACK_TIMEZONES = [
  "America/Costa_Rica",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "UTC",
];

export const DEFAULT_TIMEZONE = "America/Costa_Rica";

/** Verdadero si la zona es una IANA válida que el runtime reconoce. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // Lanza RangeError si la zona no existe.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Lista de zonas para el selector, ordenada, con fallback si el runtime no expone el catálogo. */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  if (typeof supported === "function") {
    try {
      const all = supported("timeZone");
      if (Array.isArray(all) && all.length > 0) return all;
    } catch {
      // cae al fallback
    }
  }
  return FALLBACK_TIMEZONES;
}
