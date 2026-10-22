/**
 * Que muestra la pantalla de Agentes IA segun haya o no una IA conectada.
 *
 *   | IA conectada | uso IA alguna vez | pantalla                                              |
 *   |--------------|-------------------|-------------------------------------------------------|
 *   | no           | no                | `empty`: solo la invitacion a conectar la primera IA  |
 *   | no           | si                | `full-with-warning`: todo, con el aviso arriba        |
 *   | si           | -                 | `full`                                                |
 *
 * El empty state es para quien todavia no empezo: sin IA no hay agente que
 * configurar ni tarea que pueda correr. Si alguien desconecta las IAs DESPUES
 * de haberlas usado, la pantalla sigue entera (historial, costos, la
 * configuracion de cada agente) con el aviso: nada se borra ni se esconde, y al
 * reconectar todo vuelve como estaba.
 *
 * Puro.
 */

export type AgentsPageMode = "empty" | "full" | "full-with-warning";

export function agentsPageMode(args: { connectedProviders: readonly string[]; everUsedAi: boolean }): AgentsPageMode {
  if (args.connectedProviders.length > 0) return "full";
  return args.everUsedAi ? "full-with-warning" : "empty";
}

/**
 * Si a los agentes les falta algo que `ensure_default_agents` (00252) completa:
 * no hay un agente de chat, el chat o el copywriter no tienen proveedor, o el
 * copywriter no tiene instrucciones ni ninguna version. Con todo completo, la
 * pantalla ni llama a la base: en un negocio ya configurado no cuesta nada.
 */
export function agentsNeedDefaults(
  agents: readonly { type: string; provider: string | null; systemPrompt: string; promptVersion: number | null }[],
): boolean {
  if (!agents.some((a) => a.type === "chat")) return true;
  return agents.some(
    (a) =>
      ((a.type === "chat" || a.type === "copywriter") && !a.provider) ||
      (a.type === "copywriter" && !a.systemPrompt.trim() && a.promptVersion === null),
  );
}
