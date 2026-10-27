"use client";

/**
 * El nombre de siempre del editor de una automatizacion (F57, F21). Ahora es un
 * ENVOLTORIO del editor de pasos (`step-tree-editor.tsx`), que lo reemplaza por
 * dentro: la lista Cuando / Si / Entonces es ahora un arbol de pasos con
 * Condiciones. Lo usa la Agenda
 * (`components/scheduling/event-editor/linear-flow-editor.tsx`).
 * Tambien Formularios (`components/forms/editor/form-linear-flow-editor.tsx`).  @plantilla-quitar(formularios)
 *
 * Las paginas leen el flujo con `flowToTree` (no con `flowToLinear`) y se lo
 * pasan en `tree`.
 */

import { StepTreeEditor, type EditorActionResult, type StepTreeEditorProps } from "@/components/automations/step-tree-editor";

export type { EditorActionResult };
export type LinearFlowEditorProps = StepTreeEditorProps;

export function LinearFlowEditor(props: LinearFlowEditorProps) {
  return <StepTreeEditor {...props} />;
}
