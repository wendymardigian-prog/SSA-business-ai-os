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
import { tagContactTool } from "./tag-contact";
import { leadTemperatureTool } from "./lead-temperature";
import { followupTool } from "./followup";
import { assignConversationTool } from "./assign-conversation";
import { crmLookupTool } from "./crm-lookup";
import { pauseSelfTool } from "./pause-self";
import { declareIntentTool } from "./declare-intent";

registerAgentTool(escalateTool);
registerAgentTool(searchKnowledgeTool);
registerAgentTool(tagContactTool);
registerAgentTool(leadTemperatureTool);
registerAgentTool(followupTool);
registerAgentTool(assignConversationTool);
registerAgentTool(crmLookupTool);
registerAgentTool(pauseSelfTool);
registerAgentTool(declareIntentTool);

export * from "./registry";
export type * from "./types";
