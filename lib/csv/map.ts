/**
 * Mapeo de columnas del CSV a campos del contacto, y validacion de cada fila
 * antes de tocar la base (F19).
 *
 * Dos cosas que valen la pena explicar:
 *
 * 1. La sugerencia automatica de mapeo mira el nombre de la columna en español
 *    y en ingles. No es lujo: el archivo tipico sale de una planilla del equipo
 *    o de otra herramienta, y que "Correo" y "Celular" caigan solos donde van
 *    es la diferencia entre mapear tres columnas y mapear quince.
 * 2. El numero de fila que se le muestra a la persona cuenta desde 1 e incluye
 *    el encabezado, que es como lo ve en Excel. Adentro el array arranca en
 *    cero: sin traducir, el error de la fila 7 le manda a mirar la 6.
 */

import { validateContactField, type ContactFieldKey, CONTACT_FIELDS } from "@/lib/contacts/fields";

/** Ademas de los campos del contacto, el CSV puede traer estas columnas. */
export type ImportColumnTarget = ContactFieldKey | "tags" | "";

export interface ColumnMapping {
  /** Nombre de la columna en el archivo. */
  header: string;
  /** A que campo va. Vacio = no se importa. */
  target: ImportColumnTarget;
}

/** Nombres que se reconocen para cada campo, ya normalizados. */
const HEADER_HINTS: Partial<Record<ImportColumnTarget, string[]>> = {
  display_name: ["nombre", "name", "nombre completo", "full name", "contacto", "cliente", "apellido y nombre"],
  email: ["email", "e mail", "correo", "correo electronico", "mail"],
  secondary_email: ["email secundario", "segundo email", "secondary email", "email 2"],
  phone: ["telefono", "phone", "celular", "movil", "mobile", "tel", "numero", "whatsapp numero"],
  whatsapp_phone: ["whatsapp", "wpp", "wsp", "whats app"],
  country: ["pais", "country"],
  instagram_username: ["instagram", "ig", "usuario instagram", "instagram username"],
  tiktok_username: ["tiktok", "tik tok"],
  twitter_username: ["twitter", "x", "usuario twitter"],
  facebook_id: ["facebook", "fb"],
  linkedin_profile_url: ["linkedin", "perfil linkedin"],
  lead_temperature: ["temperatura", "temperature", "calificacion"],
  next_followup_date: ["seguimiento", "proximo seguimiento", "followup", "follow up"],
  tags: ["tags", "etiquetas", "tag", "etiqueta"],
};

/** Minusculas, sin acentos y sin puntuacion, para comparar nombres de columna. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HINT_LOOKUP = new Map<string, ImportColumnTarget>();
for (const [target, hints] of Object.entries(HEADER_HINTS)) {
  for (const hint of hints ?? []) {
    // El primero gana: los alias mas especificos estan antes en cada lista.
    if (!HINT_LOOKUP.has(hint)) HINT_LOOKUP.set(hint, target as ImportColumnTarget);
  }
}

/**
 * Mapeo sugerido para los encabezados del archivo. Un campo no se sugiere dos
 * veces: si el archivo trae "Telefono" y "Celular", la segunda queda sin mapear
 * para que la persona decida, en vez de que una pise a la otra en silencio.
 */
export function suggestMapping(headers: string[]): ColumnMapping[] {
  const usados = new Set<ImportColumnTarget>();

  return headers.map((header) => {
    const target = HINT_LOOKUP.get(fold(header)) ?? "";
    if (!target || usados.has(target)) return { header, target: "" as ImportColumnTarget };
    usados.add(target);
    return { header, target };
  });
}

export interface MappedRow {
  /** Numero de fila como lo ve la persona en la planilla (con encabezado). */
  line: number;
  patch: Partial<Record<ContactFieldKey, string | null>>;
  tags: string[];
}

export type RowResult = { ok: true; row: MappedRow } | { ok: false; line: number; error: string };

const FIELD_LABEL = new Map(CONTACT_FIELDS.map((f) => [f.key, f.label]));

/**
 * Valida una fila y la deja lista para escribir.
 *
 * `index` es la posicion en el array de filas (base 0); el numero que se
 * reporta suma dos: uno por el encabezado y otro porque la gente cuenta desde 1.
 */
export function mapRow(values: string[], mapping: ColumnMapping[], index: number): RowResult {
  const line = index + 2;
  const patch: Partial<Record<ContactFieldKey, string | null>> = {};
  const tags: string[] = [];

  for (let i = 0; i < mapping.length; i++) {
    const { target } = mapping[i];
    if (!target) continue;

    const raw = (values[i] ?? "").trim();
    if (!raw) continue;

    if (target === "tags") {
      // Varios tags en una celda, separados por coma o punto y coma.
      for (const tag of raw.split(/[,;]/)) {
        const clean = tag.trim();
        if (clean && !tags.includes(clean)) tags.push(clean);
      }
      continue;
    }

    // La misma validacion que usa el alta a mano: un email invalido tiene que
    // fallar igual venga de un formulario o de una planilla.
    const result = validateContactField(target, raw);
    if (!result.ok) {
      return { ok: false, line, error: `${FIELD_LABEL.get(target) ?? target}: ${result.error}` };
    }
    patch[target] = result.value;
  }

  // Sin telefono ni email no hay con que deduplicar: importarlo garantiza un
  // duplicado la proxima vez que esa persona escriba por un canal.
  const tieneIdentificador =
    patch.email || patch.secondary_email || patch.phone || patch.whatsapp_phone;

  if (!tieneIdentificador) {
    return {
      ok: false,
      line,
      error: "Falta el email y el telefono. Con al menos uno de los dos alcanza.",
    };
  }

  return { ok: true, row: { line, patch, tags } };
}

/** Las columnas que se van a importar, para el resumen previo. */
export function mappedTargets(mapping: ColumnMapping[]): ImportColumnTarget[] {
  return mapping.map((m) => m.target).filter(Boolean);
}
