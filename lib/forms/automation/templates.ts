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
import type { FormField, FormType, PublicFormType } from "@/lib/forms/fields";
import { TRIGGER_FOR_FORM_TYPE } from "./triggers";
import { answerPath } from "./variable-schema";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { actionKind, newActionStep } from "@/lib/automations/step-catalog";
import { newStepId, treeToFlow, type BranchPathStep, type BranchStep, type StepTree } from "@/lib/automations/step-tree";
import { blankBranchPath } from "@/lib/automations/branch-edit";
import { MAX_LABEL_LENGTH, newPathId } from "@/lib/flow-engine/branch-paths";

export type FormTemplateKey = "notify_me_email" | "thank_you_message" | "add_tag" | "detractor_alert" | "email_by_answer";

export interface FormFlowTemplate {
  key: FormTemplateKey;
  name: string;
  /** En palabras simples, para la tarjeta. */
  describe: string;
  /** Para qué tipos de formulario se ofrece. */
  forTypes: FormType[];
  /** Pide elegir un tag antes de crearla. */
  needsTag?: boolean;
  /** Pide elegir una pregunta del formulario (selección única o número) antes de crearla. */
  needsQuestion?: boolean;
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

/**
 * Las plantillas con Condiciones. Van aparte de las lineales a propósito: no son
 * una lista de pasos (`flowToLinear` no las lee) y las pruebas de las lineales
 * recorren `FORM_FLOW_TEMPLATES` entera.
 */
export const FORM_BRANCH_TEMPLATES: FormFlowTemplate[] = [
  {
    key: "email_by_answer",
    name: "Email distinto según una respuesta",
    describe:
      "Elegís una pregunta y se manda un email distinto según lo que respondan, con un camino «Si no» para el resto. Nace con los emails vacíos: completalos antes de encenderla.",
    forTypes: ["custom", "survey", "contract"],
    needsQuestion: true,
  },
];

export function templatesForType(type: FormType): FormFlowTemplate[] {
  return [...FORM_FLOW_TEMPLATES, ...FORM_BRANCH_TEMPLATES].filter((t) => t.forTypes.includes(type));
}

export function formTemplateByKey(key: string): FormFlowTemplate | undefined {
  return [...FORM_FLOW_TEMPLATES, ...FORM_BRANCH_TEMPLATES].find((t) => t.key === key);
}

// ------------------------------------------------------------
// "Email distinto según una respuesta"
// ------------------------------------------------------------

/** Una pregunta que se puede usar para repartir caminos: lo que la plantilla necesita saber de ella. */
export interface TemplateQuestion {
  key: string;
  label: string;
  type: "single_select" | "number" | "rating" | "nps";
  options?: string[];
  min?: number;
  max?: number;
}

/**
 * Las preguntas que ofrece la plantilla: selección única con al menos dos
 * opciones (un camino por cada una de las dos primeras) y las numéricas (número,
 * calificación y NPS: dos umbrales).
 */
export function templateQuestions(fields: Array<Pick<FormField, "key" | "label" | "type" | "options" | "min" | "max">>): TemplateQuestion[] {
  const out: TemplateQuestion[] = [];
  for (const field of fields) {
    if (field.type === "single_select" && (field.options?.length ?? 0) >= 2) {
      out.push({ key: field.key, label: field.label || field.key, type: "single_select", options: field.options });
    } else if (field.type === "number" || field.type === "rating" || field.type === "nps") {
      out.push({ key: field.key, label: field.label || field.key, type: field.type, min: field.min, max: field.max });
    }
  }
  return out;
}

/** Cuánto vale el rango cuando una pregunta de número no declara su máximo. */
const DEFAULT_NUMBER_SPAN = 100;

/**
 * Los dos umbrales de una pregunta numérica: el camino A pide "≥ alto" y el B "≥ bajo".
 * Parten el rango en tercios y redondean a un valor cómodo (7 y 3 en un NPS de
 * 0 a 10; 4 y 2 en una calificación de 1 a 5; 70 y 30 en un número de 0 a 100).
 * Siempre `high > low`. Son un punto de partida: se editan en el flujo.
 */
export function numberThresholds(min?: number, max?: number): { high: number; low: number } {
  const lowEdge = typeof min === "number" && Number.isFinite(min) ? min : 0;
  const highEdge = typeof max === "number" && Number.isFinite(max) && max > lowEdge ? max : lowEdge + DEFAULT_NUMBER_SPAN;
  const span = highEdge - lowEdge;
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(span)) - 1));
  const round = (value: number) => Math.round(value / step) * step;
  const low = round(lowEdge + span / 3);
  let high = round(lowEdge + (span * 2) / 3);
  if (high <= low) high = low + step;
  return { high, low };
}

function clip(text: string): string {
  return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH - 1)}…` : text;
}

/**
 * El árbol de la plantilla: un paso Condiciones con dos caminos y «Si no», cada
 * uno con un paso «Enviar email» vacío. Selección única = un camino por cada una
 * de las dos primeras opciones; número = «≥ alto» y «≥ bajo» (gana el primero que
 * se cumple, así los dos arman tres rangos).
 */
export function emailByAnswerTree(
  form: { id: string; type: PublicFormType },
  question: TemplateQuestion,
  random?: () => number,
): StepTree {
  const taken = new Set<string>(["trigger"]);
  const newId = () => {
    const id = newStepId(taken, random);
    taken.add(id);
    return id;
  };
  const email = () => {
    const step = newActionStep(actionKind("email"), taken, random);
    taken.add(step.id);
    return step;
  };
  const field = answerPath(question.key);

  let paths: BranchPathStep[];
  if (question.type === "single_select") {
    const [first, second] = question.options ?? [];
    paths = [first, second].map((option) => ({
      ...blankBranchPath(newPathId([], random), clip(option), { field, operator: "is", value: option, valueType: "single_select" }),
      steps: [email()],
    }));
  } else {
    const { high, low } = numberThresholds(question.min, question.max);
    paths = [
      { ...blankBranchPath(newPathId([], random), `Alto: ${high} o más`, { field, operator: "gte", value: String(high), valueType: "number" }), steps: [email()] },
      { ...blankBranchPath(newPathId([], random), `Medio: ${low} o más`, { field, operator: "gte", value: String(low), valueType: "number" }), steps: [email()] },
    ];
  }
  // Los ids de los dos caminos no pueden chocar entre si.
  if (paths[0].id === paths[1].id) paths[1] = { ...paths[1], id: newPathId([paths[0].id], random) };

  const branch: BranchStep = { kind: "branch", id: newId(), data: { label: clip(question.label) }, paths, otherwise: [email()] };
  return {
    trigger: { id: "trigger", data: { triggerType: TRIGGER_FOR_FORM_TYPE[form.type], form_ids: [form.id] } },
    steps: [branch],
  };
}

export interface FormTemplateContext {
  form: { id: string; name: string; type: PublicFormType };
  /** El email de quien crea la plantilla (para "Avisarme"). */
  userEmail: string;
  /** El tag elegido, para `add_tag`. */
  tagName?: string;
  /** La pregunta elegida, para `email_by_answer`. */
  question?: TemplateQuestion;
  /** Solo para los tests: ids repetibles. */
  random?: () => number;
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

function triggerNode(form: { id: string; type: PublicFormType }, extra: Record<string, unknown> = {}): CanvasNode {
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
export function blankFormFlowGraph(form: { id: string; type: PublicFormType }): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
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

    case "email_by_answer":
      // Quien llama ya validó la pregunta (la acción del servidor); sin ella no hay plantilla.
      if (!ctx.question) throw new Error("La plantilla «Email distinto según una respuesta» necesita una pregunta.");
      return treeToFlow(emailByAnswerTree(form, ctx.question, ctx.random), ctx.random);
  }
}
