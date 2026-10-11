"use client";

/**
 * El editor lineal de un flujo del evento (F57). Envoltorio del editor
 * compartido (`components/automations/linear-flow-editor.tsx`): le pasa las
 * variables de la Agenda, su descripción del disparador y sus acciones.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LinearFlowEditor as SharedLinearFlowEditor } from "@/components/automations/linear-flow-editor";
import type { LinearFlow } from "@/lib/scheduling/automation/linear-flow";
import { describeTrigger, type BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";
import { BOOKING_VARIABLE_KEYS } from "@/lib/scheduling/automation/variables";
import { saveLinearFlow, sendFlowTestEmail } from "@/lib/actions/scheduling/event-flows";

const VARIABLE_KEYS = [...BOOKING_VARIABLE_KEYS.map((key) => `booking.${key}`), "contact.first_name"];

export function LinearFlowEditor({
  eventId,
  flowId,
  flowName,
  linear,
  enabled,
  reach,
}: {
  eventId: string;
  flowId: string;
  flowName: string;
  /** null = el flujo tiene ramas y solo se puede abrir en el canvas. */
  linear: LinearFlow | null;
  enabled: boolean;
  /** A cuántas reuniones alcanzaría hoy, con el mismo filtro que los avisos. */
  reach: number | null;
}) {
  return (
    <SharedLinearFlowEditor
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
      linear={linear}
      enabled={enabled}
      reach={reach}
      describeReach={(n) => `Hoy alcanzaría a ${n} ${n === 1 ? "reunión" : "reuniones"} de las que ya están agendadas.`}
      variableKeys={VARIABLE_KEYS}
      variableExample="booking.start_invitee"
      describeTrigger={(type, config) => describeTrigger(type, config as BookingTriggerConfig)}
      onSave={saveLinearFlow}
      onSendTest={sendFlowTestEmail}
    />
  );
}
