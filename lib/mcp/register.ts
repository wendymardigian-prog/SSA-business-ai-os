import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * Registrar una herramienta del conector con tipos simples. `McpServer.registerTool` infiere los argumentos con una
 * capa de compatibilidad zod 3/4 muy cara para el compilador (con ~30 herramientas, tsc se quedaba sin memoria). Aquí
 * los argumentos salen de un `z.infer` directo; en ejecución es exactamente lo mismo (el SDK valida con el esquema).
 */
type Shape = Record<string, z.ZodType>;

export interface ToolConfig<S extends Shape> {
  title: string;
  description: string;
  inputSchema?: S;
  annotations?: ToolAnnotations;
}

type Args<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

export function addTool<S extends Shape = Record<string, never>>(
  server: McpServer,
  name: string,
  config: ToolConfig<S>,
  handler: (args: Args<S>) => Promise<CallToolResult>,
): void {
  const register = server.registerTool as unknown as (n: string, c: unknown, h: (a: unknown) => Promise<CallToolResult>) => unknown;
  register.call(server, name, config, handler as (a: unknown) => Promise<CallToolResult>);
}
