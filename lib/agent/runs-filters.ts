/**
 * Los filtros nuevos de la pestaña Runs (§15.4): por regla y por detalle.
 *
 * Por que hacen falta: cuando un canal decide por reglas, la pregunta util no es
 * "que runs hubo" sino "que hizo la regla 3", y antes no habia forma de pedir
 * eso. El detalle (`external_cooldown`, `already_answered`, `rule:<id>`) es el
 * que explica los turnos que NO respondieron, que son justo los que se revisan
 * cuando alguien dice "el agente no contesto".
 *
 * Puro: valida los valores contra lo que existe y arma los pedazos de consulta.
 * `rule:r_3` nunca se muestra en pantalla (§16): el selector lista "Regla 3 ·
 * menciona precio" y manda el id por debajo.
 */

/** Los detalles que se pueden filtrar, con su nombre en pantalla. */
export const RUN_DETAIL_FILTERS: Array<{ value: string; label: string }> = [
  { value: "external_cooldown", label: "Esperó tras una respuesta de afuera" },
  { value: "already_answered", label: "Ya estaba respondida" },
  { value: "rule", label: "Lo decidió una regla" },
  { value: "provider_unavailable", label: "Falló el modelo" },
];

const DETAIL_VALUES = RUN_DETAIL_FILTERS.map((d) => d.value);

export function isRunDetailFilter(value: string): boolean {
  return DETAIL_VALUES.includes(value);
}

/** Valida el filtro de regla contra las reglas que existen hoy. */
export function pickRuleFilter(raw: string, knownRuleIds: string[]): string {
  if (!raw) return "";
  // "default" es la accion por defecto: no es una regla, pero se puede filtrar.
  if (raw === "default") return raw;
  return knownRuleIds.includes(raw) ? raw : "";
}

export interface RunDetailQuery {
  /** Para `status_detail`: un `like` cuando el detalle es un prefijo. */
  statusDetailLike: string | null;
  /** Para `routing->>'rule_id'`: el id exacto, o null si no aplica. */
  routingRuleId: string | null;
  /** El filtro es "la accion por defecto": routing con regla nula. */
  routingRuleIsNull: boolean;
}

/**
 * Traduce los dos filtros a lo que hay que preguntarle a la base.
 *
 * El detalle se guarda como texto libre separado por comas en `status_detail`
 * (`"rule:r3, outside_hours"`), asi que se busca con `like` y no con igualdad:
 * un `eq` no encontraria nada en cuanto el turno tenga dos notas.
 */
export function runDetailQuery(detail: string, rule: string): RunDetailQuery {
  const out: RunDetailQuery = { statusDetailLike: null, routingRuleId: null, routingRuleIsNull: false };

  if (rule === "default") out.routingRuleIsNull = true;
  else if (rule) out.routingRuleId = rule;

  if (!detail || !isRunDetailFilter(detail)) return out;
  // "Lo decidió una regla" busca el prefijo: el id va pegado detrás.
  out.statusDetailLike = detail === "rule" ? "%rule:%" : `%${detail}%`;
  return out;
}

/** Cuantos de los filtros nuevos estan puestos (para el contador de la barra). */
export function countNewRunFilters(detail: string, rule: string): number {
  return (detail ? 1 : 0) + (rule ? 1 : 0);
}

/**
 * Las opciones del selector de regla, con nombre legible.
 *
 * Una regla que ya se borro pero tiene turnos igual aparece por su numero: si no,
 * los turnos de esa regla serian imposibles de encontrar.
 */
export function ruleFilterOptions(
  rules: Array<{ id: string; name?: string | null }>,
): Array<{ value: string; label: string }> {
  return [
    ...rules.map((r, i) => ({ value: r.id, label: r.name ? `Regla ${i + 1} · ${r.name}` : `Regla ${i + 1}` })),
    { value: "default", label: "Acción por defecto (ninguna coincidió)" },
  ];
}
