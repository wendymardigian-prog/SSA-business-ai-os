import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, mcpAuthError, mcpCorsHeaders } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { getPermissionContext } from "@/lib/auth/guards";
import { getActiveWorkspace } from "@/lib/workspace";
import { runWithIdentity } from "@/lib/request-identity";

/**
 * El conector MCP del sistema (docs/mcp.md): Streamable HTTP sin estado. Cada pedido trae el token OAuth de la persona;
 * se verifica, se resuelve el negocio de su conexión y TODO corre con su identidad (`runWithIdentity`): las acciones
 * de siempre, con sus guards y la RLS. «Usar el MCP» (`mcp.usar`) se mira en cada pedido: quitarlo corta al instante.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...mcpCorsHeaders() } });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(mcpCorsHeaders())) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handle(req: Request): Promise<Response> {
  const caller = await authenticateMcpRequest(req.headers.get("authorization"));
  if (!caller.ok) return mcpAuthError(caller);

  return runWithIdentity({ jwt: caller.jwt, workspaceId: caller.workspaceId, via: "mcp", clientName: caller.clientName }, async () => {
    const active = await getActiveWorkspace();
    if (!active) {
      return mcpAuthError({ ok: false, status: 403, error: "insufficient_scope", description: "Ya no pertenecés al negocio de esta conexión. Cambialo desde el sistema (Mi cuenta → Conexiones) o volvé a conectar." });
    }
    const ctx = await getPermissionContext();
    if (!ctx.can("mcp.usar")) {
      return mcpAuthError({ ok: false, status: 403, error: "insufficient_scope", description: "Tu rol no tiene el permiso «Usar el MCP». Pedíselo a un Owner o Admin." });
    }

    const server = buildMcpServer({ ctx, actor: { userId: ctx.user.id, workspaceId: ctx.workspace.id }, connectionId: caller.connectionId, clientName: caller.clientName });
    // Sin estado y con respuesta JSON: cada herramienta termina ANTES de responder, dentro de esta identidad.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return withCors(await transport.handleRequest(req));
    } finally {
      void server.close().catch(() => undefined);
    }
  });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[mcp] el pedido falló:", err instanceof Error ? err.name : "error");
    return json(500, { jsonrpc: "2.0", error: { code: -32603, message: "Error interno del conector. Probá de nuevo." }, id: null });
  }
}

// Sin estado: no hay flujo de eventos abierto ni sesión que cerrar.
export async function GET() {
  return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Este conector no abre un flujo de eventos: usa POST." }, id: null });
}

export async function DELETE() {
  return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Este conector no tiene sesiones que cerrar." }, id: null });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: mcpCorsHeaders() });
}
