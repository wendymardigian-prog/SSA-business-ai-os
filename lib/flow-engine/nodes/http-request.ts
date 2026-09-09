import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { HttpRequestNodeData } from "../types";
import { interpolateVariables } from "../interpolate";

/**
 * Llama a una API externa y guarda la respuesta en una variable.
 *
 * Si la respuesta es JSON valido se guarda parseada, asi el resto del flow
 * puede leer adentro con dot-path ({{respuesta.data.nombre}}).
 */
export const httpRequestNode: NodeDefinition<HttpRequestNodeData> = {
  type: "httpRequest",
  label: "Llamada HTTP",
  aliases: [{ nodeType: "action", actionType: "httpRequest" }],
  persistsVariables: true,
  async execute({ data, context }: NodeExecutionArgs<HttpRequestNodeData>) {
    try {
      const url = interpolateVariables(data.url, context.variables || {});
      const body = data.body
        ? interpolateVariables(data.body, context.variables || {})
        : undefined;

      const response = await fetch(url, {
        method: data.method,
        headers: { "Content-Type": "application/json", ...data.headers },
        body: data.method !== "GET" ? body : undefined,
      });

      const responseData = await response.text();

      if (data.responseVariable && context.variables) {
        try {
          context.variables[data.responseVariable] = JSON.parse(responseData);
        } catch {
          context.variables[data.responseVariable] = responseData;
        }
      }
    } catch (error) {
      console.error("HTTP request failed:", error);
    }
  },
};
