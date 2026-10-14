"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { StepTreeEditor } from "@/components/automations/step-tree-editor";
import type { StepTree } from "@/lib/automations/step-tree";
import { describeEodTrigger, parseEodTriggerConfig, type EodTriggerOn } from "@/lib/eod/automation/trigger-config";
import { saveFormFlowTree, sendFormFlowTestEmail, setEodFlowOn } from "@/lib/actions/forms/flows";
import { getEodTestValues, listEodTestReports } from "@/lib/actions/eod/test-conditions";

// Probar con un reporte enviado real: el servidor solo lee.
const TEST_REPORTS = { list: listEodTestReports, load: getEodTestValues };

/**
 * El editor de pasos de una automatización de un reporte de fin de día (E16). El mismo
 * editor de Formularios con la pantalla `eod`: solo pasos que sirven sin contacto (email,
 * esperar, avisar en la campana y Condiciones), y el disparador fijo.
 */
export function EodFlowEditor({
  formId,
  formName,
  flowId,
  flowName,
  tree,
  trigger,
  enabled,
  variableKeys,
  members,
}: {
  formId: string;
  formName: string;
  flowId: string;
  flowName: string;
  tree: StepTree | null;
  trigger: { type: string; config: Record<string, unknown> };
  enabled: boolean;
  variableKeys: string[];
  members: Array<{ userId: string; name: string }>;
}) {
  const [on, setOn] = useState<EodTriggerOn>(parseEodTriggerConfig(trigger.config).on);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function changeOn(next: EodTriggerOn) {
    const before = on;
    setOn(next);
    setError(null);
    start(async () => {
      const result = await setEodFlowOn({ flowId, on: next });
      if (!result.ok) {
        setOn(before);
        setError(result.error);
      }
    });
  }

  return (
    <StepTreeEditor
      screen="eod"
      routeForHeader={`/dashboard/formularios/${formId}/automatizaciones/${flowId}`}
      backHref={
        <Link
          href={`/dashboard/formularios/${formId}?tab=flows`}
          aria-label={`Volver a ${formName}`}
          className="-ml-1 flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Reporte</span>
        </Link>
      }
      flowId={flowId}
      flowName={flowName}
      tree={tree}
      trigger={{ type: trigger.type, config: { ...trigger.config, on } }}
      enabled={enabled}
      variableKeys={variableKeys}
      variableExample="metrics.total.links_enviados"
      describeTrigger={(_type, config) => describeEodTrigger(config, { [formId]: formName })}
      onSave={saveFormFlowTree}
      onSendTest={sendFormFlowTestEmail}
      testResponses={TEST_REPORTS}
      members={members}
      whenExtra={
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="eod-on">Arranca con</label>
          <select id="eod-on" value={on} disabled={pending} onChange={(e) => changeOn(e.target.value === "every" ? "every" : "first")} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
            <option value="first">Solo el primer envío del día</option>
            <option value="every">Cada envío y cada corrección</option>
          </select>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {error && <span className="text-destructive">{error}</span>}
        </div>
      }
    />
  );
}
