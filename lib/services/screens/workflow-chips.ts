// @plantilla-quitar(servicios)
/**
 * Los workflows del camino (F117). No hay tablas nuevas: un workflow del camino es una automatización con un
 * disparador de Servicios filtrado por la variante y, según el lugar, por el paso o la fase. Puro.
 *
 * Lugares («slots») del camino:
 *  - `start`               Cuando empieza el servicio   (service_started, variant_id)
 *  - `item:<key>`          Al completar un paso         (service_item_completed, variant_id + item_key)
 *  - `phase_start:<key>`   Al empezar la fase           (service_phase_started, variant_id + phase_key)
 *  - `phase_end:<key>`     Al terminar la fase          (service_phase_completed, variant_id + phase_key)
 *  - `ending`              Antes de terminar el servicio (service_ending_soon, variant_id + days_before)
 *  - `completes:<key>`     Lo completan (A4, F150): cualquier automatización con un paso «Completar paso» de ese
 *                          paso, sea cual sea su disparador.
 */
import { SERVICE_TRIGGER_LABELS, type ServiceTriggerType } from "../automation";

export type PathSlot = "start" | "ending" | `item:${string}` | `phase_start:${string}` | `phase_end:${string}` | `completes:${string}`;

export interface SlotTrigger {
  triggerType: ServiceTriggerType;
  config: Record<string, unknown>;
}

export function slotTrigger(variantId: string, slot: PathSlot, daysBefore = 7): SlotTrigger {
  if (slot === "start") return { triggerType: "service_started", config: { variant_id: variantId } };
  if (slot === "ending") return { triggerType: "service_ending_soon", config: { variant_id: variantId, days_before: daysBefore } };
  const [kind, key] = slot.split(":") as [string, string];
  if (kind === "item") return { triggerType: "service_item_completed", config: { variant_id: variantId, item_key: key } };
  if (kind === "phase_start") return { triggerType: "service_phase_started", config: { variant_id: variantId, phase_key: key } };
  return { triggerType: "service_phase_completed", config: { variant_id: variantId, phase_key: key } };
}

/** El lugar del camino de una automatización, o null si no es de esta variante. */
export function slotOf(variantId: string, trigger: { triggerType?: unknown; config?: unknown } | null | undefined): PathSlot | null {
  if (!trigger) return null;
  const c = (trigger.config && typeof trigger.config === "object" ? trigger.config : {}) as Record<string, unknown>;
  if (c.variant_id !== variantId) return null;
  switch (trigger.triggerType) {
    case "service_started":
      return "start";
    case "service_ending_soon":
      return "ending";
    case "service_item_completed":
      return typeof c.item_key === "string" && c.item_key ? `item:${c.item_key}` : null;
    case "service_phase_started":
      return typeof c.phase_key === "string" && c.phase_key ? `phase_start:${c.phase_key}` : null;
    case "service_phase_completed":
      return typeof c.phase_key === "string" && c.phase_key ? `phase_end:${c.phase_key}` : null;
    default:
      return null;
  }
}

export interface CanvasNodeLike {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}
export interface CanvasEdgeLike {
  source: string;
  target: string;
}

/** El nodo disparador de un flujo (su tipo y su configuración). */
export function triggerOf(nodes: CanvasNodeLike[]): { triggerType?: unknown; config?: unknown } | null {
  const t = nodes.find((n) => n.type === "trigger");
  return t ? { triggerType: t.data?.triggerType, config: t.data?.config ?? t.data } : null;
}

/** Las etiquetas de la línea de chips: el disparador y después los pasos en el orden en que corren. */
export function chipsFor(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], labelFor: (type: string) => string): string[] {
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return [];
  const tt = trigger.data?.triggerType as ServiceTriggerType | undefined;
  const out = [tt && SERVICE_TRIGGER_LABELS[tt] ? SERVICE_TRIGGER_LABELS[tt].label : "Disparador"];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([trigger.id]);
  const queue = edges.filter((e) => e.source === trigger.id).map((e) => e.target);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    const named = typeof n.data?.label === "string" && n.data.label.trim() ? (n.data.label as string).trim() : "";
    const type = (n.type === "action" ? (n.data?.actionType as string) : n.type) ?? "";
    out.push(named || labelFor(type));
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return out;
}

/** Los nodos de un workflow nuevo: solo el disparador, ya filtrado. */
export function newPathWorkflowNodes(trigger: SlotTrigger): CanvasNodeLike[] {
  return [
    {
      id: "trigger",
      type: "trigger",
      data: { triggerType: trigger.triggerType, config: { ...trigger.config }, ...trigger.config },
    },
  ];
}

/** Los pasos del camino que completa un flujo (sus nodos «Completar paso», A4 F150). */
export function completedItemKeys(nodes: CanvasNodeLike[]): string[] {
  const keys = nodes
    .filter((n) => n.type === "svc_complete_step" && typeof n.data?.itemKey === "string" && n.data.itemKey)
    .map((n) => n.data!.itemKey as string);
  return [...new Set(keys)];
}

/** «+ Workflow que lo complete»: el disparador queda sin elegir y el paso «Completar paso» ya apunta al paso. */
export function newCompleterWorkflow(itemKey: string, productId: string | null): { nodes: CanvasNodeLike[]; edges: Array<CanvasEdgeLike & { id: string }> } {
  return {
    nodes: [
      { id: "trigger", type: "trigger", data: { triggerType: null } },
      { id: "complete", type: "svc_complete_step", data: { itemKey, ...(productId ? { productId } : {}) } },
    ],
    edges: [{ id: "e-trigger-complete", source: "trigger", target: "complete" }],
  };
}

/**
 * Al duplicar una fase o un paso (A4, F149) sus workflows se copian EN PAUSA: los nodos de la copia apuntan a las
 * claves nuevas (el filtro del disparador y los «Completar paso»). Devuelve null si el flujo no toca ninguna clave
 * copiada. Puro.
 */
export function remapWorkflowNodes(nodes: CanvasNodeLike[], keyMap: Record<string, string>): CanvasNodeLike[] | null {
  let touched = false;
  const swap = (v: unknown) => {
    if (typeof v === "string" && keyMap[v]) {
      touched = true;
      return keyMap[v];
    }
    return v;
  };
  const out = nodes.map((n) => {
    const data = { ...(n.data ?? {}) };
    if (n.type === "trigger") {
      for (const k of ["item_key", "phase_key"]) if (k in data) data[k] = swap(data[k]);
      if (data.config && typeof data.config === "object") {
        const c = { ...(data.config as Record<string, unknown>) };
        for (const k of ["item_key", "phase_key"]) if (k in c) c[k] = swap(c[k]);
        data.config = c;
      }
    } else if (n.type === "svc_complete_step" && "itemKey" in data) {
      data.itemKey = swap(data.itemKey);
    }
    return { ...n, data };
  });
  return touched ? out : null;
}

export interface PathWorkflow {
  id: string;
  name: string;
  status: string;
  slot: PathSlot;
  chips: string[];
  runs30d: number;
  failed30d: number;
  waiting: number;
}

/** Las automatizaciones de esta variante, agrupadas por su lugar del camino. */
export function groupBySlot(workflows: PathWorkflow[]): Map<PathSlot, PathWorkflow[]> {
  const out = new Map<PathSlot, PathWorkflow[]>();
  for (const w of workflows) out.set(w.slot, [...(out.get(w.slot) ?? []), w]);
  return out;
}

/** Workflows cuyo paso o fase ya no está en el camino (se pausan al guardar). */
export function orphanWorkflows(workflows: Array<{ id: string; slot: PathSlot }>, template: { phases: Array<{ key: string; items: Array<{ key: string }> }> }): string[] {
  const phases = new Set(template.phases.map((p) => p.key));
  const items = new Set(template.phases.flatMap((p) => p.items.map((i) => i.key)));
  return workflows
    .filter((w) => {
      if (w.slot.startsWith("item:")) return !items.has(w.slot.slice(5));
      if (w.slot.startsWith("phase_start:")) return !phases.has(w.slot.slice(12));
      if (w.slot.startsWith("phase_end:")) return !phases.has(w.slot.slice(10));
      return false;
    })
    .map((w) => w.id);
}

/** «12 ejecuciones · 2 con error · 1 esperando» (los ceros no se muestran). */
export function workflowStatsLabel(w: Pick<PathWorkflow, "runs30d" | "failed30d" | "waiting">): string {
  const parts = [`${w.runs30d} ${w.runs30d === 1 ? "ejecución" : "ejecuciones"} en 30 días`];
  if (w.failed30d > 0) parts.push(`${w.failed30d} con error`);
  if (w.waiting > 0) parts.push(`${w.waiting} esperando`);
  return parts.join(" · ");
}
