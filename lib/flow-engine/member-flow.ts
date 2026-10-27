/**
 * Flujos sin contacto ("sobre una persona del equipo", E15): de qué se trata un flujo y
 * qué pasos no puede tener. Lo usan el guardado del canvas, su publicación y los editores de
 * pasos: guardar un flujo así con un paso que necesita un contacto se rechaza en
 * el servidor. El motor igual los saltea si llegaran (red de seguridad).
 */
import { getNode, getTrigger } from "./registry";
import type { TriggerSubject } from "./registry/types";
import { missingContactMessage, pathsMissingContact, triggerEntityOf, type GraphEdge, type SubjectOfFlow } from "./contact-requirement";

interface RawNode {
  id?: string;
  type?: string;
  data?: unknown;
}

/**
 * Sobre quién es el flujo: lo dice su disparador. Sin disparador conocido, `contact`.
 * `member` es de una persona del equipo (nunca tiene contacto); `webhook` arranca sin
 * contacto y lo consigue con el paso "Crear o actualizar contacto"; `system` (Tirón 2, D1) no es
 * sobre ningún contacto ni persona: nunca tiene contacto.
 */
export function flowSubject(nodes: unknown[]): TriggerSubject {
  const trigger = (nodes as RawNode[]).find((n) => n?.type === "trigger");
  const type = (trigger?.data as { triggerType?: unknown } | undefined)?.triggerType;
  const subject = typeof type === "string" ? getTrigger(type)?.subject : undefined;
  return subject === "member" ? "member" : subject === "webhook" ? "webhook" : subject === "system" ? "system" : "contact";
}

/** ¿El flujo nunca tiene contacto? (de una persona del equipo o de sistema). Un flujo de webhook lo consigue a mitad de camino. */
export const isNoContactSubject = (subject: TriggerSubject | undefined): boolean => subject === "member" || subject === "system";

/**
 * Los pasos de un flujo de webhook que necesitan un contacto que todavía no hay por algún camino,
 * en palabras. Vacío si el flujo no es de webhook. A diferencia de los flujos de persona, un paso
 * que necesita contacto SÍ se puede usar: después de «Crear o actualizar contacto», por su salida
 * «Listo», en todos los caminos.
 */
export function webhookFlowProblems(nodes: unknown[], edges: unknown[], subjectOfFlow?: SubjectOfFlow): string[] {
  if (flowSubject(nodes) !== "webhook") return [];
  return pathsMissingContact(nodes as RawNode[], edges as GraphEdge[], subjectOfFlow).map((m) => missingContactMessage(m.name, m.nodeType));
}

export const MEMBER_FLOW_NOTICE = "Este flujo es sobre una persona del equipo, no sobre un contacto: no puede mandar mensajes por chat ni tocar contactos.";

/**
 * Los pasos que un flujo sin contacto no puede tener, en palabras. Vacío si el flujo es sobre
 * un contacto o si todos sus pasos sirven sin contacto. `subjectOfFlow` dice de qué se trata
 * otro flujo (para "Ir a otro flujo", que solo puede ir a otro flujo sin contacto).
 */
export function memberFlowProblems(nodes: unknown[], subjectOfFlow?: (flowId: string) => TriggerSubject | undefined): string[] {
  const subject = flowSubject(nodes);
  if (!isNoContactSubject(subject)) return [];
  const about = subject === "member" ? "una persona del equipo" : "el sistema, sin contacto ni persona";
  const problems: string[] = [];
  for (const node of nodes as RawNode[]) {
    if (!node || node.type === "trigger") continue;
    const definition = getNode({ type: String(node.type ?? ""), data: node.data });
    if (!definition) continue;
    const data = (node.data ?? {}) as { label?: unknown; flowId?: unknown };
    const name = typeof data.label === "string" && data.label.trim() ? data.label.trim() : definition.label;
    if (definition.needsContact) {
      const entity = triggerEntityOf(definition.type);
      problems.push(
        entity
          ? `El paso «${name}» actúa sobre la ${entity} que dispara el flujo, y este flujo es sobre ${about}: no tiene ninguna.`
          : `El paso «${name}» necesita un contacto, y este flujo es sobre ${about}.`,
      );
      continue;
    }
    if (definition.type === "goToFlow" && subjectOfFlow && typeof data.flowId === "string" && !isNoContactSubject(subjectOfFlow(data.flowId))) {
      problems.push(subject === "member" ? `«${name}» solo puede ir a otro flujo sobre una persona del equipo.` : `«${name}» solo puede ir a otro flujo sin contacto (de una persona del equipo o del sistema).`);
    }
  }
  return problems;
}
