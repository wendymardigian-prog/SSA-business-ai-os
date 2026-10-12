/**
 * Las automatizaciones de un clic de un reporte de fin de día (E16). Todas nacen APAGADAS.
 * Puro: arma el grafo del flujo (el mismo formato del canvas), con el disparador del EOD
 * fijo y solo pasos que sirven sin contacto.
 */
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { newStepId, treeToFlow, type ActionStep, type BranchStep, type StepTree } from "@/lib/automations/step-tree";
import { blankBranchPath } from "@/lib/automations/branch-edit";
import { newPathId } from "@/lib/flow-engine/branch-paths";
import { EOD_TRIGGER } from "./trigger-name";

export type EodTemplateKey = "eod_notify_me" | "eod_copy_email" | "eod_low_performance";

export interface EodFlowTemplate {
  key: EodTemplateKey;
  name: string;
  describe: string;
}

export const EOD_FLOW_TEMPLATES: EodFlowTemplate[] = [
  { key: "eod_notify_me", name: "Avisarme cuando alguien envía", describe: "Te llega un aviso en la campana cada vez que alguien envía su reporte." },
  { key: "eod_copy_email", name: "Copia del reporte por email", describe: "Te llega por email una copia con todas las respuestas del reporte." },
  {
    key: "eod_low_performance",
    name: "Alerta por bajo rendimiento",
    describe: "Si los links enviados en total son menos de 10, le llega un email a quien lo envió y a vos un aviso. El número y la métrica se pueden cambiar.",
  },
];

export function eodTemplateByKey(key: string): EodFlowTemplate | undefined {
  return EOD_FLOW_TEMPLATES.find((t) => t.key === key);
}

export interface EodTemplateContext {
  form: { id: string; name: string };
  /** Quien crea la plantilla: a quién le llega el aviso o la copia. */
  userId: string;
  userEmail: string;
  random?: () => number;
}

export function eodTriggerData(formId: string): Record<string, unknown> {
  return { triggerType: EOD_TRIGGER, form_ids: [formId], on: "first" };
}

/** "+ Nueva automatización": solo el disparador del EOD. */
export function blankEodFlowGraph(formId: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return { nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: eodTriggerData(formId) }], edges: [] };
}

export function eodTemplateTree(key: EodTemplateKey, ctx: EodTemplateContext): StepTree {
  const taken = new Set<string>(["trigger"]);
  const id = () => {
    const next = newStepId(taken, ctx.random);
    taken.add(next);
    return next;
  };
  const action = (data: Record<string, unknown>): ActionStep => ({ kind: "action", id: id(), nodeType: "action", data });
  const notifyMe = (title: string, body: string) => action({ actionType: "notify_team", to: "users", userIds: [ctx.userId], title, body });
  const trigger = { id: "trigger", data: eodTriggerData(ctx.form.id) };

  switch (key) {
    case "eod_notify_me":
      return { trigger, steps: [notifyMe("{{member.name}} envió su reporte del {{eod.date}}", "{{eod.channels}}")] };
    case "eod_copy_email":
      return {
        trigger,
        steps: [
          action({
            actionType: "send_email",
            to: "fixed",
            fixedEmail: ctx.userEmail,
            subject: "Reporte de {{member.name}} · {{eod.date}}",
            body: "{{member.name}} envió su reporte del {{eod.date}}.\n\n{{eod.all_answers}}\n\nVerlo en el sistema: {{report.url}}",
          }),
        ],
      };
    case "eod_low_performance": {
      const branch: BranchStep = {
        kind: "branch",
        id: id(),
        data: { label: "Rendimiento" },
        paths: [
          {
            ...blankBranchPath(newPathId([], ctx.random), "Menos de 10 links", { field: "metrics.total.links_enviados", operator: "lt", value: "10", valueType: "number" }),
            steps: [
              action({
                actionType: "send_email",
                to: "member",
                subject: "¿Qué te frenó hoy?",
                body: "Hola {{member.name}},\n\nVimos que hoy mandaste {{metrics.total.links_enviados}} links. ¿Qué te frenó? Contanos así te damos una mano.",
              }),
              notifyMe("Bajo rendimiento: {{member.name}}", "{{metrics.total.links_enviados}} links enviados el {{eod.date}}."),
            ],
          },
        ],
        otherwise: [],
      };
      return { trigger, steps: [branch] };
    }
  }
}

export function eodTemplateGraph(key: EodTemplateKey, ctx: EodTemplateContext): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return treeToFlow(eodTemplateTree(key, ctx), ctx.random);
}
