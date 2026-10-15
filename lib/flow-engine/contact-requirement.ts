/**
 * ¿En todos los caminos hay un contacto antes de cada paso que lo necesita? (Extra L, F10)
 *
 * Un flujo disparado por un webhook arranca SIN contacto: el contacto aparece cuando el paso
 * "Crear o actualizar contacto" lo crea o lo encuentra, y recién después pueden correr los pasos
 * que necesitan uno (mandar un mensaje, poner un tag...). Esto lo exige el editor al guardar y al
 * publicar: un paso que necesita contacto tiene que tener, en TODOS los caminos que llegan hasta
 * él desde el disparador, un paso de contacto antes, y haber salido por su salida «Listo».
 *
 * Es un análisis "en todos los caminos" sobre el grafo (puede tener ciclos): se parte de que cada
 * paso tiene contacto garantizado y se va quitando donde algún camino llega sin él, hasta que no
 * cambia nada. PURO: no toca la base. El motor igual saltea y anota un paso sin contacto (red de
 * seguridad para lo que se publicó antes).
 */
import { getNode } from "./registry";
import { isContactFree } from "./nodes/branch";
import { canonicalNodeType } from "./node-outputs";
import type { BranchCondition } from "./condition-eval";
import type { TriggerSubject } from "./registry/types";

export interface GraphNode {
  id?: string;
  type?: string;
  data?: unknown;
}
export interface GraphEdge {
  source?: string;
  target?: string;
  sourceHandle?: string | null;
}

/** El tipo del paso que le da contacto al flujo. */
export const CONTACT_STEP_TYPE = "upsert_contact";
/** Su salida «Listo» (la otra, «No se pudo», no garantiza contacto). */
export const CONTACT_STEP_OK_HANDLE = "ok";

/** De qué se trata otro flujo (para "Ir a otro flujo"): lo da quien llama, que sabe leer la base. */
export type SubjectOfFlow = (flowId: string) => TriggerSubject | undefined;

/** ¿Este paso necesita un contacto para hacer lo suyo? Y si sí, por qué (para el mensaje). */
export function nodeNeedsContact(node: GraphNode, subjectOfFlow?: SubjectOfFlow): boolean {
  const type = canonicalNodeType({ type: String(node.type ?? ""), data: node.data });
  if (type === "trigger") return false;
  const definition = getNode({ type: String(node.type ?? ""), data: node.data });
  if (!definition) return false;
  if (definition.needsContact) return true;

  const data = (node.data ?? {}) as Record<string, unknown>;
  switch (definition.type) {
    case "branch": {
      // Una condición que lee algo del contacto (tags, campos...) necesita uno para poder cumplirse.
      const paths = Array.isArray(data.paths) ? (data.paths as Array<{ conditions?: unknown }>) : [];
      return paths.some((p) => Array.isArray(p?.conditions) && (p.conditions as BranchCondition[]).some((c) => c && !isContactFree(c)));
    }
    case "send_email":
      // Sin `to` el email va al contacto; los demás destinos (equipo, dirección fija) no lo necesitan.
      return (data.to ?? "contact") === "contact";
    case "goToFlow": {
      const target = typeof data.flowId === "string" ? subjectOfFlow?.(data.flowId) : undefined;
      // Solo otro flujo sin contacto (de webhook, de persona o de sistema) corre bien sin uno.
      return target !== "webhook" && target !== "member" && target !== "system";
    }
    default:
      return false;
  }
}

export interface MissingContact {
  nodeId: string;
  /** El nombre que ve la persona: la etiqueta del paso o su nombre de catálogo. */
  name: string;
  /** El tipo canónico del paso (para el mensaje: los de agenda y ventas piden la reunión o la venta, no un contacto). */
  nodeType: string;
}

/**
 * Los pasos que actúan sobre LA reunión o LA venta que disparó el flujo (no sobre un contacto suelto): leen
 * `event_booking_id` / `event_sale_id` y los demás datos del evento. Un flujo que no arrancó por una reunión o una
 * venta (un webhook, un reporte de fin de día, el sistema) no las tiene, y «Crear o actualizar contacto» no se las da.
 * Siguen declarando `needsContact: true` (la reunión y la venta tienen contacto); esto solo corrige lo que se le dice
 * a la persona. Tirón 2, D2.
 */
export const TRIGGER_ENTITY_NODES: Readonly<Record<string, "reunión" | "venta">> = {
  cancel_booking: "reunión",
  set_booking_status: "reunión",
  mark_payment_paid: "venta",
  reschedule_payment: "venta",
  set_sale_status: "venta",
};

/** «la reunión» / «la venta» si el paso actúa sobre la del disparador; null si no. */
export function triggerEntityOf(nodeType: string): "reunión" | "venta" | null {
  return TRIGGER_ENTITY_NODES[nodeType] ?? null;
}

const nameOf = (node: GraphNode): string => {
  const label = (node.data as { label?: unknown } | undefined)?.label;
  if (typeof label === "string" && label.trim()) return label.trim();
  return getNode({ type: String(node.type ?? ""), data: node.data })?.label ?? String(node.type ?? "paso");
};

/**
 * Los pasos que necesitan contacto y a los que se puede llegar sin tenerlo por algún camino.
 * Los pasos que no se alcanzan desde el disparador no se miran.
 */
export function pathsMissingContact(nodes: GraphNode[], edges: GraphEdge[], subjectOfFlow?: SubjectOfFlow): MissingContact[] {
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) if (n?.id) byId.set(n.id, n);
  const trigger = nodes.find((n) => n?.type === "trigger" && n.id);
  if (!trigger?.id) return [];

  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (!e?.source || !e?.target || !byId.has(e.source) || !byId.has(e.target)) continue;
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  // Alcanzables desde el disparador.
  const reachable = new Set<string>([trigger.id]);
  const queue = [trigger.id];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const e of outgoing.get(id) ?? []) {
      if (e.target && !reachable.has(e.target)) {
        reachable.add(e.target);
        queue.push(e.target);
      }
    }
  }

  // hasContact[id]: ¿al llegar a este paso, TODOS los caminos ya tienen contacto?
  const hasContact = new Map<string, boolean>();
  for (const id of reachable) hasContact.set(id, id !== trigger.id);

  const providesContactOn = (edge: GraphEdge): boolean => {
    const source = byId.get(edge.source!);
    if (!source) return false;
    return canonicalNodeType({ type: String(source.type ?? ""), data: source.data }) === CONTACT_STEP_TYPE && edge.sourceHandle === CONTACT_STEP_OK_HANDLE;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachable) {
      if (id === trigger.id || !hasContact.get(id)) continue;
      const arriving = (incoming.get(id) ?? []).filter((e) => reachable.has(e.source!));
      const everyPathHasContact = arriving.every((e) => providesContactOn(e) || hasContact.get(e.source!) === true);
      if (!everyPathHasContact) {
        hasContact.set(id, false);
        changed = true;
      }
    }
  }

  const missing: MissingContact[] = [];
  for (const id of reachable) {
    const node = byId.get(id)!;
    if (id === trigger.id) continue;
    if (!hasContact.get(id) && nodeNeedsContact(node, subjectOfFlow)) {
      missing.push({ nodeId: id, name: nameOf(node), nodeType: canonicalNodeType({ type: String(node.type ?? ""), data: node.data }) });
    }
  }
  return missing;
}

/** El texto para quien edita: qué paso y qué hacer. */
export function missingContactMessage(name: string, nodeType?: string): string {
  const entity = nodeType ? triggerEntityOf(nodeType) : null;
  if (entity) {
    return `«${name}» actúa sobre la ${entity} que dispara el flujo, y este flujo no arranca por una ${entity}: no tiene ninguna. Solo se puede usar en un flujo que empieza con un disparador de ${entity === "reunión" ? "agenda" : "venta"}.`;
  }
  return `«${name}» necesita un contacto. Poné antes «Crear o actualizar contacto» y conectá este paso a su salida «Listo».`;
}
