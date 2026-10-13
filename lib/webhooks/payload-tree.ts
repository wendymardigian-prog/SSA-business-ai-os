/**
 * Las hojas de un payload como rutas planas: `{ path, type, sample }`. Alimenta el arbol del
 * historial, el selector de variables ({{webhook.payload.<ruta>}}) y el mapeo del paso de
 * contacto. Puro, y NUNCA lanza (un payload de afuera puede venir con cualquier forma).
 */
export type LeafType = "text" | "number" | "boolean" | "date";

export interface PayloadLeaf {
  /** Ruta con puntos e indices: `data.user.email`, `items.0.price`. */
  path: string;
  type: LeafType;
  /** El valor de ejemplo, como texto y recortado. */
  sample: string;
}

export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_LEAVES = 300;
const SAMPLE_MAX = 80;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function leafTypeOf(value: string | number | boolean): LeafType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return ISO_DATE.test(value.trim()) && !Number.isNaN(Date.parse(value.trim().replace(" ", "T"))) ? "date" : "text";
}

/**
 * Recorre el payload en profundidad. Las claves de un nivel se ven en el orden en que vienen.
 * `maxDepth` es la cantidad maxima de segmentos de una ruta; lo mas profundo no se baja.
 * Los null, los objetos y listas vacios y los textos vacios no son hojas.
 */
export function flattenPaths(payload: unknown, maxDepth: number = DEFAULT_MAX_DEPTH, maxLeaves: number = DEFAULT_MAX_LEAVES): PayloadLeaf[] {
  const out: PayloadLeaf[] = [];

  const visit = (value: unknown, path: string[]): void => {
    if (out.length >= maxLeaves || path.length > maxDepth) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length && out.length < maxLeaves; i++) visit(value[i], [...path, String(i)]);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const key of Object.keys(value)) {
        if (out.length >= maxLeaves) return;
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        visit((value as Record<string, unknown>)[key], [...path, key]);
      }
      return;
    }
    if (path.length === 0) return;
    if (typeof value === "string") {
      if (value.trim() === "") return;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
    } else if (typeof value !== "boolean") {
      return;
    }
    out.push({ path: path.join("."), type: leafTypeOf(value as string | number | boolean), sample: String(value).slice(0, SAMPLE_MAX) });
  };

  try {
    visit(payload, []);
  } catch {
    // Un payload con un getter hostil u otra rareza: se devuelve lo que se alcanzo a leer.
  }
  return out;
}
