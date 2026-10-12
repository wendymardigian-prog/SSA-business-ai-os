/**
 * Los cuatro flujos de cobranza que se crean APAGADOS (plano F38). Puro.
 *
 *   payment_reminder_3d   3 días antes del vencimiento, 09:00 → email
 *   payment_due_today     el día del vencimiento, 09:00 → email
 *   payment_overdue_3d    3 días después, si sigue impago → email + (si tiene WhatsApp) WhatsApp
 *   sale_settled_thanks   «Venta saldada» (sale_status_changed → paid) → email de agradecimiento
 *
 * Los textos están en español con voseo, SIN link de pago (eso es de la Fase 2) y se editan como cualquier
 * flujo. «Apagado» = `flows.status = 'draft'`: la fila de `triggers` recién se escribe al publicar, así que
 * un flujo apagado no puede disparar por accidente. RESPETAN `do_not_contact`: es cobranza, no una reunión
 * que el contacto pidió; cada flujo pasa por una puerta «no contactar» antes de enviar.
 */

export type SalesTemplateKey = "payment_reminder_3d" | "payment_due_today" | "payment_overdue_3d" | "sale_settled_thanks";

export interface SalesFlowTemplate {
  key: SalesTemplateKey;
  /** El nombre del flujo en la lista. */
  name: string;
  /** En lenguaje simple, para la descripción. */
  describe: string;
  trigger: { type: string; config: Record<string, unknown> };
  subject: string;
  body: string;
  /** Además del email, manda por WhatsApp si el contacto tiene teléfono. */
  alsoWhatsapp?: boolean;
  whatsappText?: string;
}

export const SALES_FLOW_TEMPLATES: readonly SalesFlowTemplate[] = [
  {
    key: "payment_reminder_3d",
    name: "Cobranza · Recordatorio 3 días antes",
    describe: "3 días antes del vencimiento, a las 09:00 · Email al contacto",
    trigger: { type: "payment_before_due", config: { offset_days: 3, at_time: "09:00" } },
    subject: "Tu próximo pago de {{sale.product_name}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Tu próximo pago de {{sale.product_name}} vence el {{payment.due_date}}. Si ya lo hiciste, ignorá este mensaje; si tenés dudas, respondé este email.\n\n" +
      "Gracias,\n{{workspace.name}}",
  },
  {
    key: "payment_due_today",
    name: "Cobranza · Vence hoy",
    describe: "El día del vencimiento, a las 09:00 · Email al contacto",
    trigger: { type: "payment_before_due", config: { offset_days: 0, at_time: "09:00" } },
    subject: "Hoy vence tu pago de {{sale.product_name}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Hoy vence tu pago de {{sale.product_name}} ({{payment.amount}}). Si ya lo hiciste, ignorá este mensaje; si necesitás otra fecha o tenés dudas, respondé este email.\n\n" +
      "Gracias,\n{{workspace.name}}",
  },
  {
    key: "payment_overdue_3d",
    name: "Cobranza · Pago vencido hace 3 días",
    describe: "3 días después del vencimiento, si sigue impago · Email + WhatsApp si tiene",
    trigger: { type: "payment_after_due", config: { offset_days: 3, at_time: "09:00" } },
    subject: "Tu pago de {{sale.product_name}} sigue pendiente",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Vimos que tu pago de {{sale.product_name}} ({{payment.amount}}) venció el {{payment.due_date}} y todavía no lo registramos. Si ya lo hiciste, avisanos respondiendo este email; si necesitás otra fecha, contanos y lo vemos.\n\n" +
      "Gracias,\n{{workspace.name}}",
    alsoWhatsapp: true,
    whatsappText:
      "Hola {{contact.first_name}}, te escribimos por tu pago de {{sale.product_name}} ({{payment.amount}}), que venció el {{payment.due_date}}. Si ya lo hiciste, avisanos por acá; si necesitás otra fecha, contanos y lo vemos.",
  },
  {
    key: "sale_settled_thanks",
    name: "Cobranza · Gracias por completar el pago",
    describe: "Cuando la venta queda saldada · Email de agradecimiento",
    // «Venta saldada» es el preset de sale_status_changed con to_status ['paid']: NO existe un tipo `sale_settled`.
    trigger: { type: "sale_status_changed", config: { to_status: ["paid"] } },
    subject: "¡Gracias! Completaste tu pago de {{sale.product_name}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Registramos el último pago de {{sale.product_name}}: ya está todo saldado. ¡Gracias por tu confianza!\n\n" +
      "{{workspace.name}}",
  },
];

export const SALES_TEMPLATE_KEYS: readonly SalesTemplateKey[] = SALES_FLOW_TEMPLATES.map((t) => t.key);

export function salesTemplateByKey(key: string): SalesFlowTemplate | undefined {
  return SALES_FLOW_TEMPLATES.find((t) => t.key === key);
}

interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

/**
 * El grafo de una plantilla: trigger → puerta «no contactar» → email → (WhatsApp si tiene teléfono). Es el
 * mismo formato que guarda el canvas, así que el flujo se abre y se edita en el flow builder.
 */
export function salesTemplateGraph(template: SalesFlowTemplate): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      // Guardado plano en el nodo (como lo hace el panel): el publicador lo copia a `triggers.config`.
      data: { triggerType: template.trigger.type, config: { ...template.trigger.config }, ...template.trigger.config },
    },
    {
      id: "gate",
      type: "condition",
      position: { x: 0, y: 160 },
      data: { conditions: [{ field: "do_not_contact", operator: "equals", value: "false" }], logic: "and" },
    },
    {
      id: "email",
      type: "action",
      position: { x: 0, y: 320 },
      // El alias exacto del registro (lib/flow-engine/nodes/send-email.ts): con otro nombre el motor no resuelve el nodo.
      data: { actionType: "send_email", to: "contact", subject: template.subject, body: template.body },
    },
  ];
  const edges: CanvasEdge[] = [
    { id: "trigger-gate", source: "trigger", target: "gate" },
    { id: "gate-email", source: "gate", target: "email", sourceHandle: "true" },
  ];
  if (template.alsoWhatsapp && template.whatsappText) {
    nodes.push({
      id: "whatsapp",
      type: "sendMessage",
      position: { x: 0, y: 480 },
      data: { messages: [{ text: template.whatsappText }], onlyIfPhone: true },
    });
    edges.push({ id: "email-whatsapp", source: "email", target: "whatsapp" });
  }
  return { nodes, edges };
}
