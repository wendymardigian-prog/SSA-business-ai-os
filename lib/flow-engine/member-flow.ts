/**
 * Flujos sin contacto ("sobre una persona del equipo", E15): de qué se trata un flujo y
 * qué pasos no puede tener. Lo usan el guardado del canvas, su publicación y el editor de
 * pasos del EOD: guardar un flujo así con un paso que necesita un contacto se rechaza en
 * el servidor. El motor igual los saltea si llegaran (red de seguridad).
 */
import { getNode, getTrigger } from "./registry";

interface RawNode {
  id?: string;
  type?: string;
  data?: unknown;
}

/** Sobre quién es el flujo: lo dice su disparador. Sin disparador conocido, `contact`. */
export function flowSubject(nodes: unknown[]): "contact" | "member" {
  const trigger = (nodes as RawNode[]).find((n) => n?.type === "trigger");
  const type = (trigger?.data as { triggerType?: unknown } | undefined)?.triggerType;
  return typeof type === "string" && getTrigger(type)?.subject === "member" ? "member" : "contact";
}

export const MEMBER_FLOW_NOTICE = "Este flujo es sobre una persona del equipo, no sobre un contacto: no puede mandar mensajes por chat ni tocar contactos.";

/**
 * Los pasos que un flujo sin contacto no puede tener, en palabras. Vacío si el flujo es sobre
 * un contacto o si todos sus pasos sirven sin contacto. `subjectOfFlow` dice de qué se trata
 * otro flujo (para "Ir a otro flujo", que solo puede ir a otro flujo sin contacto).
 */
export function memberFlowProblems(nodes: unknown[], subjectOfFlow?: (flowId: string) => "contact" | "member" | undefined): string[] {
  if (flowSubject(nodes) !== "member") return [];
  const problems: string[] = [];
  for (const node of nodes as RawNode[]) {
    if (!node || node.type === "trigger") continue;
    const definition = getNode({ type: String(node.type ?? ""), data: node.data });
    if (!definition) continue;
    const data = (node.data ?? {}) as { label?: unknown; flowId?: unknown };
    const name = typeof data.label === "string" && data.label.trim() ? data.label.trim() : definition.label;
    if (definition.needsContact) {
      problems.push(`El paso «${name}» necesita un contacto, y este flujo es sobre una persona del equipo.`);
      continue;
    }
    if (definition.type === "goToFlow" && subjectOfFlow && typeof data.flowId === "string" && subjectOfFlow(data.flowId) !== "member") {
      problems.push(`«${name}» solo puede ir a otro flujo sobre una persona del equipo.`);
    }
  }
  return problems;
}
