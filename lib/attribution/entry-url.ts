/**
 * La URL de entrada completa (plano formularios-ui, F17): la direccion por la
 * que llego la persona, con TODOS sus parametros tal cual vinieron — tambien los
 * que `landing_page` filtra (`ad_name`, `campaign_name`, `site_source_name`, un
 * `?ref=` propio).
 *
 * Que se saca:
 *  - los parametros con nombre sensible (`token`, `password`, `code`...): lista
 *    compartida con el embed (`sensitive-params.ts`);
 *  - los internos del sistema: `embed`, `attr`, `preview`, `c` (el token del link
 *    para un contacto) y `referrer`;
 *  - el fragmento (`#...`), las credenciales de la URL (`user:pass@`) y los
 *    caracteres de control.
 *
 * Solo http o https, recortada a 2000 caracteres. El resto de la URL (orden,
 * codificacion) queda como vino: no se vuelve a serializar la query.
 *
 * PURA y sin dependencias de servidor: la usan el navegador, el embed y el
 * servidor al volver a sanear lo que manda el navegador. NUNCA se loguea.
 */
import { isSensitiveParamName } from "./sensitive-params";

/** La clave con la que viaja y se guarda. */
export const ENTRY_URL_KEY = "entry_url";

export const ENTRY_URL_MAX_LENGTH = 2000;

/** Parametros que son del sistema y no de la persona (la URL del iframe, el link firmado). */
export const INTERNAL_PARAM_NAMES: ReadonlySet<string> = new Set(["embed", "attr", "preview", "c", "referrer"]);

/** El nombre de un parametro tal cual esta en la query, ya decodificado y en minusculas. */
function paramName(piece: string): string {
  const raw = piece.split("=", 1)[0] ?? "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function entryUrlFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // La query se filtra pieza por pieza, sin tocar lo que queda (orden y codificacion originales).
  const kept = url.search
    .replace(/^\?/, "")
    .split("&")
    .filter((piece) => {
      if (piece === "") return false;
      const name = paramName(piece);
      return name !== "" && !isSensitiveParamName(name) && !INTERNAL_PARAM_NAMES.has(name);
    });

  let out = `${url.origin}${url.pathname}${kept.length > 0 ? `?${kept.join("&")}` : ""}`;
  if (out.length > ENTRY_URL_MAX_LENGTH) {
    out = out.slice(0, ENTRY_URL_MAX_LENGTH);
    // No dejar un "%" o "%A" a medias al final: no es una URL valida.
    out = out.replace(/%[0-9A-Fa-f]?$/, "");
  }
  return out;
}
