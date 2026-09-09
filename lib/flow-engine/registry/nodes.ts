/**
 * Alta de los tipos de nodo.
 *
 * Los once nodos que el panel guarda como `type: "action"` declaran su alias en
 * su propio archivo, asi que aca solo hay altas.
 */

import { registerNode } from "./registry";
import { sendMessageNode } from "../nodes/send-message";
import { conditionNode } from "../nodes/condition";
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

registerNode(sendMessageNode);
registerNode(aiResponseNode);
registerNode(conditionNode);
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
