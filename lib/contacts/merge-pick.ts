/**
 * Unir dos contactos a mano (20/11/2026): que se muestra de cada uno y cual
 * queda como principal por defecto.
 *
 * Puro: lo usan el dialogo «Unir con otro contacto» y su test. La fusion en si
 * es `linkContacts` → `merge_contacts` (00207): el principal conserva lo suyo y
 * completa lo vacio con el otro; las marcas Conocido y Cliente pasan al
 * principal (triggers de la 00256 y la 00268).
 */

export interface MergeCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  isKnown: boolean;
  isCustomer: boolean;
  /** Plataformas de sus canales vinculados ("whatsapp", "instagram", ...), sin repetir. */
  platforms: string[];
}

/** Cuantos datos fuertes tiene: los que identifican a la persona (nunca el nombre). */
export function strongDataCount(c: MergeCandidate): number {
  return [c.phone, c.email, c.instagram].filter((v) => !!v && v.trim() !== "").length + c.platforms.length;
}

/**
 * El principal por defecto: el que tiene mas datos fuertes. Empatados, el que
 * se esta mirando (`current`): es el que la persona eligio para empezar.
 */
export function defaultMainContactId(current: MergeCandidate, other: MergeCandidate): string {
  return strongDataCount(other) > strongDataCount(current) ? other.id : current.id;
}

/** Como queda el contacto unido: lo del principal y, donde esta vacio, lo del otro. */
export function mergedPreview(main: MergeCandidate, duplicate: MergeCandidate): MergeCandidate {
  const pick = (a: string | null, b: string | null) => (a && a.trim() !== "" ? a : b);
  return {
    id: main.id,
    name: main.name,
    phone: pick(main.phone, duplicate.phone),
    email: pick(main.email, duplicate.email),
    instagram: pick(main.instagram, duplicate.instagram),
    isKnown: main.isKnown || duplicate.isKnown,
    isCustomer: main.isCustomer || duplicate.isCustomer,
    platforms: Array.from(new Set([...main.platforms, ...duplicate.platforms])),
  };
}
