"use client";

/**
 * El editor lineal de una automatización de formulario (F21). Envoltorio del
 * editor compartido (`components/automations/linear-flow-editor.tsx`): le pasa las
 * variables de Formularios, su descripción del disparador y sus acciones.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LinearFlowEditor } from "@/components/automations/linear-flow-editor";
import type { LinearFlow } from "@/lib/scheduling/automation/linear-flow";
import { describeFormTrigger } from "@/lib/forms/automation/trigger-config";
import { FORM_VARIABLE_KEYS, variableKey } from "@/lib/forms/automation/variables";
import { saveFormLinearFlow, sendFormFlowTestEmail } from "@/lib/actions/forms/flows";

export function FormLinearFlowEditor({
  formId,
  formName,
  answerKeys,
  flowId,
  flowName,
  linear,
  enabled,
}: {
  formId: string;
  formName: string;
  /** Las claves de los campos del formulario, para `{{answer.<clave>}}`. */
  answerKeys: string[];
  flowId: string;
  flowName: string;
  /** null = el flujo tiene ramas y solo se puede abrir en el canvas. */
  linear: LinearFlow | null;
  enabled: boolean;
}) {
  const variableKeys = [...FORM_VARIABLE_KEYS, ...answerKeys.map((key) => `answer.${variableKey(key)}`), "contact.display_name"];
  return (
    <LinearFlowEditor
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
      linear={linear}
      enabled={enabled}
      variableKeys={variableKeys}
      variableExample="answer.nombre"
      describeTrigger={(type, config) => describeFormTrigger(type, config, { [formId]: formName })}
      onSave={saveFormLinearFlow}
      onSendTest={sendFormFlowTestEmail}
    />
  );
}
