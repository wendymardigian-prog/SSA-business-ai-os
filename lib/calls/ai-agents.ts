/**
 * «Agentes IA» de Grabaciones: los que trabajan con las grabaciones, cómo están y dónde se editan. PURO.
 *
 * El clasificador (tarea `call_classification`: reglas sin IA primero y la IA solo si ninguna decide), un analizador
 * por área (agentes declarados `sales_analyzer` y `service_analyzer`, con sus analizadores por tipo de reunión), el
 * contexto común del análisis y el resumen de llamadas. La página lee los datos con el cliente de servicio después de
 * mirar el permiso; acá solo se arma lo que se muestra.
 */

export interface CallsAiAgent {
  key: string;
  name: string;
  /** Qué hace, en una línea. */
  role: string;
  /** Cómo está ahora: «Automático · 11 reglas», «3 tipos en automático, 5 a mano»… */
  status: string;
  tone: "on" | "manual" | "off";
  href: string;
}

export interface CallsAiAgentsInput {
  classification: { mode: "now" | "off"; activeRules: number };
  /** Un analizador por área, con sus analizadores por tipo. `agentId` null = todavía no se creó el agente. */
  analyzers: Array<{ areaKey: string; areaName: string; agentId: string | null; agentName: string | null; profiles: { auto: number; manual: number } }>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function callsAiAgents(input: CallsAiAgentsInput): CallsAiAgent[] {
  const { classification } = input;
  const rules = plural(classification.activeRules, "regla", "reglas");
  const agents: CallsAiAgent[] = [
    {
      key: "classifier",
      name: "Clasificador de grabaciones",
      role: "Decide el tipo de cada grabación: primero las reglas sin IA y, si ninguna decide, la IA.",
      status: classification.mode === "now" ? `Automático · ${rules} sin IA, después IA` : `Solo reglas · ${rules} (sin IA)`,
      tone: classification.mode === "now" ? "on" : "manual",
      href: "/dashboard/agents/tareas/call_classification?tab=config",
    },
  ];
  for (const a of input.analyzers) {
    const { auto, manual } = a.profiles;
    const total = auto + manual;
    agents.push({
      key: `analyzer:${a.areaKey}`,
      name: a.agentName ?? `Analizador de reuniones de ${a.areaName}`,
      role: `Analiza solo las grabaciones de ${a.areaName}, con el analizador de cada tipo.`,
      status: total === 0 ? "Sin analizadores: no analiza nada" : auto === 0 ? `${plural(total, "tipo", "tipos")} · a mano` : manual === 0 ? `${plural(total, "tipo", "tipos")} · en automático` : `${auto} en automático, ${manual} a mano`,
      tone: total === 0 ? "off" : auto > 0 ? "on" : "manual",
      href: a.agentId ? `/dashboard/agents/${a.agentId}` : "/dashboard/agents/tareas/call_analysis?tab=config",
    });
  }
  agents.push(
    {
      key: "analysis",
      name: "Análisis de llamadas",
      role: "Lo que comparten todos los analizadores: el contexto del negocio, las categorías y quién aprueba las propuestas.",
      status: "Configuración común",
      tone: "manual",
      href: "/dashboard/agents/tareas/call_analysis?tab=config",
    },
    {
      key: "summary",
      name: "Resumen de llamadas",
      role: "Resume cada grabación analizada y actualiza la memoria del contacto.",
      status: "Después de cada análisis",
      tone: "on",
      href: "/dashboard/agents/tareas/call_summary",
    },
  );
  return agents;
}
