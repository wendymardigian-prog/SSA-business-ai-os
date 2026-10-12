"use client";

/**
 * El editor de pasos de una automatización de formulario (F21). Envoltorio del
 * editor compartido (`components/automations/step-tree-editor.tsx`): le pasa las
 * variables de Formularios, su descripción del disparador, sus acciones y el
 * «Solo si…» del disparador.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StepTreeEditor } from "@/components/automations/step-tree-editor";
import type { StepTree } from "@/lib/automations/step-tree";
import { describeFormTrigger } from "@/lib/forms/automation/trigger-config";
import { FORM_VARIABLE_KEYS, variableKey } from "@/lib/forms/automation/variables";
import type { ConditionSource } from "@/lib/forms/visibility-builder-adapter";
import type { VisibilityConfig } from "@/lib/forms/visibility-types";
import { saveFormFlowTree, sendFormFlowTestEmail } from "@/lib/actions/forms/flows";

export function FormLinearFlowEditor({
  formId,
  formName,
  answerKeys,
  flowId,
  flowName,
  tree,
  trigger,
  enabled,
  onlyIf,
}: {
  formId: string;
  formName: string;
  /** Las claves de los campos del formulario, para `{{answer.<clave>}}`. */
  answerKeys: string[];
  flowId: string;
  flowName: string;
  /** null = el flujo no es un árbol (caminos que se juntan, un A/B...) y solo se puede abrir en el canvas. */
  tree: StepTree | null;
  trigger: { type: string; config: Record<string, unknown> };
  enabled: boolean;
  /** El «Solo si…»: las preguntas sobre las que se puede armar y lo que hay guardado. Sin esto (un contrato) no se muestra. */
  onlyIf?: { sources: ConditionSource[]; value: VisibilityConfig | undefined };
}) {
  const variableKeys = [...FORM_VARIABLE_KEYS, ...answerKeys.map((key) => `answer.${variableKey(key)}`), "contact.display_name"];
  return (
    <StepTreeEditor
      screen="forms"
      routeForHeader={`/dashboard/formularios/${formId}/automatizaciones/${flowId}`}
      backHref={
        <Link
          href={`/dashboard/formularios/${formId}`}
          aria-label={`Volver a ${formName}`}
          className="-ml-1 flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Formulario</span>
        </Link>
      }
      flowId={flowId}
      flowName={flowName}
      tree={tree}
      trigger={trigger}
      enabled={enabled}
      variableKeys={variableKeys}
      variableExample="answer.nombre"
      describeTrigger={(type, config) => describeFormTrigger(type, config, { [formId]: formName })}
      onlyIf={onlyIf}
      onSave={saveFormFlowTree}
      onSendTest={sendFormFlowTestEmail}
    />
  );
}
