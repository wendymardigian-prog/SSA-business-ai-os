/**
 * El alcance de grabaciones "de ciertas áreas" (00301). Puro.
 *
 * Quien lo tiene ve las grabaciones de esas áreas, además de las que grabó y las de los contactos
 * que ve. Una grabación Sin clasificar no entra por el área: podría ser de cualquiera.
 *
 * Gemelas en la base: `private.call_areas_of`, `private.role_sees_call_area` y
 * `private.call_areas_exceed`. Los casos de `call-areas.cases.json` corren contra las dos
 * (vitest y `verify-roles --despues-de-00301`): si se cambia una regla, se cambia en las dos.
 */

/** Lo que hace falta de un rol. Es estructural para no atarse a la lista de módulos. */
export interface CallAreaPermissions {
  scopes?: Partial<Record<string, string>>;
  call_areas?: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Un valor guardado: solo ids, sin repetidos. Lo que no se entiende no da ninguna área. */
export function parseCallAreas(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && UUID.test(id));
  return [...new Set(ids)];
}

const callScope = (p: CallAreaPermissions | null | undefined) => p?.scopes?.calls;

/** Las áreas que da un rol. Solo cuentan con el alcance "areas". */
export function callAreasOf(p: CallAreaPermissions | null | undefined): string[] {
  return callScope(p) === "areas" ? (p?.call_areas ?? []) : [];
}

/** Ese rol ve las grabaciones de esa área? Sin área, solo quien ve todas. */
export function roleSeesCallArea(p: CallAreaPermissions | null | undefined, areaId: string | null): boolean {
  if (callScope(p) === "all") return true;
  return areaId !== null && callAreasOf(p).includes(areaId);
}

/**
 * `wanted` agrega, sobre `before`, un área que `actor` no tiene?
 *
 * Solo importa lo que se agrega: sacar áreas nunca es una escalada, y pasar de "todas" a unas
 * áreas tampoco. Subir el alcance (de "las suyas" a "áreas") lo mira además `assertCanGrant`.
 */
export function callAreasExceed(
  wanted: CallAreaPermissions | null | undefined,
  before: CallAreaPermissions | null | undefined,
  actor: CallAreaPermissions | null | undefined,
): boolean {
  if (callScope(wanted) !== "areas") return false;
  if (callScope(actor) === "all" || callScope(before) === "all") return false;
  const had = callAreasOf(before);
  const mine = callAreasOf(actor);
  return callAreasOf(wanted).some((id) => !had.includes(id) && !mine.includes(id));
}
