// @plantilla-quitar(servicios)
/**
 * Carga inicial de clientes (F99): el CSV de "Importar servicios".
 *
 * Columnas (el encabezado se reconoce sin importar mayusculas ni tildes):
 *   email o telefono del contacto · producto · variante · inicio · fin (opcional) ·
 *   email del responsable · fase actual (opcional)
 * Modulo puro: arma las filas y sus errores para la vista previa. El servidor resuelve los nombres
 * contra la base (contacto, producto, variante, responsable) y vuelve a validar todo.
 * Importar el mismo archivo dos veces no duplica: la clave es contacto + producto + inicio.
 */
import { parseCsv } from "@/lib/csv/parse";

export const IMPORT_MAX_ROWS = 2000;

export interface ServiceImportRow {
  line: number;
  email: string | null;
  phone: string | null;
  product: string;
  variant: string;
  startsOn: string;
  endsOn: string | null;
  ownerEmail: string | null;
  phase: string | null;
}

export interface ServiceImportParse {
  rows: ServiceImportRow[];
  errors: Array<{ line: number; problems: string[] }>;
  missingColumns: string[];
  truncated: number;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const COLUMNS: Record<string, string[]> = {
  email: ["email", "email del contacto", "correo"],
  phone: ["telefono", "teléfono", "telefono del contacto", "whatsapp"],
  product: ["producto"],
  variant: ["variante"],
  startsOn: ["inicio", "fecha de inicio"],
  endsOn: ["fin", "fecha de fin"],
  ownerEmail: ["responsable", "email del responsable"],
  phase: ["fase", "fase actual"],
};

/** Los nombres de columna que se muestran en la pantalla (el primero de cada una). */
export const IMPORT_COLUMNS = Object.values(COLUMNS).map((names) => names[0]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Acepta AAAA-MM-DD y DD/MM/AAAA. */
export function parseImportDate(raw: string): string | null {
  const s = raw.trim();
  if (DATE.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseServicesImport(csv: string): ServiceImportParse {
  const parsed = parseCsv(csv, { maxRows: IMPORT_MAX_ROWS });
  const headers = parsed.headers.map(norm);
  const index: Record<string, number> = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = headers.findIndex((h) => names.map(norm).includes(h));
    if (i >= 0) index[key] = i;
  }
  const missingColumns: string[] = [];
  if (index.email === undefined && index.phone === undefined) missingColumns.push("email o teléfono");
  for (const k of ["product", "variant", "startsOn", "ownerEmail"] as const) if (index[k] === undefined) missingColumns.push(COLUMNS[k][0]);
  if (missingColumns.length) return { rows: [], errors: [], missingColumns, truncated: parsed.truncated };

  const rows: ServiceImportRow[] = [];
  const errors: ServiceImportParse["errors"] = [];
  const seen = new Set<string>();
  parsed.rows.forEach((cells, i) => {
    const line = i + 2;
    const get = (k: string) => (index[k] === undefined ? "" : (cells[index[k]] ?? "").trim());
    if (cells.every((c) => !c.trim())) return;
    const problems: string[] = [];
    const email = get("email") || null;
    const phone = get("phone") || null;
    if (!email && !phone) problems.push("falta el email o el teléfono del contacto");
    if (email && !EMAIL.test(email)) problems.push("el email del contacto no es válido");
    const product = get("product");
    const variant = get("variant");
    if (!product) problems.push("falta el producto");
    if (!variant) problems.push("falta la variante");
    const startsOn = parseImportDate(get("startsOn"));
    if (!startsOn) problems.push("la fecha de inicio no es válida (AAAA-MM-DD o DD/MM/AAAA)");
    const endRaw = get("endsOn");
    const endsOn = endRaw ? parseImportDate(endRaw) : null;
    if (endRaw && !endsOn) problems.push("la fecha de fin no es válida");
    if (startsOn && endsOn && endsOn < startsOn) problems.push("el fin es antes del inicio");
    const ownerEmail = get("ownerEmail") || null;
    if (!ownerEmail || !EMAIL.test(ownerEmail)) problems.push("falta el email del responsable");
    const key = `${(email ?? phone ?? "").toLowerCase()}|${norm(product)}|${startsOn}`;
    if (!problems.length && seen.has(key)) problems.push("la fila está repetida en el archivo");
    seen.add(key);
    if (problems.length) {
      errors.push({ line, problems });
      return;
    }
    rows.push({ line, email: email?.toLowerCase() ?? null, phone, product, variant, startsOn: startsOn!, endsOn, ownerEmail: ownerEmail!.toLowerCase(), phase: get("phase") || null });
  });
  return { rows, errors, missingColumns, truncated: parsed.truncated };
}

/** La clave que hace que importar dos veces no duplique (contacto + producto + inicio). */
export function importKey(contactId: string, productId: string, startsOn: string): string {
  return `${contactId}|${productId}|${startsOn}`;
}
