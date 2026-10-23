import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { HttpRequestNodeData } from "../types";
import { interpolateVariables } from "../interpolate";
import { httpRequestOutputs } from "../node-outputs";
import { safeFetch } from "@/lib/net/safe-fetch";

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
 */
export const httpRequestNode: NodeDefinition<HttpRequestNodeData> = {
  needsContact: false,
  type: "httpRequest",
  label: "Llamada HTTP",
  aliases: [{ nodeType: "action", actionType: "httpRequest" }],
  persistsVariables: true,
  // La respuesta queda en la variable elegida: los caminos condicionales la pueden comparar.
  outputs: httpRequestOutputs,
  async execute({ data, context, node }: NodeExecutionArgs<HttpRequestNodeData, FlowExecutionContext>) {
    const variables = context.variables ?? {};
    const responseVariable = typeof data.responseVariable === "string" ? data.responseVariable.trim() : "";
    try {
      const url = interpolateVariables(data.url ?? "", variables).trim();
      if (!url) {
        console.warn(`[flow-engine] la Llamada HTTP ${node.id} no tiene direccion: se saltea`);
        return;
      }
      const method = METHODS.has(String(data.method).toUpperCase()) ? String(data.method).toUpperCase() : "GET";
      const body = data.body ? interpolateVariables(data.body, variables) : undefined;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      for (const [key, value] of Object.entries(data.headers ?? {})) {
        if (!key.trim()) continue;
        headers[key.trim()] = interpolateVariables(String(value ?? ""), variables);
      }

      const response = await safeFetch(url, { method, headers, body: method !== "GET" ? body : undefined });

      if (responseVariable && context.variables) {
        try {
          context.variables[responseVariable] = JSON.parse(response.text);
        } catch {
          context.variables[responseVariable] = response.text;
        }
        context.variables[`${responseVariable}_status`] = String(response.status);
        context.variables[`${responseVariable}_ok`] = String(response.ok);
      }
      if (!response.ok) console.warn(`[flow-engine] la Llamada HTTP ${node.id} respondio ${response.status}`);
    } catch (error) {
      // Sin la URL ni el cuerpo en el log: pueden llevar datos del contacto o claves.
      console.error(`[flow-engine] la Llamada HTTP ${node.id} fallo:`, error instanceof Error ? error.message : "error");
      if (responseVariable && context.variables) {
        context.variables[`${responseVariable}_status`] = "0";
        context.variables[`${responseVariable}_ok`] = "false";
      }
    }
  },
};
