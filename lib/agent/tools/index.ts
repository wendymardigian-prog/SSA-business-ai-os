/**
 * Alta de las herramientas del agente.
 *
 * Importar este modulo registra todas. El loop y la pantalla importan de aca,
 * asi nadie ve una lista distinta. Para sumar una herramienta: un archivo en
 * esta carpeta con su AgentToolDefinition y una linea de alta abajo.
 */

import { registerAgentTool } from "./registry";
import { escalateTool } from "./escalate";
import { searchKnowledgeTool } from "./search-knowledge";

registerAgentTool(escalateTool);
registerAgentTool(searchKnowledgeTool);

export * from "./registry";
export type * from "./types";
