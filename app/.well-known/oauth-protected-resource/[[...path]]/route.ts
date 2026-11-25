import { authorizationServerUrl, mcpCorsHeaders, mcpResourceUrl } from "@/lib/mcp/auth";
import { brandName } from "@/lib/brand";

/**
 * Metadatos del recurso protegido (RFC 9728) del conector MCP (docs/mcp.md). El cliente (Claude) llega acá desde el
 * 401 de /api/mcp y aprende que el servidor de autorización es el Auth de Supabase. Responde igual en
 * `/.well-known/oauth-protected-resource` y en `/.well-known/oauth-protected-resource/api/mcp`.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(
    JSON.stringify({
      resource: mcpResourceUrl(),
      authorization_servers: [authorizationServerUrl()],
      bearer_methods_supported: ["header"],
      resource_name: brandName(),
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...mcpCorsHeaders() } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: mcpCorsHeaders() });
}
