/**
 * Las plantillas de un clic de la pestaña Automatizaciones de un formulario (F21),
 * como funciones puras que arman el grafo del flujo. Todas nacen APAGADAS
 * (`status = 'draft'`): el interruptor publica el flow y escribe su trigger.
 *
 * El grafo es el mismo formato que guarda el canvas, así que el flujo se abre y
 * se edita igual en el editor lineal y en el flow builder. Los nombres de las
 * acciones son los alias exactos del registro (`send_email`, `addTag`, ...): con
 * otro nombre el motor no resuelve el nodo y el paso no corre, sin avisar.
 */
import type { FormType } from "@/lib/forms/fields";
import { TRIGGER_FOR_FORM_TYPE } from "./triggers";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";

export type FormTemplateKey = "notify_me_email" | "thank_you_message" | "add_tag" | "detractor_alert";

export interface FormFlowTemplate {
  key: FormTemplateKey;
  name: string;
  /** En palabras simples, para la tarjeta. */
  describe: string;
  /** Para qué tipos de formulario se ofrece. */
  forTypes: FormType[];
  /** Pide elegir un tag antes de crearla. */
  needsTag?: boolean;
}

export const FORM_FLOW_TEMPLATES: FormFlowTemplate[] = [
  {
    key: "notify_me_email",
    name: "Avisarme por email",
    describe: "Te llega un email con el link a la respuesta cada vez que alguien responde.",
    forTypes: ["custom", "survey", "contract"],
  },
  {
    key: "thank_you_message",
    name: "Mandarle un mensaje de gracias",
    describe: "Le mandás un mensaje y un email de agradecimiento a quien respondió.",
    forTypes: ["custom", "survey", "contract"],
  },
  {
    key: "add_tag",
    name: "Ponerle un tag",
    describe: "Le pone un tag al contacto cuando responde.",
    forTypes: ["custom", "survey", "contract"],
    needsTag: true,
  },
  {
    key: "detractor_alert",
    name: "Alerta por detractor",
    describe: "Te avisa por email cuando alguien pone una nota baja (0 a 6) en la encuesta.",
    forTypes: ["survey"],
  },
];

export function templatesForType(type: FormType): FormFlowTemplate[] {
  return FORM_FLOW_TEMPLATES.filter((t) => t.forTypes.includes(type));
}

export function formTemplateByKey(key: string): FormFlowTemplate | undefined {
  return FORM_FLOW_TEMPLATES.find((t) => t.key === key);
}

export interface FormTemplateContext {
  form: { id: string; name: string; type: FormType };
  /** El email de quien crea la plantilla (para "Avisarme"). */
  userEmail: string;
  /** El tag elegido, para `add_tag`. */
  tagName?: string;
}

/** El nombre del flujo: "<formulario> · <algo>". */
export function formFlowName(formName: string, suffix: string): string {
  return `${formName} · ${suffix}`;
}

/** Un nombre "<formulario> · Automatización N" que no choca con los que ya hay. */
export function nextAutomationName(formName: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  for (let n = existingNames.length + 1; n < existingNames.length + 1000; n++) {
    const name = formFlowName(formName, `Automatización ${n}`);
    if (!taken.has(name)) return name;
  }
  return formFlowName(formName, "Automatización");
}

function triggerNode(form: { id: string; type: FormType }, extra: Record<string, unknown> = {}): CanvasNode {
  return {
    id: "trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { triggerType: TRIGGER_FOR_FORM_TYPE[form.type], form_ids: [form.id], ...extra },
  };
}

function chain(trigger: CanvasNode, steps: Array<{ type: string; data: Record<string, unknown> }>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [trigger];
  const edges: CanvasEdge[] = [];
  let previous = trigger.id;
  let y = 160;
  steps.forEach((step, i) => {
    const id = `step-${i + 1}`;
    nodes.push({ id, type: step.type, position: { x: 0, y }, data: step.data });
    edges.push({ id: `${previous}-${id}`, source: previous, target: id });
    previous = id;
    y += 160;
  });
  return { nodes, edges };
}

/** El flujo vacío de "+ Nueva automatización": solo el trigger del tipo del formulario. */
export function blankFormFlowGraph(form: { id: string; type: FormType }): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return chain(triggerNode(form), []);
}

const notifyEmailStep = (userEmail: string, subject: string, body: string) => ({
  type: "action",
  data: { actionType: "send_email", to: "fixed", fixedEmail: userEmail, subject, body },
});

export function formTemplateGraph(key: FormTemplateKey, ctx: FormTemplateContext): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { form } = ctx;
  switch (key) {
    case "notify_me_email":
      return chain(triggerNode(form), [
        notifyEmailStep(ctx.userEmail, "Nueva respuesta: {{form.name}}", "Alguien respondió «{{form.name}}».\n\nMirala acá: {{submission.url}}"),
      ]);

    case "thank_you_message":
      return chain(triggerNode(form), [
        { type: "sendMessage", data: { messages: [{ text: "¡Hola {{contact.display_name}}! Gracias por responder. Ya recibimos tu respuesta." }], onlyIfPhone: true } },
        { type: "action", data: { actionType: "send_email", to: "contact", subject: "Gracias por responder", body: "Hola {{contact.display_name}},\n\nGracias por responder «{{form.name}}». Ya recibimos tu respuesta.\n\nUn abrazo." } },
      ]);

    case "add_tag":
      return chain(triggerNode(form), [{ type: "action", data: { actionType: "addTag", tagName: ctx.tagName ?? "" } }]);

    case "detractor_alert":
      return chain(triggerNode(form, { nps_categories: ["detractor"] }), [
        notifyEmailStep(ctx.userEmail, "Alerta: nota baja en {{form.name}}", "Alguien puso {{submission.score}} en «{{form.name}}».\n\nMirala acá: {{submission.url}}"),
      ]);
  }
}
