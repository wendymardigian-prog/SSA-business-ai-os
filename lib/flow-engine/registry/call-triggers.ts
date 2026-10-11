/**
 * Los dos triggers de Llamadas en el registro (F32): `call_analyzed` y
 * `call_linked`.
 *
 * Aca solo se declaran: que evento atiende cada uno, como se filtra y cual es su
 * clave de idempotencia. Las reglas viven en `lib/calls/automation/triggers.ts`,
 * puras y con sus tests. Sumar un tipo es declararlo con sus `eventTypes`: el
 * cron `automation-events` no se toca.
 */
import { registerTrigger } from "./registry";
import { callContextVariables } from "@/lib/calls/automation/context";
import {
  CALL_TRIGGER_LABELS,
  CALL_TRIGGER_TYPES,
  callDedupeKey,
  callEventMatches,
  type CallEventPayload,
  type CallTriggerConfig,
} from "@/lib/calls/automation/triggers";

for (const type of CALL_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: CALL_TRIGGER_LABELS[type],
    scope: "event",
    // Debajo de `crm_event` (50), igual que los de agenda: si un evento de
    // llamada tambien encajara en uno del CRM, primero corre el especifico.
    priority: 45,
    eventTypes: [type],

    eventMatches: (args) => callEventMatches(type, (args.config ?? {}) as CallTriggerConfig, args.event.payload as unknown as CallEventPayload),

    dedupeKeyFor: (args) => {
      const payload = args.event.payload as Record<string, unknown>;
      const callId = String(payload.call_id ?? args.event.id);
      // call_analyzed: una vez por analisis (uno regenerado vuelve a disparar).
      // call_linked: una vez por contacto vinculado.
      const discriminator = type === "call_analyzed" ? String(payload.analysis_run_id ?? args.event.id) : args.event.contact_id;
      return callDedupeKey(type, callId, discriminator);
    },

    variablesFor: (args) => {
      const callId = String((args.event.payload as Record<string, unknown>).call_id ?? "");
      return callId ? callContextVariables(args.supabase, callId) : {};
    },
  });
}
