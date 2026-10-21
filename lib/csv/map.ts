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
import { CUSTOM_VALUE_ERROR_MESSAGES, normalizeCustomValue } from "@/lib/custom-fields";

/** Las columnas de atribución que puede traer el archivo (todas opcionales). */
export const ATTRIBUTION_TARGETS = ["attr:source", "attr:medium", "attr:campaign", "attr:first_touch_at"] as const;
export type AttributionTarget = (typeof ATTRIBUTION_TARGETS)[number];

export const ATTRIBUTION_TARGET_LABELS: Record<AttributionTarget, string> = {
  "attr:source": "Fuente (utm_source)",
  "attr:medium": "Medio (utm_medium)",
  "attr:campaign": "Campaña (utm_campaign)",
  "attr:first_touch_at": "Fecha del primer contacto",
};

/** Un campo personalizado: `custom:<id del campo>`. */
export type CustomTarget = `custom:${string}`;

/**
 * Ademas de los campos del contacto, el CSV puede traer tags, campos
 * personalizados y datos de atribución.
 */
export type ImportColumnTarget = ContactFieldKey | "tags" | AttributionTarget | CustomTarget | "";

/** Lo que el mapeo necesita saber de un campo personalizado. */
export interface ImportCustomField {
  id: string;
  name: string;
  type: string;
}

export const CUSTOM_TARGET_PREFIX = "custom:";

export function customTarget(fieldId: string): CustomTarget {
  return `custom:${fieldId}`;
}

export function isCustomTarget(target: string): target is CustomTarget {
  return target.startsWith(CUSTOM_TARGET_PREFIX);
}

export function isAttributionTarget(target: string): target is AttributionTarget {
  return (ATTRIBUTION_TARGETS as readonly string[]).includes(target);
}

/** Los datos de atribución de una fila, ya validados. */
export interface RowAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  /** AAAA-MM-DD. */
  firstTouchDate?: string;
}

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
  "attr:source": ["utm source", "fuente", "source", "utm_source"],
  "attr:medium": ["utm medium", "medio", "medium"],
  "attr:campaign": ["utm campaign", "campana", "campaign"],
  "attr:first_touch_at": [
    "fecha primer contacto", "fecha del primer contacto", "primer contacto", "fecha de alta", "fecha alta",
    "fecha de creacion", "created at", "fecha de ingreso",
  ],
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
 *
 * Una columna que se llama igual que un campo personalizado ("Cantidad de
 * viajeros") va sola a ese campo. El nombre del campo gana sobre los alias
 * genéricos: si el negocio creó un campo "Fuente", la columna "Fuente" es suya.
 */
export function suggestMapping(headers: string[], customFields: ImportCustomField[] = []): ColumnMapping[] {
  const usados = new Set<ImportColumnTarget>();
  const byName = new Map<string, ImportColumnTarget>();
  for (const f of customFields) {
    const key = fold(f.name);
    if (key && !byName.has(key)) byName.set(key, customTarget(f.id));
  }

  return headers.map((header) => {
    const folded = fold(header);
    const target = byName.get(folded) ?? HINT_LOOKUP.get(folded) ?? "";
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
  /** Campos personalizados: id del campo → valor ya normalizado por tipo. */
  custom: Record<string, string>;
  /** Atribución que trajo el archivo (vacío si no trajo nada). */
  attribution: RowAttribution;
}

export type RowResult = { ok: true; row: MappedRow } | { ok: false; line: number; error: string };

const FIELD_LABEL = new Map(CONTACT_FIELDS.map((f) => [f.key, f.label]));

/**
 * Valida una fila y la deja lista para escribir.
 *
 * `index` es la posicion en el array de filas (base 0); el numero que se
 * reporta suma dos: uno por el encabezado y otro porque la gente cuenta desde 1.
 */
export function mapRow(
  values: string[],
  mapping: ColumnMapping[],
  index: number,
  customFields: ImportCustomField[] = [],
  today: string = new Date().toISOString().slice(0, 10),
): RowResult {
  const line = index + 2;
  const patch: Partial<Record<ContactFieldKey, string | null>> = {};
  const tags: string[] = [];
  const custom: Record<string, string> = {};
  const attribution: RowAttribution = {};
  const fieldsById = new Map(customFields.map((f) => [f.id, f]));

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

    if (isCustomTarget(target)) {
      const field = fieldsById.get(target.slice(CUSTOM_TARGET_PREFIX.length));
      // Un campo que se borró mientras se mapeaba: la columna no se importa.
      if (!field) continue;
      // La misma regla que la ficha, los flujos y el webhook.
      const value = normalizeCustomValue(field.type, raw);
      if (!value.ok) return { ok: false, line, error: `${field.name} ${CUSTOM_VALUE_ERROR_MESSAGES[value.reason]}` };
      custom[field.id] = value.value;
      continue;
    }

    if (isAttributionTarget(target)) {
      if (target === "attr:first_touch_at") {
        const date = normalizeCustomValue("date", raw);
        if (!date.ok) return { ok: false, line, error: `Fecha del primer contacto ${CUSTOM_VALUE_ERROR_MESSAGES.fecha_invalida}` };
        if (date.value > today) return { ok: false, line, error: "La fecha del primer contacto no puede ser futura" };
        attribution.firstTouchDate = date.value;
      } else {
        const text = raw.slice(0, 200);
        if (target === "attr:source") attribution.source = text;
        if (target === "attr:medium") attribution.medium = text;
        if (target === "attr:campaign") attribution.campaign = text;
      }
      continue;
    }

    // La misma validacion que usa el alta a mano: un email invalido tiene que
    // fallar igual venga de un formulario o de una planilla.
    const result = validateContactField(target, raw);
    if (!result.ok) {
      // validateContactField ya nombra el campo en su mensaje cuando hace
      // falta; anteponerlo de nuevo daba "Email: Email: ... no es valido".
      const label = FIELD_LABEL.get(target) ?? target;
      const error = result.error.startsWith(label) ? result.error : `${label}: ${result.error}`;
      return { ok: false, line, error };
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

  return { ok: true, row: { line, patch, tags, custom, attribution } };
}

/** Las columnas que se van a importar, para el resumen previo. */
export function mappedTargets(mapping: ColumnMapping[]): ImportColumnTarget[] {
  return mapping.map((m) => m.target).filter(Boolean);
}
