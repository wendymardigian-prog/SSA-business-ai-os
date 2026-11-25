import { describe, expect, it, vi } from "vitest";

const cookiesSpy = vi.fn(async () => {
  throw new Error("cookies() no se puede llamar en un pedido del MCP");
});
vi.mock("next/headers", () => ({ cookies: cookiesSpy }));

import { currentIdentity, mcpActorLabel, runWithIdentity, type RequestIdentity } from "./request-identity";

const identity = (workspaceId: string): RequestIdentity => ({ jwt: `jwt-${workspaceId}`, workspaceId, via: "mcp", clientName: "Claude" });

describe("request identity", () => {
  it("fuera de un pedido del MCP no hay identidad", () => {
    expect(currentIdentity()).toBeNull();
  });

  it("dos pedidos a la vez nunca comparten identidad", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["a", "b", "c"].map((ws, i) =>
        runWithIdentity(identity(ws), async () => {
          await new Promise((r) => setTimeout(r, (3 - i) * 5));
          seen.push(`${ws}:${currentIdentity()?.workspaceId}`);
        }),
      ),
    );
    expect(seen.sort()).toEqual(["a:a", "b:b", "c:c"]);
    expect(currentIdentity()).toBeNull();
  });

  it("createClient con identidad no lee cookies y manda el token de la persona", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon";
    const { createClient } = await import("./supabase/server");
    let auth: string | null = null;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("Authorization");
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      const client = await runWithIdentity(identity("ws1"), () => createClient());
      expect(cookiesSpy).not.toHaveBeenCalled();
      await client.from("contacts").select("id");
      expect(auth).toBe("Bearer jwt-ws1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("la etiqueta del historial", () => {
    expect(mcpActorLabel("Claude")).toBe("MCP · Claude");
    expect(mcpActorLabel("  ")).toBe("MCP");
    expect(mcpActorLabel(null)).toBe("MCP");
  });
});
