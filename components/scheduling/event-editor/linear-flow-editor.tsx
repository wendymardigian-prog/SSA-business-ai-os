"use client";

/**
 * El editor de pasos de un flujo del evento (F57). Envoltorio del editor
 * compartido (`components/automations/step-tree-editor.tsx`): le pasa las
 * variables de la Agenda, su descripción del disparador y sus acciones (suma el
 * estado de la reunión y cancelarla).
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StepTreeEditor } from "@/components/automations/step-tree-editor";
import type { StepTree } from "@/lib/automations/step-tree";
import { describeTrigger, type BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";
import { BOOKING_VARIABLE_KEYS } from "@/lib/scheduling/automation/variables";
import { saveEventFlowTree, sendFlowTestEmail } from "@/lib/actions/scheduling/event-flows";

const VARIABLE_KEYS = [...BOOKING_VARIABLE_KEYS.map((key) => `booking.${key}`), "contact.first_name"];

export function LinearFlowEditor({
  eventId,
  flowId,
  flowName,
  tree,
  trigger,
  enabled,
  reach,
}: {
  eventId: string;
  flowId: string;
  flowName: string;
  /** null = el flujo no es un árbol (caminos que se juntan, un A/B...) y solo se puede abrir en el canvas. */
  tree: StepTree | null;
  trigger: { type: string; config: Record<string, unknown> };
  enabled: boolean;
  /** A cuántas reuniones alcanzaría hoy, con el mismo filtro que los avisos. */
  reach: number | null;
}) {
  return (
    <StepTreeEditor
      screen="agenda"
      routeForHeader={`/dashboard/agenda/configuracion/eventos/${eventId}/flujos/${flowId}`}
      backHref={
        <Link
          href={`/dashboard/agenda/configuracion/eventos/${eventId}?seccion=flows`}
          aria-label="Volver a los flujos del evento"
          className="-ml-1 flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Flujos</span>
        </Link>
      }
      flowId={flowId}
      flowName={flowName}
      tree={tree}
      trigger={trigger}
      enabled={enabled}
      reach={reach}
      describeReach={(n) => `Hoy alcanzaría a ${n} ${n === 1 ? "reunión" : "reuniones"} de las que ya están agendadas.`}
      variableKeys={VARIABLE_KEYS}
      variableExample="booking.start_invitee"
      describeTrigger={(type, config) => describeTrigger(type, config as BookingTriggerConfig)}
      onSave={saveEventFlowTree}
      onSendTest={sendFlowTestEmail}
    />
  );
}
