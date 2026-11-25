/**
 * Qué agente analiza las grabaciones de cada área. PURO.
 *
 * El «Analizador de reuniones de Servicio» y el «de Ventas» (agentes declarados) aportan su modelo al análisis de las
 * grabaciones de SU área, y su pantalla muestra los analizadores por tipo de esa área. Cada uno solo analiza lo suyo:
 * la grabación usa el analizador de su tipo (o de su área, `call_analysis_profiles`), nunca el de otra.
 *
 * Las claves son las fijas de las áreas del sistema (`booking_categories.system_key`): no cambian aunque se renombre
 * el área.
 */
export const SERVICE_AREA_KEY = "servicio";
export const SALES_AREA_KEY = "ventas";
/** El área de las reuniones internas del equipo (filtro «Internas»). */
export const TEAM_AREA_KEY = "equipo";

export const AREA_ANALYZER_AGENT = {
  [SERVICE_AREA_KEY]: "service_analyzer",
  [SALES_AREA_KEY]: "sales_analyzer",
} as const satisfies Record<string, string>;

export type AreaAnalyzerAgentKey = (typeof AREA_ANALYZER_AGENT)[keyof typeof AREA_ANALYZER_AGENT];

/** Las claves de los dos agentes, en el orden en que se muestran. */
export const AREA_ANALYZER_AGENT_KEYS: readonly AreaAnalyzerAgentKey[] = ["sales_analyzer", "service_analyzer"];

/** El agente que analiza un área, por la clave fija del área. */
export function analyzerAgentForArea(areaKey: string | null | undefined): AreaAnalyzerAgentKey | null {
  if (!areaKey) return null;
  return (AREA_ANALYZER_AGENT as Record<string, AreaAnalyzerAgentKey>)[areaKey] ?? null;
}

/** El área (clave fija) que analiza un agente declarado, por el `type` del agente. */
export function areaKeyForAnalyzerAgent(agentType: string | null | undefined): string | null {
  if (!agentType) return null;
  return Object.entries(AREA_ANALYZER_AGENT).find(([, agent]) => agent === agentType)?.[0] ?? null;
}
