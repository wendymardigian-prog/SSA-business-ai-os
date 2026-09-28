/**
 * Un flujo de evento visto como una lista (F57).
 *
 * El editor del evento no es el canvas: es "Cuándo / Si / Entonces" con los
 * pasos uno abajo del otro. Eso solo se puede mostrar cuando el flujo ES una
 * línea: un trigger, una condición opcional y una secuencia de pasos.
 *
 * Si el flujo tiene ramas (un Condition con dos salidas que siguen distinto,
 * un A/B), no se puede dibujar así sin mentir. En ese caso devuelve null y la
 * pantalla lo muestra en modo lectura con el botón "Abrir en el canvas". Es
 * preferible a mostrar una versión simplificada que al guardar borre la rama
 * que no se veía.
 *
 * Puro: entra el grafo del canvas, sale la lista, y al revés.
 */

export interface CanvasNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export type LinearStep =
  | { kind: "email"; to: string; subject: string; body: string }
  | { kind: "whatsapp"; text: string }
  | { kind: "delay"; duration: number; unit: string }
  | { kind: "tag"; action: string; tagName: string }
  | { kind: "booking_status"; status: string }
  | { kind: "cancel_booking"; status: string }
  /** Cualquier otro nodo: se muestra con su nombre y no se puede editar acá. */
  | { kind: "other"; type: string; label: string };

export interface LinearFlow {
  trigger: { type: string; config: Record<string, unknown> };
  /** El nodo Condition, si el flujo tiene uno y las dos salidas siguen igual. */
  conditions: string[];
  steps: LinearStep[];
}

/** Los pasos que el editor lineal sabe editar. Los demás son "other". */
function toStep(node: CanvasNode): LinearStep {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const actionType = typeof data.actionType === "string" ? data.actionType : node.type;

  switch (actionType) {
    case "send_email":
      return {
        kind: "email",
        to: String(data.to ?? "contact"),
        subject: String(data.subject ?? ""),
        body: String(data.body ?? ""),
      };
    case "sendMessage": {
      const messages = Array.isArray(data.messages) ? (data.messages as Array<{ text?: string }>) : [];
      return { kind: "whatsapp", text: String(messages[0]?.text ?? "") };
    }
    case "delay":
      return { kind: "delay", duration: Number(data.duration ?? 1), unit: String(data.unit ?? "hours") };
    case "addTag":
    case "removeTag":
      return { kind: "tag", action: actionType === "addTag" ? "add" : "remove", tagName: String(data.tagName ?? "") };
    case "set_booking_status":
      return { kind: "booking_status", status: String(data.status ?? "") };
    case "cancel_booking":
      return { kind: "cancel_booking", status: String(data.status ?? "cancelled_other") };
    default:
      return { kind: "other", type: actionType, label: String(data.label ?? actionType) };
  }
}

/** El nodo siguiente, o null si hay más de uno (o ninguno). */
function nextOf(edges: CanvasEdge[], from: string): string | null {
  const out = edges.filter((e) => e.source === from);
  return out.length === 1 ? out[0].target : null;
}

/**
 * El grafo como lista, o null si tiene ramas.
 *
 * Un Condition con UNA sola salida conectada sí entra: es el caso de "si pasa
 * tal cosa, seguí; si no, cortá", que es lo que arman las plantillas.
 */
export function flowToLinear(nodes: CanvasNode[], edges: CanvasEdge[]): LinearFlow | null {
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const conditions: string[] = [];
  const steps: LinearStep[] = [];
  const seen = new Set<string>([trigger.id]);

  let currentId = nextOf(edges, trigger.id);
  while (currentId) {
    // Un ciclo no es una línea.
    if (seen.has(currentId)) return null;
    seen.add(currentId);

    const node = byId.get(currentId);
    if (!node) return null;

    const data = (node.data ?? {}) as Record<string, unknown>;
    const actionType = typeof data.actionType === "string" ? data.actionType : node.type;

    if (actionType === "condition") {
      const salidas = edges.filter((e) => e.source === node.id);
      // Dos salidas que siguen distinto es una rama: no es una línea.
      if (salidas.length > 1) return null;
      const list = Array.isArray(data.conditions) ? (data.conditions as unknown[]) : [];
      for (const c of list) conditions.push(typeof c === "string" ? c : JSON.stringify(c));
    } else if (actionType === "abSplit") {
      return null;
    } else {
      steps.push(toStep(node));
    }

    currentId = nextOf(edges, node.id);
  }

  // Un nodo suelto (sin camino desde el trigger) también es una rama.
  if (seen.size !== nodes.length) return null;

  return {
    trigger: { type: String((trigger.data ?? {}).triggerType ?? ""), config: (trigger.data ?? {}) as Record<string, unknown> },
    conditions,
    steps,
  };
}

/** La lista de vuelta a grafo, con las posiciones una abajo de la otra. */
export function linearToFlow(linear: LinearFlow): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [
    { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { ...linear.trigger.config, triggerType: linear.trigger.type } },
  ];
  const edges: CanvasEdge[] = [];
  let previous = "trigger";
  let y = 160;

  if (linear.conditions.length > 0) {
    nodes.push({ id: "condition", type: "condition", position: { x: 0, y }, data: { conditions: linear.conditions } });
    edges.push({ id: `${previous}-condition`, source: previous, target: "condition" });
    previous = "condition";
    y += 160;
  }

  linear.steps.forEach((step, i) => {
    const id = `step-${i + 1}`;
    nodes.push({ id, position: { x: 0, y }, ...nodeOf(step) });
    edges.push({ id: `${previous}-${id}`, source: previous, target: id });
    previous = id;
    y += 160;
  });

  return { nodes, edges };
}

function nodeOf(step: LinearStep): { type: string; data: Record<string, unknown> } {
  switch (step.kind) {
    case "email":
      return { type: "action", data: { actionType: "send_email", to: step.to, subject: step.subject, body: step.body } };
    case "whatsapp":
      return { type: "sendMessage", data: { messages: [{ text: step.text }] } };
    case "delay":
      return { type: "delay", data: { duration: step.duration, unit: step.unit } };
    case "tag":
      return { type: "action", data: { actionType: step.action === "add" ? "addTag" : "removeTag", tagName: step.tagName } };
    case "booking_status":
      return { type: "action", data: { actionType: "set_booking_status", status: step.status } };
    case "cancel_booking":
      return { type: "action", data: { actionType: "cancel_booking", status: step.status } };
    default:
      return { type: "action", data: { actionType: step.type, label: step.label } };
  }
}

/** "Email al contacto", "Esperar 2 horas": el resumen de un paso. */
export function describeStep(step: LinearStep): string {
  switch (step.kind) {
    case "email":
      return `Email ${step.to === "contact" ? "al contacto" : step.to === "host" ? "al anfitrión" : "a una dirección fija"}`;
    case "whatsapp":
      return "Mensaje por WhatsApp";
    case "delay":
      return `Esperar ${step.duration} ${step.unit === "hours" ? "horas" : step.unit === "days" ? "días" : "minutos"}`;
    case "tag":
      return `${step.action === "add" ? "Poner" : "Sacar"} el tag "${step.tagName}"`;
    case "booking_status":
      return `Cambiar el estado de la reunión a ${step.status}`;
    case "cancel_booking":
      return "Cancelar la reunión";
    default:
      return step.label;
  }
}
