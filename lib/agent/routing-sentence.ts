/**
 * Traduce `agent_runs.routing` (F9) a una oración legible para Runs y la cola
 * (F12). En pantalla nunca aparece `rule:r_3`: siempre una oración.
 */

export interface RoutingLike {
  mode?: string;
  action?: string;
  rule_id?: string | null;
  rule_index?: number | null;
  check?: string;
  moment?: number;
  refresh?: string;
}

export interface RuleLabel {
  name?: string | null;
  index: number;
}

const ACTION_VERB: Record<string, string> = {
  send: "Se envió directo",
  draft: "Quedó como borrador",
  skip: "No respondió",
};

/**
 * @param routing el jsonb del run
 * @param ruleLookup id de regla → su nombre e índice (para nombrarla)
 */
export function routingSentence(routing: RoutingLike | null | undefined, ruleLookup?: Map<string, RuleLabel>): string {
  if (!routing) return "Turno normal.";

  if (routing.check === "already_answered") {
    const cuando = routing.moment === 2 ? "mientras se generaba la respuesta" : "antes de generar";
    return `No respondió: ya había una respuesta ${cuando}.`;
  }
  if (routing.check === "external_cooldown") {
    return "No respondió: otra herramienta (por ejemplo ManyChat) respondió hace poco.";
  }

  if (routing.mode === "rules") {
    const verb = ACTION_VERB[routing.action ?? ""] ?? "Se resolvió";
    if (routing.rule_id) {
      const label = ruleLookup?.get(routing.rule_id);
      const numero = label ? label.index + 1 : (routing.rule_index ?? 0) + 1;
      const nombre = label?.name ? `: ${label.name}` : "";
      return `${verb} por la regla ${numero}${nombre}.`;
    }
    return `${verb} por la acción por defecto.`;
  }

  if (routing.mode === "draft") return "Quedó como borrador.";
  if (routing.mode === "send") return "Se envió directo.";
  return "Turno normal.";
}
