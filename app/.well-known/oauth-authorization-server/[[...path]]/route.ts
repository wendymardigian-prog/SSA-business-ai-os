import { authorizationServerUrl, mcpCorsHeaders } from "@/lib/mcp/auth";

/**
 * Compatibilidad del conector MCP (docs/mcp.md): algunos clientes buscan los metadatos del servidor de autorización
 * en el dominio del conector. Se devuelven los del Auth de Supabase tal cual (el emisor sigue siendo Supabase).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${authorizationServerUrl()}/.well-known/oauth-authorization-server`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    return new Response(await res.text(), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...mcpCorsHeaders() } });
  } catch {
    return new Response(JSON.stringify({ error: "authorization_server_unavailable" }), { status: 502, headers: { "Content-Type": "application/json", ...mcpCorsHeaders() } });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: mcpCorsHeaders() });
}
