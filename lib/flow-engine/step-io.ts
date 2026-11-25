/**
 * Lo que usó y lo que dejó cada paso, para auditar una ejecución (`flow_session_steps.input` / `.output`, 00515).
 *
 * - **Entrada:** la configuración del paso con las variables ya reemplazadas (`interpolateDeep`), es decir, los datos
 *   con los que corrió de verdad (el email al que mandó, el nombre con el que creó el contacto…).
 * - **Salida:** las variables que el paso agregó o cambió (sin `webhook`, que ya está entero en el envío), el contacto si
 *   cambió, y lo que el paso declare con `noteStep({ output })` (por ejemplo, el contacto que creó).
 *
 * Tiene datos personales: la sesión del navegador NO puede leer estas columnas (privilegio por columna, 00515); las lee el
 * servidor después de comprobar el permiso, y se vacían a los 90 días. PURO y NUNCA lanza.
 */
import { interpolateDeep } from "./interpolate";

/** Tope por columna: lo que pase se guarda recortado con la marca `truncated`. */
export const STEP_IO_MAX_BYTES = 32 * 1024;

/** Claves de la configuración que no dicen nada de lo que hizo el paso (las dibuja el lienzo). */
const NOISE_KEYS = new Set(["label", "position", "width", "height", "selected", "dragging", "__metrics"]);

/** Las variables que no se copian a la salida: el envío ya se guarda entero aparte. */
const SKIP_VARIABLES = new Set(["webhook"]);

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Un valor recortado a un tamaño razonable. Sin poder serializarlo (un ciclo), null. */
export function capJson(value: unknown, maxBytes: number = STEP_IO_MAX_BYTES): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined || text === "{}" || text === "[]") return null;
  if (byteLength(text) <= maxBytes) {
    return typeof value === "object" && !Array.isArray(value) ? (JSON.parse(text) as Record<string, unknown>) : { valor: JSON.parse(text) };
  }
  // Recorte por caracteres hasta entrar (UTF-8 puede ocupar más de un byte por carácter).
  let cut = Math.min(text.length, maxBytes);
  while (cut > 0 && byteLength(text.slice(0, cut)) > maxBytes - 64) cut = Math.floor(cut * 0.9);
  return { truncated: true, preview: text.slice(0, cut) };
}

/** La entrada de un paso: su configuración con las variables reemplazadas, sin lo que es solo del lienzo. */
export function stepInput(nodeData: unknown, variables: Record<string, unknown> | undefined): Record<string, unknown> | null {
  try {
    if (!nodeData || typeof nodeData !== "object" || Array.isArray(nodeData)) return null;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(nodeData as Record<string, unknown>)) {
      if (NOISE_KEYS.has(key)) continue;
      clean[key] = value;
    }
    return capJson(interpolateDeep(clean, variables ?? {}));
  } catch {
    return null;
  }
}

/** Una copia de las variables para comparar después (sin el envío). */
export function snapshotVariables(variables: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [key, value] of Object.entries(variables ?? {})) {
      if (SKIP_VARIABLES.has(key)) continue;
      try {
        out[key] = JSON.stringify(value) ?? "undefined";
      } catch {
        out[key] = "[sin leer]";
      }
    }
  } catch {
    // Lo que se alcanzó a copiar.
  }
  return out;
}

/** Las variables que el paso agregó o cambió. */
export function changedVariables(before: Record<string, string>, variables: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (const [key, value] of Object.entries(variables ?? {})) {
      if (SKIP_VARIABLES.has(key)) continue;
      let text: string;
      try {
        text = JSON.stringify(value) ?? "undefined";
      } catch {
        continue;
      }
      if (before[key] !== text) out[key] = value;
    }
  } catch {
    // Lo que se alcanzó a comparar.
  }
  return out;
}

/** La salida de un paso: lo que declaró, las variables que cambió y el contacto si cambió. */
export function stepOutput(args: {
  declared: Record<string, unknown> | null | undefined;
  before: Record<string, string>;
  variables: Record<string, unknown> | undefined;
  contactBefore: string | null | undefined;
  contactAfter: string | null | undefined;
}): Record<string, unknown> | null {
  try {
    const out: Record<string, unknown> = {};
    if (args.declared && Object.keys(args.declared).length > 0) out.result = args.declared;
    const vars = changedVariables(args.before, args.variables);
    if (Object.keys(vars).length > 0) out.variables = vars;
    if ((args.contactAfter ?? null) !== (args.contactBefore ?? null) && args.contactAfter) out.contact_id = args.contactAfter;
    return Object.keys(out).length > 0 ? capJson(out) : null;
  } catch {
    return null;
  }
}
