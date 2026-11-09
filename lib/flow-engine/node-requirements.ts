/**
 * Que conexion necesita cada accion de una automatizacion (G1).
 *
 * Las acciones SIGUEN APARECIENDO en el constructor aunque falte la conexion:
 * poder descubrir lo que el sistema sabe hacer antes de conectar todo es parte
 * del producto. Pero una accion bloqueada se ve bloqueada (con el motivo, y a
 * donde ir a conectarlo) y NUNCA se confunde con una que va a ejecutarse:
 *
 *   - Se puede agregar y configurar: el borrador se guarda igual (se puede
 *     armar la automatizacion tranquila y conectar despues).
 *   - NO se puede PUBLICAR un flujo con una accion bloqueada que se alcance
 *     desde el disparador (lo exige el servidor, en `publishFlow`).
 *   - Al conectar la integracion, la accion se habilita sola: el estado se
 *     calcula al abrir la pantalla, no se guarda en el flujo.
 *   - Un flujo YA publicado al que se le desconecta algo no se despublica solo:
 *     se avisa que pasos no van a ejecutarse (G1.6).
 *
 * Puro y sin importar el registro (que trae codigo de servidor): lo importa el
 * navegador. `registry/consistency.test.ts` exige que esta lista diga lo mismo
 * que `requires` de cada nodo del registro.
 */

import { sendWindowProblem, type SendWindowData } from "./send-window";
import { canonicalNodeType } from "./node-outputs";
import { designGenerateProblem, hasDesignStepBefore, isDesignGenerateNode, type DesignGenerateNodeData } from "@/lib/designer/automation/node-config";
import { isDesignAttachment, parseEmailAttachments } from "@/lib/email/attachment-limits";
import { designFlowFormProblem } from "@/lib/designer/automation/flow-template";

export type Requirement = "email" | "whatsapp_channel" | "ai" | "agent" | "channel" | "meta_capi";
export type Capabilities = Record<Requirement, boolean>;

/** Todo conectado: lo que se usa cuando no se sabe (una pantalla que no cargo las conexiones no bloquea nada). */
export const ALL_CONNECTED: Capabilities = { email: true, whatsapp_channel: true, ai: true, agent: true, channel: true, meta_capi: true };

export interface RequirementInfo {
  /** Lo que falta, corto: "Email (Resend)". */
  label: string;
  /** A donde ir a conectarlo. */
  href: string;
  /** El texto del boton. */
  cta: string;
}

export const REQUIREMENT_INFO: Record<Requirement, RequirementInfo> = {
  email: { label: "Email saliente (Resend)", href: "/dashboard/settings/integrations/resend", cta: "Conectar Resend" },
  whatsapp_channel: { label: "Un número de WhatsApp conectado", href: "/dashboard/settings/integrations/evolution", cta: "Conectar WhatsApp" },
  ai: { label: "Una IA conectada", href: "/dashboard/settings/integrations", cta: "Conectar una IA" },
  agent: { label: "Un agente de IA", href: "/dashboard/agents", cta: "Ir a Agentes IA" },
  channel: { label: "Un canal de mensajería (Instagram, WhatsApp o email)", href: "/dashboard/settings/integrations", cta: "Conectar un canal" },
  meta_capi: { label: "La API de Conversiones de Meta", href: "/dashboard/settings/integrations/meta_capi", cta: "Conectar la API de Conversiones" },
};

/** Por tipo canonico del registro (no por el `type` del canvas: un nodo "action" lo resuelve `canonicalNodeType`). */
export const NODE_REQUIREMENTS: Readonly<Record<string, readonly Requirement[]>> = {
  send_email: ["email"],
  send_whatsapp_number: ["whatsapp_channel"],
  send_poll: ["whatsapp_channel"],
  send_to_group: ["whatsapp_channel"],
  invite_to_group: ["whatsapp_channel"],
  aiResponse: ["ai"],
  pauseAgent: ["agent"],
  resumeAgent: ["agent"],
  sendMessage: ["channel"],
  sendAsset: ["channel"],
  send_meta_event: ["meta_capi"],
};

/** El nombre de las acciones con requisitos, para decir cual esta bloqueada sin importar el registro. */
const NODE_NAMES: Readonly<Record<string, string>> = {
  send_email: "Enviar email",
  send_whatsapp_number: "Enviar WhatsApp a un número",
  send_poll: "Enviar encuesta",
  send_to_group: "Enviar al grupo",
  invite_to_group: "Invitar a un grupo",
  aiResponse: "Respuesta con IA",
  pauseAgent: "Pausar agente de IA",
  resumeAgent: "Reanudar agente de IA",
  sendMessage: "Enviar mensaje",
  sendAsset: "Enviar recurso",
  send_meta_event: "Enviar evento a Meta",
};

export function requirementsOfType(type: string): readonly Requirement[] {
  return NODE_REQUIREMENTS[type] ?? [];
}

export interface GraphNodeLike {
  id?: string;
  type?: string;
  data?: unknown;
}
export interface GraphEdgeLike {
  source?: string;
  target?: string;
}

export function requirementsOfNode(node: GraphNodeLike): readonly Requirement[] {
  return requirementsOfType(canonicalNodeType({ type: String(node.type ?? ""), data: node.data }));
}

/** Lo que falta de una lista de requisitos con estas conexiones. */
export function missingFor(requires: readonly Requirement[], capabilities: Capabilities): Requirement[] {
  return requires.filter((r) => !capabilities[r]);
}

/** "Necesita: Email saliente (Resend)". Vacio si no falta nada. */
export function needsText(missing: readonly Requirement[]): string {
  return missing.length === 0 ? "" : `Necesita: ${missing.map((r) => REQUIREMENT_INFO[r].label).join(" y ")}`;
}

export interface BlockedNode {
  nodeId: string;
  /** Lo que ve la persona: la etiqueta del paso o el nombre de la accion. */
  name: string;
  type: string;
  missing: Requirement[];
}

const nameOf = (node: GraphNodeLike, type: string): string => {
  const label = (node.data as { label?: unknown } | undefined)?.label;
  return typeof label === "string" && label.trim() ? label.trim() : (NODE_NAMES[type] ?? type);
};

/** Los pasos alcanzables desde el disparador. Sin disparador no hay nada alcanzable. */
function reachableFromTrigger(nodes: GraphNodeLike[], edges: GraphEdgeLike[]): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!e?.source || !e?.target) continue;
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }
  const seen = new Set<string>();
  const queue = nodes.filter((n) => n?.type === "trigger" && n.id).map((n) => n.id as string);
  for (const id of queue) seen.add(id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of outgoing.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Los pasos bloqueados del flujo. Por defecto solo cuentan los que se alcanzan
 * desde el disparador: una accion suelta sin conectar nunca corre y no tiene por
 * que frenar la publicacion. `all: true` los cuenta todos (para avisar en el lienzo).
 */
export function blockedNodes(nodes: GraphNodeLike[], edges: GraphEdgeLike[], capabilities: Capabilities, opts: { all?: boolean } = {}): BlockedNode[] {
  const reachable = opts.all ? null : reachableFromTrigger(nodes, edges);
  const result: BlockedNode[] = [];
  for (const node of nodes) {
    if (!node?.id || node.type === "trigger") continue;
    if (reachable && !reachable.has(node.id)) continue;
    const type = canonicalNodeType({ type: String(node.type ?? ""), data: node.data });
    const missing = missingFor(requirementsOfType(type), capabilities);
    if (missing.length > 0) result.push({ nodeId: node.id, name: nameOf(node, type), type, missing });
  }
  return result;
}

/** Los problemas que frenan la publicacion, en el lenguaje de quien arma el flujo. */
export function requirementProblems(blocked: readonly BlockedNode[]): string[] {
  return blocked.map((b) => {
    const what = b.missing.map((r) => REQUIREMENT_INFO[r].label).join(" y ");
    const where = b.missing.map((r) => REQUIREMENT_INFO[r].cta).join(" / ");
    return `«${b.name}» no se va a poder ejecutar: falta ${what}. ${where} y volvé a publicar.`;
  });
}

/**
 * Lo que le falta a la CONFIGURACIÓN de un paso para poder publicarse (no una conexión): hoy, «Generar desde plantilla»
 * sin plantilla (Diseñador IA, F57). Como los bloqueos de arriba, cuenta solo lo que se alcanza desde el disparador.
 */
export function configProblems(nodes: GraphNodeLike[], edges: GraphEdgeLike[]): string[] {
  const reachable = reachableFromTrigger(nodes, edges);
  const problems = new Set<string>();
  // Un flujo que genera diseños con un formulario sin elegir correría con cualquier formulario (F60).
  const formProblem = designFlowFormProblem(nodes.filter((n) => !!n?.id && reachable.has(n.id as string)) as Array<{ type?: string; data?: unknown }>);
  if (formProblem) problems.add(formProblem);
  for (const node of nodes) {
    if (!node?.id || !reachable.has(node.id)) continue;
    if (isDesignGenerateNode(node as { type?: string; data?: unknown })) {
      const problem = designGenerateProblem(node.data as DesignGenerateNodeData | undefined);
      if (problem) problems.add(problem);
      continue;
    }
    // «Enviar WhatsApp a un número» con un horario de envío mal armado (de 21:00 a 08:00, o horas que no son horas).
    if ((node.data as { actionType?: string } | undefined)?.actionType === "send_whatsapp_number" || node.type === "send_whatsapp_number") {
      const windowProblem = sendWindowProblem(node.data as SendWindowData | undefined);
      if (windowProblem) problems.add(windowProblem);
    }
    // «Adjuntar el PDF del diseño generado» (F59) sin un «Generar desde plantilla» antes: nunca habría PDF que adjuntar.
    const attachments = (node.data as { attachments?: unknown } | undefined)?.attachments;
    if (attachments && parseEmailAttachments(attachments).some(isDesignAttachment)) {
      const graphNodes = nodes.filter((n): n is { id: string; type?: string; data?: unknown } => !!n?.id);
      const graphEdges = edges.filter((e): e is { source: string; target: string } => !!e?.source && !!e?.target);
      if (!hasDesignStepBefore(node.id, graphNodes, graphEdges)) problems.add("El email adjunta el PDF del diseño, pero no hay un paso «Generar desde plantilla» antes.");
    }
  }
  return [...problems];
}
