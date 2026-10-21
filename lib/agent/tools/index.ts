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
import { setterStatusTool } from "./setter-status";
import { followupTool } from "./followup";
import { assignConversationTool } from "./assign-conversation";
import { crmLookupTool } from "./crm-lookup";
import { pauseSelfTool } from "./pause-self";
import { declareIntentTool } from "./declare-intent";
import { whatsappLinkTool } from "./whatsapp-link";
import { listarRecursosTool, usarRecursoTool } from "./assets";
import { createTaskTool } from "./create-task";
import { registerSchedulingSkill } from "./scheduling";

registerAgentTool(escalateTool);
registerAgentTool(searchKnowledgeTool);
registerAgentTool(tagContactTool);
registerAgentTool(leadTemperatureTool);
// Pipeline (00245): el estado de setter. Nace apagada; el de vendedor no lo toca nunca.
registerAgentTool(setterStatusTool);
registerAgentTool(followupTool);
registerAgentTool(assignConversationTool);
registerAgentTool(crmLookupTool);
registerAgentTool(pauseSelfTool);
registerAgentTool(declareIntentTool);
registerAgentTool(whatsappLinkTool);
registerAgentTool(listarRecursosTool);
registerAgentTool(usarRecursoTool);
// Tareas (Extra A, F23): deja una tarea para el equipo. No es obligatoria: el agente la usa solo si se la habilitaron.
registerAgentTool(createTaskTool);

// La habilidad de agendamiento (Etapa 4): siete herramientas que se prenden
// juntas. Apagada, ninguna se ofrece y el agente ve lo mismo que antes.
registerSchedulingSkill();

export * from "./registry";
export type * from "./types";
