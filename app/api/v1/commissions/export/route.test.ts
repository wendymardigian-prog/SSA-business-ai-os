import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommissionExportRow } from "@/lib/commissions/export-csv";

const state: { can: (key: string) => boolean; result: { rows: CommissionExportRow[]; truncated: boolean } | null; calls: Array<{ filters: unknown }> } = {
  can: () => true,
  result: { rows: [], truncated: false },
  calls: [],
};

vi.mock("@/lib/auth/guards", () => ({
  getPermissionContext: async () => ({ can: (key: string) => state.can(key), workspace: { id: "w", timezone: "UTC" }, user: { id: "u" }, scope: () => "own" }),
}));
vi.mock("@/lib/commissions/screen-load", () => ({
  loadCommissionExport: async (_ctx: unknown, filters: unknown) => {
    state.calls.push({ filters });
    return state.result;
  },
}));

const { GET } = await import("./route");

const request = (qs = "") => ({ nextUrl: new URL(`http://localhost/api/v1/commissions/export${qs}`) }) as unknown as Parameters<typeof GET>[0];

const row = (patch: Partial<CommissionExportRow> = {}): CommissionExportRow => ({
  id: "c1", paidOn: "2026-10-10", personName: "Ana", roleName: "Vendedor", contactName: "Lucía", productName: "Mentoría", financing: "Cuotas", paymentNumber: 1, method: "Whop",
  collectedCents: null, feeCents: null, baseCents: 4852, calc: "8 % del neto", amountCents: 388, ruleName: "R", statusLabel: "Pendiente", expenseStatusLabel: null, expenseDate: null,
  channel: null, pieceOrAd: null, notes: null, ...patch,
});

beforeEach(() => {
  state.can = () => true;
  state.result = { rows: [row()], truncated: false };
  state.calls = [];
});

describe("GET /api/v1/commissions/export", () => {
  it("sin commissions.view responde 403 y no lee nada", async () => {
    state.can = (key) => key !== "commissions.view";
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });

  it("un Member (solo commissions.view, ni exportar ni gastos) puede bajar las suyas: la RLS recorta lo que ve", async () => {
    state.can = (key) => key === "commissions.view";
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel lee bien las tildes
    const text = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    expect(text).toContain("id,fecha_cobro");
    expect(text).toContain("c1,2026-10-10,Ana,Vendedor");
  });

  it("usa el mismo filtro que la lista (la URL)", async () => {
    await GET(request("?estado=pendiente&persona=33333333-3333-4333-8333-333333333333&agrupar=rol"));
    expect(state.calls[0].filters).toMatchObject({ statuses: ["pendiente"], users: ["33333333-3333-4333-8333-333333333333"] });
  });

  it("baja como archivo, sin cache, y avisa si se cortó en el tope", async () => {
    state.result = { rows: [row()], truncated: true };
    const res = await GET(request());
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="comisiones-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Export-Truncated")).toBe("true");
  });

  it("si no se pudo leer, un error claro y no un archivo vacío", async () => {
    state.result = null;
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "No pudimos armar el CSV. Probá de nuevo." });
  });
});
