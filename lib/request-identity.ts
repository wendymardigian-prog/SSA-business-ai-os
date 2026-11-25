import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Quién hace un pedido que NO viene del navegador (conector MCP). Solo servidor.
 *
 * Las pantallas y las Server Actions sacan la identidad de dos cookies: la sesión de Supabase (`createClient`) y el
 * negocio activo (`workspace_id`). Un pedido del MCP no trae cookies: trae el token de la persona (un JWT de Supabase
 * emitido por su servidor OAuth). Aquí se guarda ese token y el negocio de la conexión, solo durante ese pedido, y
 * `createClient` / `getActiveWorkspace` los usan en vez de las cookies. Así las mismas acciones de siempre corren con
 * los mismos guards y la misma RLS, sin reescribirlas.
 *
 * Un `AsyncLocalStorage` por pedido: dos pedidos a la vez nunca comparten identidad. Fuera de `runWithIdentity` no hay
 * identidad y todo sigue como siempre.
 */

export interface RequestIdentity {
  /** El access token de la persona (JWT de Supabase). Nunca se loguea. */
  jwt: string;
  /** El negocio de la conexión (ya comprobado: la persona es miembro). */
  workspaceId: string;
  via: "mcp";
  /** El nombre de la app conectada («Claude»), para el historial. */
  clientName: string | null;
}

const storage = new AsyncLocalStorage<RequestIdentity>();

export function runWithIdentity<T>(identity: RequestIdentity, fn: () => Promise<T>): Promise<T> {
  return storage.run(identity, fn);
}

export function currentIdentity(): RequestIdentity | null {
  return storage.getStore() ?? null;
}

/** La etiqueta del historial para lo que se hace por el MCP. Pura. */
export function mcpActorLabel(clientName: string | null | undefined): string {
  const name = (clientName ?? "").trim().slice(0, 60);
  return name ? `MCP · ${name}` : "MCP";
}
