/**
 * «Automatizar» desde una plantilla (Diseñador IA, F60): el borrador de automatización que se crea con un clic.
 *
 * «Formulario enviado» (el formulario se elige en el lienzo) → «Generar desde plantilla» con esta plantilla → «Enviar
 * email» al contacto con `{{design.link}}` y el PDF adjunto. Nace en BORRADOR: no corre hasta que alguien elige el
 * formulario y publica.
 *
 * Puro: lo usan la acción del servidor y sus tests.
 */

import { DESIGN_GENERATE_TYPE, isDesignGenerateNode } from "./node-config";

export interface TemplateForFlow {
  id: string;
  name: string;
  /** "constancia", "certificado"... o null si la plantilla no verifica. */
  docNoun: string | null;
}

export interface FlowGraph {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

/** El problema que deja el borrador hasta que se elige el formulario. */
export const FORM_NOT_CHOSEN_PROBLEM = "Falta elegir el formulario.";

const FORM_TRIGGERS = new Set(["form_submitted", "survey_answered", "contract_signed"]);

export function designFlowName(templateName: string): string {
  return `Generar «${templateName.trim().slice(0, 80)}»`;
}

export function designFlowTemplate(template: TemplateForFlow): FlowGraph {
  const noun = template.docNoun ?? "diseño";
  return {
    nodes: [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "form_submitted", form_ids: [] } },
      {
        id: "step-1",
        type: "action",
        position: { x: 0, y: 160 },
        data: {
          actionType: DESIGN_GENERATE_TYPE,
          templateId: template.id,
          templateName: template.name,
          mappings: {},
          missingPolicy: "fail",
          publish: true,
          waitForPdf: true,
        },
      },
      {
        id: "step-2",
        type: "action",
        position: { x: 0, y: 320 },
        data: {
          actionType: "send_email",
          to: "contact",
          category: "transactional",
          subject: `Tu ${noun}`,
          body: `Hola {{contact.first_name|}},\n\nAcá está tu ${noun}: {{design.link}}\n\nTambién te lo dejamos adjunto en PDF.\n\nUn saludo.`,
          attachments: [{ kind: "design", from: "design" }],
        },
      },
    ],
    edges: [
      { id: "e-trigger-step-1", source: "trigger", target: "step-1" },
      { id: "e-step-1-step-2", source: "step-1", target: "step-2" },
    ],
  };
}

/**
 * Un flujo que genera diseños con un disparador de formulario SIN formulario elegido correría con CUALQUIER formulario
 * del negocio (vacío = cualquiera): un certificado para quien completa una encuesta. No se publica.
 */
export function designFlowFormProblem(nodes: ReadonlyArray<{ type?: string; data?: unknown }>): string | null {
  if (!nodes.some((n) => isDesignGenerateNode(n))) return null;
  const trigger = nodes.find((n) => n?.type === "trigger");
  const data = (trigger?.data ?? {}) as { triggerType?: unknown; form_ids?: unknown; config?: { form_ids?: unknown } };
  if (typeof data.triggerType !== "string" || !FORM_TRIGGERS.has(data.triggerType)) return null;
  const ids = Array.isArray(data.form_ids) ? data.form_ids : Array.isArray(data.config?.form_ids) ? data.config.form_ids : [];
  return ids.some((id) => typeof id === "string" && id) ? null : FORM_NOT_CHOSEN_PROBLEM;
}
