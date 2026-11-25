import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La puerta del conector MCP (docs/mcp.md): quién entra y quién no. Sin base ni red: la autenticación, el negocio y
 * los permisos se simulan; lo que se prueba es el orden de las comprobaciones y que TODO corra con la identidad de la
 * conexión.
 */

vi.mock("server-only", () => ({}));

const authenticate = vi.fn();
const activeWorkspace = vi.fn();
const permissionContext = vi.fn();
const buildServer = vi.fn();
const seenIdentity: unknown[] = [];

vi.mock("@/lib/mcp/auth", async () => {
  const real = await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  return { ...real, authenticateMcpRequest: (...a: unknown[]) => authenticate(...a) };
});
vi.mock("@/lib/workspace", () => ({ getActiveWorkspace: () => activeWorkspace() }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionContext: () => permissionContext() }));
vi.mock("@/lib/mcp/server", () => ({ buildMcpServer: (...a: unknown[]) => buildServer(...a) }));

import { currentIdentity } from "@/lib/request-identity";
import { POST, GET, OPTIONS } from "./route";

const caller = { ok: true, jwt: "a.b.c", userId: "u1", clientId: "session", connectionId: "c1", workspaceId: "w1", clientName: "Claude" };

function req(): Request {
  return new Request("https://app.example.com/api/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto.supabase.co";
  authenticate.mockReset();
  activeWorkspace.mockReset().mockImplementation(async () => {
    seenIdentity.push(currentIdentity());
    return { workspace: { id: "w1" } };
  });
  permissionContext.mockReset();
  buildServer.mockReset();
  seenIdentity.length = 0;
});

describe("la puerta de /api/mcp", () => {
  it("sin token válido: 401 con los metadatos OAuth y sin mirar el negocio", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401, error: "invalid_token", description: "Falta el token de acceso." });
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp");
    expect(activeWorkspace).not.toHaveBeenCalled();
    expect(buildServer).not.toHaveBeenCalled();
  });

  it("si ya no es miembro del negocio de la conexión: 403 (no cae a otro negocio)", async () => {
    authenticate.mockResolvedValue(caller);
    activeWorkspace.mockImplementation(async () => {
      seenIdentity.push(currentIdentity());
      return null;
    });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(buildServer).not.toHaveBeenCalled();
  });

  it("sin «Usar el MCP»: 403 y no se arma el servidor", async () => {
    authenticate.mockResolvedValue(caller);
    permissionContext.mockResolvedValue({ can: (k: string) => k !== "mcp.usar", user: { id: "u1" }, workspace: { id: "w1" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error_description).toContain("Usar el MCP");
    expect(buildServer).not.toHaveBeenCalled();
  });

  it("todo corre con la identidad de la conexión, y fuera del pedido no queda ninguna", async () => {
    authenticate.mockResolvedValue(caller);
    permissionContext.mockResolvedValue({ can: () => false, user: { id: "u1" }, workspace: { id: "w1" } });
    await POST(req());
    expect(seenIdentity[0]).toEqual({ jwt: "a.b.c", workspaceId: "w1", via: "mcp", clientName: "Claude" });
    expect(currentIdentity()).toBeNull();
  });

  it("un error inesperado es un 500 genérico (sin detalles en la respuesta)", async () => {
    authenticate.mockRejectedValue(new Error("datos de alguien"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("datos de alguien");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("datos de alguien");
    spy.mockRestore();
  });

  it("sin estado: GET da 405 y OPTIONS responde CORS sin credenciales", async () => {
    expect((await GET()).status).toBe(405);
    const pre = await OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(pre.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
