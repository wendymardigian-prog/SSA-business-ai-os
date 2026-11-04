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

export const DEFAULT_TIMEZONE = "UTC";

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

/**
 * Lista de zonas para el selector, ordenada.
 *
 * El catalogo del runtime se UNE con el de la region: `Intl.supportedValuesOf`
 * no trae "UTC" y usa nombres viejos ("America/Buenos_Aires") aunque el navegador
 * detecte el nuevo ("America/Argentina/Buenos_Aires"). Sin esto, esas zonas no se
 * podian elegir, y un `<select>` con un valor que no esta en sus opciones muestra
 * OTRA zona como si fuera la guardada.
 */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  if (typeof supported === "function") {
    try {
      const all = supported("timeZone");
      if (Array.isArray(all) && all.length > 0) return [...new Set([...all, ...FALLBACK_TIMEZONES])].sort();
    } catch {
      // cae al fallback
    }
  }
  return FALLBACK_TIMEZONES;
}

/** Las opciones de un selector: siempre incluyen el valor actual, aunque no este en el catalogo. */
export function timezoneOptions(value: string, all: string[] = listTimeZones()): string[] {
  return !value || all.includes(value) ? all : [value, ...all];
}
