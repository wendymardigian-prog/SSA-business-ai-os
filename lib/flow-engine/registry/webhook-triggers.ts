/**
 * «Webhook recibido» en el registro (Extra L, F9): `webhook_received`.
 *
 * Es el segundo disparador SIN contacto, pero distinto del de EOD: no es sobre una persona del
 * equipo (`subject: "webhook"`). El flujo arranca sin contacto ni persona y el contacto aparece
 * cuando el paso «Crear o actualizar contacto» lo crea o lo encuentra.
 *
 * NO pasa por la cola `automation_events` (exige contacto, y no hace falta): corre DIRECTO desde el
 * procesamiento del envío (`lib/webhooks/run-flows.ts`), con el mismo patrón de reclamo en
 * `trigger_fires` que el cron. Por eso no declara `eventTypes`: el cron nunca lo levanta.
 *
 * Las reglas viven puras en `lib/webhooks/trigger-config.ts`; acá solo se declara.
 */
import { registerTrigger, registerConditionField } from "./registry";
import { variablePathValue } from "./conditions";
import { WEBHOOK_FIELD_PREFIX, WEBHOOK_TRIGGER_TYPE, parseWebhookTriggerConfig, webhookVariableSchema } from "@/lib/webhooks/trigger-config";

registerTrigger({
  type: WEBHOOK_TRIGGER_TYPE,
  label: "Webhook recibido",
  scope: "event",
  priority: 45,
  subject: "webhook",

  // Lo que se puede comparar en «Solo si…» y en Condiciones: las hojas del ejemplo del endpoint.
  variableSchema: async (config, ctx) => {
    const { endpointId } = parseWebhookTriggerConfig(config);
    if (!endpointId) return webhookVariableSchema(null);
    const sample = await loadEndpointSample(ctx.supabase, ctx.workspaceId, endpointId);
    return webhookVariableSchema(sample);
  },
});

/**
 * El ejemplo del endpoint. Se lee con el cliente que llega y, si no devuelve nada, con el de servicio:
 * la RLS de `webhook_endpoints` usa `has_permission`, que es false para el Member de sistema aunque
 * tenga `flows.edit`. El workspace sale de la sesion (`ctx.workspaceId`), nunca del pedido.
 */
async function loadEndpointSample(
  db: Parameters<NonNullable<Parameters<typeof registerTrigger>[0]["variableSchema"]>>[1]["supabase"],
  workspaceId: string,
  endpointId: string,
): Promise<{ payload?: unknown; query?: unknown } | null> {
  const read = async (client: typeof db) => {
    const { data } = await client.from("webhook_endpoints").select("sample_payload").eq("workspace_id", workspaceId).eq("id", endpointId).is("deleted_at", null).maybeSingle();
    return (data as { sample_payload: { payload?: unknown; query?: unknown } | null } | null) ?? null;
  };
  const row = await read(db);
  if (row) return row.sample_payload;
  const { createServiceClient } = await import("@/lib/supabase/server");
  return (await read((await createServiceClient()) as typeof db))?.sample_payload ?? null;
}

// `{{webhook.*}}` también se compara en un paso de Condiciones: se lee de las variables del flujo.
registerConditionField({
  prefix: WEBHOOK_FIELD_PREFIX,
  label: "Dato del webhook",
  resolve: async ({ context, argument }) => {
    const value = variablePathValue(context.variables, `webhook.${argument}`);
    return value === undefined || value === null ? undefined : Array.isArray(value) ? value.join(", ") : String(value);
  },
  resolveTyped: ({ context, argument }) => variablePathValue(context.variables, `webhook.${argument}`),
});
