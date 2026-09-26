/**
 * Etiquetas con efecto sobre el agente (Bloque 2d-A, migracion 00073).
 *
 * El efecto en si vive en la base (triggers sobre contact_tags, tags y
 * conversations): vale para cualquier camino que ponga una etiqueta. Aca esta
 * lo que necesita la pantalla para explicarlo, sin dependencias de servidor.
 */

export interface TagWithEffect {
  id: string;
  name: string;
  color: string | null;
  /** Apaga el agente en las conversaciones del contacto, presentes y futuras. */
  disablesAgent: boolean;
  /** Al ponerla, setter y vendedor pasan a esta persona. */
  assignsTo: string | null;
}

/** Si la etiqueta hace algo ademas de clasificar. */
export function hasEffect(tag: Pick<TagWithEffect, "disablesAgent" | "assignsTo">): boolean {
  return tag.disablesAgent || tag.assignsTo !== null;
}

/**
 * Lo que pasa al ponerla, en una frase. `assigneeName` es el nombre de la
 * persona de `assignsTo` (null si no asigna o ya no es miembro).
 */
export function describeEffect(
  tag: Pick<TagWithEffect, "disablesAgent" | "assignsTo">,
  assigneeName: string | null,
): string | null {
  const parts: string[] = [];
  if (tag.disablesAgent) parts.push("apaga el agente en sus conversaciones");
  if (tag.assignsTo) parts.push(assigneeName ? `lo asigna a ${assigneeName}` : "lo asigna a una persona que ya no está en el equipo");
  if (parts.length === 0) return null;
  const text = parts.join(" y ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Las etiquetas con efecto primero (son las que se buscan con apuro), despues por nombre. */
export function sortEffectFirst<T extends Pick<TagWithEffect, "name" | "disablesAgent" | "assignsTo">>(tags: T[]): T[] {
  return [...tags].sort((a, b) => {
    const ea = hasEffect(a) ? 0 : 1;
    const eb = hasEffect(b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return a.name.localeCompare(b.name, "es");
  });
}

/**
 * Las etiquetas que el agente puede usar: nunca una con efecto. Si pudiera
 * poner "es-conocido", se apagaria a si mismo en medio del turno y el lead
 * quedaria sin respuesta ni aviso. Si alguna vez tiene que marcar "no es
 * lead", va como sugerencia que aprueba una persona.
 */
export function agentUsableTagIds(tags: Array<Pick<TagWithEffect, "id" | "disablesAgent" | "assignsTo">>): Set<string> {
  return new Set(tags.filter((t) => !hasEffect(t)).map((t) => t.id));
}

/**
 * Tope de la accion masiva de Contactos: una sentada de trabajo, no una
 * importacion. (Vive aca y no en la Server Action: un archivo "use server"
 * solo puede exportar funciones.)
 */
export const BULK_TAG_LIMIT = 200;
