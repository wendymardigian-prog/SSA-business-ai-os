import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { appUrl } from "@/lib/app-url";
import { createServiceClient } from "@/lib/supabase/server";
import { oldestWorkspaceIdFor } from "@/lib/workspace";

/**
 * Quién llama al conector MCP (docs/mcp.md). Solo servidor.
 *
 * El cliente (Claude u otra app) manda `Authorization: Bearer <token>`. El token es un JWT de Supabase emitido por su
 * servidor OAuth 2.1 a ESTA persona: se verifica la firma con la clave pública del proyecto (`getClaims`), igual que la
 * sesión de la app. De ahí salen la persona (`sub`) y la app conectada (`client_id`); el negocio sale de su conexión
 * (`mcp_connections`), que se elige en el consentimiento. El token nunca se loguea.
 */

export const MCP_PATH = "/api/mcp";
/** Para un token de sesión sin cliente OAuth (las pruebas locales con usuario y contraseña). */
export const SESSION_CLIENT_ID = "session";

export function mcpResourceUrl(): string {
  return `${appUrl()}${MCP_PATH}`;
}

export function resourceMetadataUrl(): string {
  return `${appUrl()}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** El servidor de autorización: el Auth del proyecto de Supabase. */
export function authorizationServerUrl(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1`;
}

export type McpCaller =
  | { ok: true; jwt: string; userId: string; clientId: string; connectionId: string; workspaceId: string; clientName: string | null }
  | { ok: false; status: 401 | 403; error: string; description: string };

/** El token del encabezado, o null. Pura. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** Un `client_id` aceptable (uuid u otro identificador corto), o null. Pura. */
export function cleanClientId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 && v.length <= 200 && /^[A-Za-z0-9._:\-]+$/.test(v) ? v : null;
}

function anonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const UNAUTHORIZED = (description: string): McpCaller => ({ ok: false, status: 401, error: "invalid_token", description });

/**
 * Verifica el token y resuelve la conexión (y su negocio). Si la persona nunca pasó por el consentimiento con esta
 * app (por ejemplo, Supabase la aprobó sola porque ya había dado su consentimiento), la conexión se crea con su
 * negocio más antiguo; `cambiar_negocio` lo cambia.
 */
export async function authenticateMcpRequest(authorization: string | null): Promise<McpCaller> {
  const jwt = bearerToken(authorization);
  if (!jwt) return UNAUTHORIZED("Falta el token de acceso.");

  let claims: Record<string, unknown> | undefined;
  let error: unknown = null;
  try {
    const r = await anonClient().auth.getClaims(jwt);
    claims = r.data?.claims as Record<string, unknown> | undefined;
    error = r.error;
  } catch (err) {
    // Un token mal formado hace lanzar a getClaims: es un 401, no un error del servidor.
    error = err;
  }
  if (error || !claims || typeof claims.sub !== "string" || claims.role !== "authenticated") {
    return UNAUTHORIZED("El token no es válido o venció.");
  }
  const userId = claims.sub;
  const clientId = cleanClientId(claims.client_id) ?? SESSION_CLIENT_ID;

  const service = await createServiceClient();
  const { data: existing, error: readError } = await service
    .from("mcp_connections" as never)
    .select("id, workspace_id, client_name, revoked_at, last_used_at")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError) {
    console.error("[mcp] no pude leer la conexión:", readError.code ?? "?");
    return { ok: false, status: 403, error: "temporarily_unavailable", description: "No pude comprobar tu conexión. Probá de nuevo en un momento." };
  }
  let row = existing as { id: string; workspace_id: string; client_name: string | null; revoked_at: string | null; last_used_at: string | null } | null;
  if (row?.revoked_at) return UNAUTHORIZED("Esta conexión se desconectó desde el sistema. Volvé a conectarla.");

  if (!row) {
    const firstWorkspaceId = await oldestWorkspaceIdFor(service, userId);
    if (!firstWorkspaceId) return { ok: false, status: 403, error: "insufficient_scope", description: "Tu cuenta no pertenece a ningún negocio." };
    const { data: created, error: insertError } = await service
      .from("mcp_connections" as never)
      .upsert({ user_id: userId, client_id: clientId, workspace_id: firstWorkspaceId } as never, { onConflict: "user_id,client_id", ignoreDuplicates: false })
      .select("id, workspace_id, client_name, revoked_at, last_used_at")
      .single();
    if (insertError || !created) {
      console.error("[mcp] no pude crear la conexión:", insertError?.code ?? "?");
      return { ok: false, status: 403, error: "temporarily_unavailable", description: "No pude preparar tu conexión. Probá de nuevo." };
    }
    row = created as unknown as NonNullable<typeof row>;
  }

  // Última vez usada, como mucho una vez cada 5 minutos. Nunca frena el pedido.
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (Date.now() - last > 5 * 60_000) {
    void service
      .from("mcp_connections" as never)
      .update({ last_used_at: new Date().toISOString() } as never)
      .eq("id", row.id)
      .then(({ error: e }) => {
        if (e) console.error("[mcp] no pude anotar el último uso:", e.code ?? "?");
      });
  }

  return { ok: true, jwt, userId, clientId, connectionId: row.id, workspaceId: row.workspace_id, clientName: row.client_name };
}

/**
 * Un texto apto para una cabecera HTTP: solo ASCII imprimible. Una cabecera no admite caracteres fuera de Latin-1
 * (una flecha «→» hacía que `new Response` lanzara y el 403 terminaba en 500). El cuerpo JSON conserva el texto
 * completo. Pura.
 */
export function headerSafe(text: string): string {
  return text
    .replace(/→/g, "->")
    .replace(/[«»“”]/g, "'")
    .replace(/"/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "");
}

/** El 401/403 que entiende un cliente MCP: con el lugar de los metadatos para que arranque el OAuth. */
export function mcpAuthError(caller: Extract<McpCaller, { ok: false }>): Response {
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl()}", error="${caller.error}", error_description="${headerSafe(caller.description)}"`;
  return new Response(JSON.stringify({ error: caller.error, error_description: caller.description }), {
    status: caller.status,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": challenge, ...mcpCorsHeaders() },
  });
}

/**
 * CORS del conector: los clientes MCP del navegador (por ejemplo, un inspector) mandan `Authorization` y
 * `Mcp-Session-Id`. Sin cookies (la identidad es el token), así que cualquier origen puede pedir: no hay credenciales
 * ambientales que robar.
 */
export function mcpCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    "Access-Control-Max-Age": "600",
  };
}
