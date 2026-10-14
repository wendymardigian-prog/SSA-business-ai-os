/**
 * Alta de los tipos de nodo.
 *
 * Los once nodos que el panel guarda como `type: "action"` declaran su alias en
 * su propio archivo, asi que aca solo hay altas.
 */

import { registerNode } from "./registry";
import { sendMessageNode } from "../nodes/send-message";
import { conditionNode } from "../nodes/condition";
import { branchNode } from "../nodes/branch";
import { delayNode, smartDelayNode } from "../nodes/delay";
import { addTagNode, removeTagNode } from "../nodes/tag";
import { setCustomFieldNode } from "../nodes/set-field";
import { httpRequestNode } from "../nodes/http-request";
import { goToFlowNode } from "../nodes/go-to-flow";
import { humanTakeoverNode } from "../nodes/human-takeover";
import { subscribeNode, unsubscribeNode } from "../nodes/subscription";
import { abSplitNode } from "../nodes/ab-split";
import { commentReplyNode, privateReplyNode } from "../nodes/comment-reply";
import { aiResponseNode } from "../nodes/ai-response";
import { enrollSequenceNode } from "../nodes/enroll-sequence";
import { pauseAgentNode, resumeAgentNode } from "../nodes/agent-toggle";
import { sendEmailNode } from "../nodes/send-email";
import { sendAssetNode } from "../nodes/send-asset";
import { cancelBookingNode, setBookingStatusNode } from "../nodes/booking-actions";
import { markPaymentPaidNode, reschedulePaymentNode, setSaleStatusNode } from "../nodes/sales-actions";
import { notifyTeamNode } from "../nodes/notify-team";
import { upsertContactNode } from "../nodes/upsert-contact";
import { createTaskNode } from "../nodes/create-task";
import { completeTaskNode } from "../nodes/complete-task";
import { sendWhatsAppNumberNode } from "../nodes/send-whatsapp-number";

registerNode(sendMessageNode);
// Banca de recursos en las automatizaciones: los seis tipos, por el canal que los acepte.
registerNode(sendAssetNode);
registerNode(aiResponseNode);
registerNode(conditionNode);
// "Condiciones": varios caminos en orden + "Si no". El `condition` de siempre sigue andando igual.
registerNode(branchNode);
registerNode(delayNode);
registerNode(smartDelayNode);
registerNode(addTagNode);
registerNode(removeTagNode);
registerNode(setCustomFieldNode);
registerNode(httpRequestNode);
registerNode(goToFlowNode);
registerNode(humanTakeoverNode);
registerNode(subscribeNode);
registerNode(unsubscribeNode);
registerNode(abSplitNode);
registerNode(commentReplyNode);
registerNode(privateReplyNode);
registerNode(enrollSequenceNode);
registerNode(pauseAgentNode);
registerNode(resumeAgentNode);

// Etapa 4: el email como accion de flow y las dos acciones de agenda (F46).
registerNode(sendEmailNode);
registerNode(cancelBookingNode);
registerNode(setBookingStatusNode);

// Ventas (F37): las tres acciones de cobranza. Pasan por el mismo nucleo que las Server Actions.
registerNode(markPaymentPaidNode);
registerNode(reschedulePaymentNode);
registerNode(setSaleStatusNode);
// Reporte de fin de día (E15): sirve en flujos sin contacto y con contacto.
registerNode(notifyTeamNode);
// Webhooks entrantes (Extra L): consigue el contacto de un flujo que arranco sin uno.
registerNode(upsertContactNode);
// Tareas (Extra A, F22): deja una tarea para el equipo; sirve con y sin contacto.
registerNode(createTaskNode);
// Tareas × CRM (R4): cierra las tareas abiertas con una clave de origen (la de «Crear tarea»).
registerNode(completeTaskNode);
// Tiron 2, D3: un aviso por WhatsApp a un numero que puede no ser de ningun contacto (sirve con y sin contacto).
registerNode(sendWhatsAppNumberNode);
