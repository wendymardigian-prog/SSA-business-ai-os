/**
 * Equipo y roles (F24, M2): los exports a CSV piden `data.export`. Sin la clave, el endpoint o la accion
 * rechaza ANTES de leer nada del negocio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reads = vi.hoisted(() => ({ n: 0 }));
const keys = vi.hoisted(() => ({ list: [] as string[] }));
const ctxOf = () => ({
  workspace: { id: "ws-1", timezone: "UTC" },
  user: { id: "u-1" },
  supabase: new Proxy({}, { get: () => { reads.n++; throw new Error("no deberia leer"); } }),
  can: (k: string) => keys.list.includes(k),
});
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (keys.list.includes(key) ? ctxOf() : null),
  getPermissionContext: async () => ctxOf(),
}));
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => ({ workspace: { id: "ws-1", timezone: "UTC" }, supabase: ctxOf().supabase }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => { reads.n++; throw new Error("no deberia leer"); } }));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

const { GET } = await import("@/app/api/v1/agent-runs/export/route");
const { exportResponsesCsv } = await import("@/lib/actions/forms/responses");
const { exportEodReportsCsv } = await import("@/lib/actions/eod/export");

const FORM = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  reads.n = 0;
  keys.list = [];
});

describe("exportar pide data.export", () => {
  it("corridas de IA: sin la clave responde 403 y no lee nada", async () => {
    keys.list = ["ai_costs.view", "agents.view"];
    const res = await GET(new NextRequest("https://app.test/api/v1/agent-runs/export"));
    expect(res.status).toBe(403);
    expect(reads.n).toBe(0);
  });

  it("respuestas de formularios: ver las respuestas no alcanza", async () => {
    keys.list = ["forms.view"];
    const r = await exportResponsesCsv({ formId: FORM, params: {} });
    expect(r).toEqual({ ok: false, error: "No tenés permiso para exportar datos" });
    expect(reads.n).toBe(0);
  });

  it("reportes de fin de día: ver los reportes no alcanza", async () => {
    keys.list = ["forms.view", "eod.view_all"];
    const r = await exportEodReportsCsv({ formId: FORM, params: {} });
    expect(r).toEqual({ ok: false, error: "No tenés permiso para exportar datos" });
    expect(reads.n).toBe(0);
  });

  it("con data.export dejan pasar (llegan a leer)", async () => {
    keys.list = ["forms.view", "data.export", "ai_costs.view"];
    await exportResponsesCsv({ formId: FORM, params: {} }).catch(() => undefined);
    await exportEodReportsCsv({ formId: FORM, params: {} }).catch(() => undefined);
    await GET(new NextRequest("https://app.test/api/v1/agent-runs/export")).catch(() => undefined);
    expect(reads.n).toBeGreaterThan(0);
  });
});
