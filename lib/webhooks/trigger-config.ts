/**
 * El disparador «Webhook recibido» (F9, F11): su configuración, las variables que deja en el flujo,
 * el «Solo si…» y la clave de idempotencia. PURO: lo usan el registro, el procesamiento y los tests.
 *
 * Config: `{ endpointId, conditions?, oncePerContact? }`. El «Solo si…» es EXACTAMENTE el de Condiciones
 * (`ConditionGroup` de `condition-eval.ts`) con campos `webhook.payload.*` / `webhook.query.*`:
 * un solo evaluador, nadie arma su propia comparación.
 */
import { evaluateGroupDetailed, type ConditionFieldSpec, type ConditionGroup, type FieldResolver, type FieldValue } from "@/lib/flow-engine/condition-eval";
import { getByPath } from "./paths";
import { flattenPaths, type LeafType } from "./payload-tree";

export const WEBHOOK_TRIGGER_TYPE = "webhook_received";
export const WEBHOOK_FIELD_PREFIX = "webhook.";

export interface WebhookTriggerConfig {
  endpointId: string | null;
  conditions: ConditionGroup | null;
  /**
   * «Correr una sola vez por contacto» (Tirón 2, C2). Apagado por defecto. Encendido, una persona que ya pasó
   * por este flujo no vuelve a entrar con un envío NUEVO (por ejemplo, llena dos veces el formulario externo):
   * el contacto se actualiza igual, pero el flujo no se ejecuta otra vez.
   */
  oncePerContact: boolean;
}

const MAX_CONDITIONS = 20;

/** Lo guardado en `triggers.config`, a algo seguro. Nunca lanza. */
export function parseWebhookTriggerConfig(raw: unknown): WebhookTriggerConfig {
  const config = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const endpointId = typeof config.endpointId === "string" && config.endpointId.trim() ? config.endpointId.trim() : null;

  let conditions: ConditionGroup | null = null;
  const group = config.conditions as { logic?: unknown; conditions?: unknown } | undefined;
  if (group && Array.isArray(group.conditions) && group.conditions.length > 0) {
    const list = group.conditions
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).field === "string" && typeof (c as Record<string, unknown>).operator === "string")
      .slice(0, MAX_CONDITIONS);
    if (list.length > 0) conditions = { logic: group.logic === "or" ? "or" : "and", conditions: list as unknown as ConditionGroup["conditions"] };
  }
  return { endpointId, conditions, oncePerContact: config.oncePerContact === true };
}

export interface WebhookVariablesInput {
  inboundId: string;
  endpointId: string;
  endpointName: string;
  receivedAt: string;
  payload: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  reprocessCount: number;
  /**
   * Con «una sola vez por contacto» encendido: el disparador al que corresponde. Viaja DENTRO de las variables
   * del envío (que la sesión guarda) para que el paso de contacto lo sepa aunque se retome después de un «Esperar».
   */
  oncePerContactTriggerId?: string | null;
}

/**
 * `{{webhook.payload.data.email}}`, `{{webhook.payload.items.0.price}}`, `{{webhook.query.utm_source}}`.
 * `interpolate.ts` ya resuelve rutas anidadas: no se toca.
 */
export function webhookVariables(input: WebhookVariablesInput): Record<string, unknown> {
  return {
    webhook: {
      id: input.inboundId,
      endpoint_id: input.endpointId,
      endpoint_name: input.endpointName,
      received_at: input.receivedAt,
      payload: input.payload ?? {},
      query: input.query ?? {},
      reprocess_count: input.reprocessCount,
      ...(input.oncePerContactTriggerId ? { once_per_contact: true, trigger_id: input.oncePerContactTriggerId } : {}),
    },
  };
}

/** Un valor del payload como lo entiende el evaluador (texto, número, booleano o lista de textos). */
export function asFieldValue(value: unknown): FieldValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) return value as string[];
  return undefined;
}

/** Resuelve `webhook.payload.x` / `webhook.query.x` / `webhook.endpoint_name` sobre las variables del flujo. */
export function webhookFieldResolver(variables: Record<string, unknown>): FieldResolver {
  return (field: string) => asFieldValue(getByPath(variables, field));
}

export interface WebhookMatch {
  passed: boolean;
}

/** ¿Se cumple el «Solo si…»? Sin condiciones, siempre. Nunca lanza (un campo ilegible no se cumple). */
export function evaluateWebhookConditions(config: WebhookTriggerConfig, variables: Record<string, unknown>): WebhookMatch {
  if (!config.conditions) return { passed: true };
  return { passed: evaluateGroupDetailed(config.conditions, webhookFieldResolver(variables)).passed };
}

/**
 * Un envío y un flujo corren UNA vez (`trigger_fires`), sin importar cuántas veces se procese o se reprocese
 * (Tirón 2, C2). Antes la clave llevaba el número de reproceso: reprocesar volvía a correr todo.
 */
export function webhookDedupeKey(inboundId: string, flowId: string): string {
  return `webhook:${inboundId}:${flowId}`;
}

/** El prefijo de TODAS las claves de un envío (la nueva y las viejas con `:<n>`): para liberarlas al «volver a correr». */
export function webhookDedupePrefix(inboundId: string): string {
  return `webhook:${inboundId}:`;
}

/**
 * «Una sola vez por contacto»: una persona y un flujo (`trigger_fires`, con el disparador del flujo).
 * Es distinta de la clave del envío: aquella frena repetir UN envío, esta frena a la MISMA persona en envíos distintos.
 */
export function webhookContactKey(flowId: string, contactId: string): string {
  return `webhook-contact:${flowId}:${contactId}`;
}

const SCHEMA_TYPE: Record<LeafType, ConditionFieldSpec["type"]> = { text: "text", number: "number", boolean: "boolean", date: "date" };
export const WEBHOOK_SCHEMA_GROUP = "Del webhook";

/** Los campos que ofrece el «Solo si…» y los pasos de Condiciones: las hojas del ejemplo, con su tipo. */
export function webhookVariableSchema(sample: { payload?: unknown; query?: unknown } | null | undefined): ConditionFieldSpec[] {
  const fields: ConditionFieldSpec[] = [{ path: "webhook.endpoint_name", label: "Nombre del endpoint", type: "text", group: WEBHOOK_SCHEMA_GROUP }];
  if (!sample) return fields;
  for (const leaf of flattenPaths(sample.payload)) {
    fields.push({ path: `webhook.payload.${leaf.path}`, label: leaf.path, type: SCHEMA_TYPE[leaf.type], group: WEBHOOK_SCHEMA_GROUP, hint: `Ejemplo: ${leaf.sample}` });
  }
  for (const leaf of flattenPaths(sample.query)) {
    fields.push({ path: `webhook.query.${leaf.path}`, label: `URL: ${leaf.path}`, type: SCHEMA_TYPE[leaf.type], group: WEBHOOK_SCHEMA_GROUP, hint: `Ejemplo: ${leaf.sample}` });
  }
  return fields;
}
