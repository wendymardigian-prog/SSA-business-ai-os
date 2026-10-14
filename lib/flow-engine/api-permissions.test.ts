/**
 * Equipo y roles (F22): las rutas de flujos y broadcasts piden su permiso. Sin la clave, responden 403
 * y no leen ni escriben nada del negocio. (Antes cualquier miembro, incluido el Member de sistema, podia crear, editar, borrar
 * y publicar flujos, y crear y mandar broadcasts por la API.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const touched = vi.hoisted(() => ({ calls: 0 }));
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "a@b.co" } } }) },
    from: (table: string) => {
      // Averiguar el workspace de la sesion es lo unico que las rutas hacen ANTES del permiso.
      if (table === "workspace_members") {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          limit: () => q,
          single: async () => ({ data: { workspace_id: "ws-1" } }),
        };
        return q;
      }
      touched.calls++;
      throw new Error("no deberia tocar la base");
    },
  }),
  createServiceClient: async () => {
    touched.calls++;
    throw new Error("no deberia tocar la base");
  },
}));
vi.mock("@/lib/flow-engine/publish", () => ({ publishFlow: vi.fn(async () => { touched.calls++; return { ok: false, error: "x", status: 400 }; }) }));
vi.mock("@/lib/scheduler", () => ({ scheduleBroadcastDelivery: vi.fn() }));
vi.mock("@/lib/flow-engine/member-flow-db", () => ({ checkMemberFlow: vi.fn() }));

const flows = await import("@/app/api/v1/flows/route");
const flow = await import("@/app/api/v1/flows/[flowId]/route");
const publish = await import("@/app/api/v1/flows/[flowId]/publish/route");
const versions = await import("@/app/api/v1/flows/[flowId]/versions/route");
const restore = await import("@/app/api/v1/flows/[flowId]/versions/[versionId]/restore/route");
const broadcasts = await import("@/app/api/v1/broadcasts/route");
const send = await import("@/app/api/v1/broadcasts/[broadcastId]/send/route");

const req = (method = "GET") => new NextRequest("https://app.test/api/x", { method, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
const flowParams = { params: Promise.resolve({ flowId: "f1" }) };
const versionParams = { params: Promise.resolve({ flowId: "f1", versionId: "v1" }) };
const bcParams = { params: Promise.resolve({ broadcastId: "b1" }) };

const CASES: Array<[string, string, () => Promise<Response>]> = [
  ["GET /flows", "flows.view", () => flows.GET()],
  ["POST /flows", "flows.edit", () => flows.POST(req("POST"))],
  ["GET /flows/:id", "flows.view", () => flow.GET(req(), flowParams)],
  ["PUT /flows/:id", "flows.edit", () => flow.PUT(req("PUT"), flowParams)],
  ["DELETE /flows/:id", "flows.edit", () => flow.DELETE(req("DELETE"), flowParams)],
  ["POST /flows/:id/publish", "flows.publish", () => publish.POST(req("POST"), flowParams)],
  ["GET /flows/:id/versions", "flows.view", () => versions.GET(req(), flowParams)],
  ["POST /flows/:id/versions/:v/restore", "flows.publish", () => restore.POST(req("POST"), versionParams)],
  ["GET /broadcasts", "broadcasts.manage", () => broadcasts.GET()],
  ["POST /broadcasts", "broadcasts.manage", () => broadcasts.POST(req("POST"))],
  ["POST /broadcasts/:id/send", "broadcasts.manage", () => send.POST(req("POST"), bcParams)],
];

beforeEach(() => {
  touched.calls = 0;
  guards.getPermissionAction.mockReset();
});

describe("flujos y broadcasts por la API: cada metodo pide su clave", () => {
  it.each(CASES)("%s sin %s responde 403 y no toca la base", async (_name, key, run) => {
    guards.getPermissionAction.mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(403);
    expect(guards.getPermissionAction).toHaveBeenCalledWith(key);
    expect(touched.calls).toBe(0);
  });

  it.each(CASES)("%s con %s no es 403 (pasa al resto de la ruta)", async (_name, key, run) => {
    guards.getPermissionAction.mockImplementation(async (k: string) => (k === key ? { user: { id: "u-1" } } : null));
    let status = 0;
    try {
      status = (await run()).status;
    } catch {
      status = -1; // la ruta siguio y llego a la base simulada: tampoco es un 403
    }
    expect(status).not.toBe(403);
  });

  it("un Member de sistema (flows.view/edit/publish, sin broadcasts) puede flujos pero no broadcasts", async () => {
    const member = ["flows.view", "flows.edit", "flows.publish"];
    guards.getPermissionAction.mockImplementation(async (k: string) => (member.includes(k) ? { user: { id: "u-1" } } : null));
    expect((await broadcasts.GET()).status).toBe(403);
    expect((await send.POST(req("POST"), bcParams)).status).toBe(403);
    let flowStatus = 0;
    try { flowStatus = (await publish.POST(req("POST"), flowParams)).status; } catch { flowStatus = -1; }
    expect(flowStatus).not.toBe(403);
  });
});
