import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bearerToken, cleanClientId, headerSafe, mcpAuthError, mcpCorsHeaders } from "./auth";

describe("auth del conector MCP", () => {
  it("lee solo un Bearer con forma de JWT", () => {
    expect(bearerToken("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(bearerToken("bearer aaa.bbb.ccc ")).toBe("aaa.bbb.ccc");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken("Bearer nojwt")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("acepta client_id cortos y limpios", () => {
    expect(cleanClientId("5f3c8a2e-1111-2222-3333-444455556666")).toBe("5f3c8a2e-1111-2222-3333-444455556666");
    expect(cleanClientId("a b")).toBeNull();
    expect(cleanClientId(42)).toBeNull();
    expect(cleanClientId("x".repeat(201))).toBeNull();
  });

  it("un 401 dice dónde están los metadatos OAuth (así el cliente arranca el inicio de sesión)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const res = mcpAuthError({ ok: false, status: 401, error: "invalid_token", description: "Falta el token." });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"');
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "invalid_token", error_description: "Falta el token." });
  });

  it("un aviso con acentos, comillas o una flecha no rompe la cabecera (antes daba 500)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const description = "Ya no pertenecés al negocio. Cambialo desde Mi cuenta → Conexiones («MCP»).";
    const res = mcpAuthError({ ok: false, status: 403, error: "insufficient_scope", description });
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toContain('error_description="Ya no perteneces al negocio. Cambialo desde Mi cuenta -> Conexiones (\'MCP\')."');
    expect((await res.json()).error_description).toBe(description);
    expect(headerSafe('dice "hola" ñ')).toBe("dice 'hola' n");
  });

  it("CORS sin credenciales: la identidad es el token, no hay cookies que robar", () => {
    expect(mcpCorsHeaders()["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(mcpCorsHeaders()["Access-Control-Allow-Headers"]).toContain("Authorization");
  });
});
