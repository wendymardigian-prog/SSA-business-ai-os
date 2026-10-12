/**
 * Que pasos se pueden armar en el editor de pasos de cada pantalla, y como se
 * llama, se crea y se valida cada uno. PURO. Lo comparten el editor (el menu
 * "+ Agregar paso") y el servidor (que NO acepta cualquier nodo: una accion
 * que el editor no ofrece en esa pantalla solo puede venir de algo que ya
 * estaba guardado).
 *
 * Formularios: email (al contacto o a una direccion fija), mensaje, esperar,
 * poner o sacar un tag, y Condiciones.
 * Agenda: lo mismo, mas el email al anfitrion, cambiar el estado de la reunion
 * y cancelarla.
 */

import { z } from "zod";
import { BOOKING_STATUSES, isBookingStatus } from "@/lib/scheduling/booking-status";
import { actionTypeOf, newStepId, type ActionStep, type NodeData } from "./step-tree";

export type EditorScreen = "forms" | "agenda";

export type ActionKindKey = "email" | "message" | "delay" | "tag_add" | "tag_remove" | "booking_status" | "cancel_booking";

export interface ActionKind {
  key: ActionKindKey;
  /** Como se ofrece en el menu "+ Agregar paso". */
  menuLabel: string;
  /** Una frase corta para el titulo de la tarjeta (sin los datos). */
  title: string;
  /** El `type` del nodo en el canvas. */
  nodeType: "action" | "sendMessage" | "delay";
  screens: EditorScreen[];
  /** ¿Este paso es de este tipo? */
  matches(step: Pick<ActionStep, "nodeType" | "data">): boolean;
  /** Los datos de un paso nuevo. */
  blank(): NodeData;
}

const isAction = (step: Pick<ActionStep, "nodeType" | "data">, actionType: string) => actionTypeOf(step as ActionStep) === actionType;

export const ACTION_KINDS: ActionKind[] = [
  {
    key: "email",
    menuLabel: "Enviar un email",
    title: "Email",
    nodeType: "action",
    screens: ["forms", "agenda"],
    matches: (s) => isAction(s, "send_email"),
    blank: () => ({ actionType: "send_email", to: "contact", subject: "", body: "" }),
  },
  {
    key: "message",
    menuLabel: "Enviar un mensaje",
    title: "Mensaje",
    nodeType: "sendMessage",
    screens: ["forms", "agenda"],
    matches: (s) => s.nodeType === "sendMessage",
    blank: () => ({ messages: [{ text: "" }], onlyIfPhone: true }),
  },
  {
    key: "delay",
    menuLabel: "Esperar un tiempo",
    title: "Esperar",
    nodeType: "delay",
    screens: ["forms", "agenda"],
    matches: (s) => s.nodeType === "delay",
    blank: () => ({ duration: 1, unit: "hours" }),
  },
  {
    key: "tag_add",
    menuLabel: "Agregar un tag",
    title: "Agregar un tag",
    nodeType: "action",
    screens: ["forms", "agenda"],
    matches: (s) => isAction(s, "addTag"),
    blank: () => ({ actionType: "addTag", tagName: "" }),
  },
  {
    key: "tag_remove",
    menuLabel: "Quitar un tag",
    title: "Quitar un tag",
    nodeType: "action",
    screens: ["forms", "agenda"],
    matches: (s) => isAction(s, "removeTag"),
    blank: () => ({ actionType: "removeTag", tagName: "" }),
  },
  {
    key: "booking_status",
    menuLabel: "Cambiar el estado de la reunión",
    title: "Estado de la reunión",
    nodeType: "action",
    screens: ["agenda"],
    matches: (s) => isAction(s, "set_booking_status"),
    blank: () => ({ actionType: "set_booking_status", status: "confirmed" }),
  },
  {
    key: "cancel_booking",
    menuLabel: "Cancelar la reunión",
    title: "Cancelar la reunión",
    nodeType: "action",
    screens: ["agenda"],
    matches: (s) => isAction(s, "cancel_booking"),
    blank: () => ({ actionType: "cancel_booking", status: "cancelled_other" }),
  },
];

export function actionKindsFor(screen: EditorScreen): ActionKind[] {
  return ACTION_KINDS.filter((k) => k.screens.includes(screen));
}

export function actionKind(key: ActionKindKey): ActionKind {
  return ACTION_KINDS.find((k) => k.key === key)!;
}

/** El tipo de un paso en esta pantalla, o `undefined` si el editor no sabe editarlo ahi (se muestra con su nombre, solo lectura). */
export function kindOfStep(step: Pick<ActionStep, "nodeType" | "data">, screen: EditorScreen): ActionKind | undefined {
  return actionKindsFor(screen).find((k) => k.matches(step));
}

/** Un paso nuevo de este tipo, con un id que no choca. */
export function newActionStep(kind: ActionKind, taken: Iterable<string>, random?: () => number): ActionStep {
  return { kind: "action", id: newStepId(taken, random), nodeType: kind.nodeType, data: kind.blank() };
}

// ------------------------------------------------------------
// Lo que dice cada paso, en palabras
// ------------------------------------------------------------

const UNITS: Record<string, [string, string]> = {
  seconds: ["segundo", "segundos"],
  minutes: ["minuto", "minutos"],
  hours: ["hora", "horas"],
  days: ["día", "días"],
};

export const EMAIL_RECIPIENT_LABELS: Record<string, string> = { contact: "al contacto", host: "al anfitrión", fixed: "a una dirección fija" };

/** A quien se le puede mandar un email en cada pantalla. */
export function emailRecipientsFor(screen: EditorScreen): Array<"contact" | "host" | "fixed"> {
  return screen === "agenda" ? ["contact", "host", "fixed"] : ["contact", "fixed"];
}

/** Los nombres de los nodos que el editor no edita, para mostrarlos con algo mas que su clave. */
const OTHER_LABELS: Record<string, string> = {
  httpRequest: "Llamada HTTP",
  setCustomField: "Cambiar un campo del contacto",
  goToFlow: "Ir a otra automatización",
  humanTakeover: "Pasar a una persona",
  subscribe: "Suscribir",
  unsubscribe: "Desuscribir",
  enrollSequence: "Inscribir en una secuencia",
  pauseAgent: "Pausar el agente de IA",
  resumeAgent: "Reanudar el agente de IA",
  sendAsset: "Enviar un recurso",
  aiResponse: "Respuesta del agente de IA",
  smartDelay: "Espera inteligente",
  mark_payment_paid: "Marcar el pago como cobrado",
  reschedule_payment: "Reprogramar el pago",
  set_sale_status: "Cancelar la venta",
};

/** "Email al contacto", "Esperar 2 horas": el resumen de un paso. */
export function describeAction(step: ActionStep, screen: EditorScreen): string {
  const kind = kindOfStep(step, screen);
  const d = step.data;
  switch (kind?.key) {
    case "email":
      return `Email ${EMAIL_RECIPIENT_LABELS[String(d.to ?? "contact")] ?? "al contacto"}`;
    case "message":
      return "Mensaje al contacto";
    case "delay": {
      const [one, many] = UNITS[String(d.unit)] ?? ["minuto", "minutos"];
      const n = Number(d.duration ?? 1);
      return `Esperar ${n} ${n === 1 ? one : many}`;
    }
    case "tag_add":
      return `Agregar el tag «${String(d.tagName ?? "")}»`;
    case "tag_remove":
      return `Quitar el tag «${String(d.tagName ?? "")}»`;
    case "booking_status":
      return `Cambiar el estado de la reunión a ${bookingStatusLabel(String(d.status ?? ""))}`;
    case "cancel_booking":
      return "Cancelar la reunión";
    default: {
      const label = typeof d.label === "string" && d.label.trim() ? d.label.trim() : undefined;
      return label ?? OTHER_LABELS[actionTypeOf(step)] ?? actionTypeOf(step);
    }
  }
}

export function bookingStatusLabel(status: string): string {
  return BOOKING_STATUSES.find((s) => s.key === status)?.label ?? status;
}

/** Un email, un mensaje o un tag sin completar: lo que falta, para avisar antes de guardar. */
export function actionProblem(step: ActionStep, screen: EditorScreen): string | null {
  const kind = kindOfStep(step, screen);
  const d = step.data;
  switch (kind?.key) {
    case "email":
      if (d.to === "fixed" && !EMAIL_RE.test(String(d.fixedEmail ?? ""))) return "Falta una dirección de email válida.";
      if (!String(d.subject ?? "").trim() && !String(d.body ?? "").trim()) return "El email está vacío: falta el asunto o el texto.";
      return null;
    case "message": {
      const first = Array.isArray(d.messages) ? (d.messages[0] as { text?: unknown } | undefined) : undefined;
      return String(first?.text ?? "").trim() ? null : "El mensaje está vacío.";
    }
    case "tag_add":
    case "tag_remove":
      return String(d.tagName ?? "").trim() ? null : "Falta el nombre del tag.";
    default:
      return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ------------------------------------------------------------
// Validacion de los datos (la usa el servidor)
// ------------------------------------------------------------

const label = z.string().max(120).optional();

const emailData = (screen: EditorScreen) =>
  z
    .object({
      actionType: z.literal("send_email"),
      to: z.enum(emailRecipientsFor(screen) as [string, ...string[]]),
      fixedEmail: z.string().max(254).optional(),
      subject: z.string().max(300),
      body: z.string().max(20000),
      label,
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.to === "fixed" && !EMAIL_RE.test(value.fixedEmail ?? "")) ctx.addIssue({ code: "custom", message: "Falta una dirección de email válida.", path: ["fixedEmail"] });
    });

const messageData = z
  .object({
    messages: z.array(z.object({ text: z.string().max(4000).optional() }).passthrough()).min(1).max(10),
    onlyIfPhone: z.boolean().optional(),
    label,
  })
  .passthrough();

const delayData = z
  .object({
    duration: z.number().positive().max(100_000),
    unit: z.enum(["seconds", "minutes", "hours", "days"]),
    label,
  })
  .passthrough();

const tagData = (actionType: "addTag" | "removeTag") =>
  z.object({ actionType: z.literal(actionType), tagName: z.string().trim().min(1).max(100), label }).passthrough();

const statusData = z
  .object({
    actionType: z.literal("set_booking_status"),
    status: z.string().refine(isBookingStatus, "Ese estado de reunión no existe."),
    label,
  })
  .passthrough();

const cancelData = z
  .object({
    actionType: z.literal("cancel_booking"),
    status: z.enum(["cancelled_other", "cancelled_no_response", "cancelled_not_qualified"]),
    label,
  })
  .passthrough();

/** Los datos de un paso editable, validados. `null` si estan bien, o el motivo. */
export function validateActionData(step: ActionStep, screen: EditorScreen): string | null {
  const kind = kindOfStep(step, screen);
  if (!kind) return "Ese paso no se puede armar en esta pantalla.";
  const schema = (() => {
    switch (kind.key) {
      case "email":
        return emailData(screen);
      case "message":
        return messageData;
      case "delay":
        return delayData;
      case "tag_add":
        return tagData("addTag");
      case "tag_remove":
        return tagData("removeTag");
      case "booking_status":
        return statusData;
      case "cancel_booking":
        return cancelData;
    }
  })();
  const parsed = schema.safeParse(step.data);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return `${kind.title}: ${issue.message}`;
}
