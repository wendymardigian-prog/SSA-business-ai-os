import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { HttpRequestNodeData } from "../types";
import { interpolateVariables } from "../interpolate";
import { httpRequestOutputs } from "../node-outputs";
import { assertPublicUrl, safeFetch } from "@/lib/net/safe-fetch";
import { readSecret } from "@/lib/vault";
import { SECRET_NAMES } from "@/lib/secret-names";
import { signWebhook, webhookDeliveryId } from "@/lib/automations/webhook-signature";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * Llama a una API externa y guarda la respuesta en una variable.
 *
 * Si la respuesta es JSON valido se guarda parseada, asi el resto del flow
 * puede leer adentro con dot-path ({{respuesta.data.nombre}}). Ademas quedan
 * `{{<variable>_status}}` (el codigo HTTP) y `{{<variable>_ok}}` ("true" si fue 2xx):
 * antes un 404 o un 500 se guardaba igual que una respuesta buena.
 *
 * Desde la auditoria de automatizaciones la llamada pasa por `safeFetch`: no deja pedir direcciones internas, corta a
 * los 10 s y no guarda mas de 256 KB. Los headers tambien llevan variables.
 *
 * «Firmar la llamada» (traído de RER): con `sign`, la llamada sale con los headers de `lib/automations/webhook-signature.ts`
 * (id estable por paso de la ejecución, hora y HMAC-SHA256 con la clave del negocio, que vive en la bóveda). Sin la
 * clave guardada NO se manda nada sin firmar: el paso queda fallido con su motivo y la automatización sigue.
 */

/**
 * Solo para el receptor local de los tests: con `AUTOMATION_HTTP_ALLOW_LOOPBACK=1` y fuera de producción, la llamada
 * puede ir a 127.0.0.1 / localhost. Cualquier otra dirección interna sigue bloqueada, y en producción no hay atajo.
 */
function loopbackCheckForTests(): ((raw: string) => Promise<URL>) | undefined {
  if (process.env.NODE_ENV === "production" || process.env.AUTOMATION_HTTP_ALLOW_LOOPBACK !== "1") return undefined;
  return async (raw: string) => {
    const url = new URL(raw);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return url;
    return assertPublicUrl(raw);
  };
}

function markFailed(context: FlowExecutionContext, responseVariable: string) {
  if (responseVariable && context.variables) {
    context.variables[`${responseVariable}_status`] = "0";
    context.variables[`${responseVariable}_ok`] = "false";
  }
}

export const httpRequestNode: NodeDefinition<HttpRequestNodeData> = {
  needsContact: false,
  type: "httpRequest",
  label: "Llamada HTTP",
  aliases: [{ nodeType: "action", actionType: "httpRequest" }],
  persistsVariables: true,
  // La respuesta queda en la variable elegida: los caminos condicionales la pueden comparar.
  outputs: httpRequestOutputs,
  async execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<HttpRequestNodeData, FlowExecutionContext>) {
    const variables = context.variables ?? {};
    const responseVariable = typeof data.responseVariable === "string" ? data.responseVariable.trim() : "";
    try {
      const url = interpolateVariables(data.url ?? "", variables).trim();
      if (!url) {
        console.warn(`[flow-engine] la Llamada HTTP ${node.id} no tiene direccion: se saltea`);
        context.noteStep?.({ status: "skipped", reason: "La llamada no tiene dirección." });
        return;
      }
      const method = METHODS.has(String(data.method).toUpperCase()) ? String(data.method).toUpperCase() : "GET";
      const body = data.body ? interpolateVariables(data.body, variables) : undefined;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      for (const [key, value] of Object.entries(data.headers ?? {})) {
        if (!key.trim()) continue;
        headers[key.trim()] = interpolateVariables(String(value ?? ""), variables);
      }

      const sentBody = method !== "GET" ? body : undefined;
      if (data.sign === true) {
        let secret: string | null = null;
        try {
          // El motor corre con el cliente de servicio: `read_secret` solo lo ejecuta el servidor (00143).
          secret = await readSecret(supabase as never, context.workspaceId, SECRET_NAMES.automationWebhookSecret);
        } catch (error) {
          console.error(`[flow-engine] la Llamada HTTP ${node.id} no pudo leer su clave de firma:`, error instanceof Error ? error.message : "error");
          context.noteStep?.({ status: "failed", reason: "No se pudo leer la clave para firmar la llamada. No se mandó nada." });
          markFailed(context, responseVariable);
          return;
        }
        if (!secret) {
          context.noteStep?.({ status: "failed", reason: "Falta la clave para firmar la llamada: generala o pegala en el paso «Llamada HTTP». No se mandó nada." });
          markFailed(context, responseVariable);
          return;
        }
        Object.assign(headers, signWebhook(secret, webhookDeliveryId(sessionId, node.id), sentBody ?? "", Math.floor(Date.now() / 1000)));
      }

      const response = await safeFetch(url, { method, headers, body: sentBody }, { checkUrl: loopbackCheckForTests() });

      if (responseVariable && context.variables) {
        try {
          context.variables[responseVariable] = JSON.parse(response.text);
        } catch {
          context.variables[responseVariable] = response.text;
        }
        context.variables[`${responseVariable}_status`] = String(response.status);
        context.variables[`${responseVariable}_ok`] = String(response.ok);
      }
      if (!response.ok) {
        console.warn(`[flow-engine] la Llamada HTTP ${node.id} respondio ${response.status}`);
        context.noteStep?.({ status: "failed", reason: `El servidor respondió ${response.status}.` });
      }
    } catch (error) {
      // Sin la URL ni el cuerpo en el log: pueden llevar datos del contacto o claves.
      console.error(`[flow-engine] la Llamada HTTP ${node.id} fallo:`, error instanceof Error ? error.message : "error");
      // Sin el mensaje del error: puede traer la direccion, y la direccion puede llevar datos del contacto o claves.
      context.noteStep?.({ status: "failed", reason: "No se pudo conectar con el servidor." });
      markFailed(context, responseVariable);
    }
  },
};
