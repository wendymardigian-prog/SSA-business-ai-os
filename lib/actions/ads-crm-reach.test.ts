/**
 * El alcance unico que pide la tabla «Meta vs CRM»: permiso, cuenta del workspace y que un fallo de Meta vuelva como resultado.
 * Meta y Vault simulados: ninguna llamada real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveCache } from "@/lib/meta/live";

const getPermissionAction = vi.fn();
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: (...args: unknown[]) => getPermissionAction(...args) }));

const getMetaToken = vi.fn();
vi.mock("@/lib/meta/token", () => ({ getMetaToken: (...args: unknown[]) => getMetaToken(...args) }));

const workspaceFilter = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, workspaceId: string) => {
          workspaceFilter(workspaceId);
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { config: { ad_accounts: [{ ad_account_id: "act_1", name: "Cuenta", currency: "USD", sync_enabled: true }] } },
                }),
              }),
            }),
          };
        },
      }),
    }),
  }),
}));

import { loadCrmObjectReach } from "./ads-crm";

const input = { level: "campaign" as const, since: "2026-10-08", until: "2026-11-06", adAccountId: "act_1", objectIds: null };

const metaAnswers = (byLevel: unknown, byAccount: unknown) => {
  const fetchMock = vi.fn(async (url: string) => {
    const body = new URL(url).searchParams.has("level") ? byLevel : byAccount;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  clearLiveCache();
  vi.clearAllMocks();
  getPermissionAction.mockResolvedValue({ workspace: { id: "ws-1" } });
  getMetaToken.mockResolvedValue("token");
});

afterEach(() => vi.unstubAllGlobals());

describe("loadCrmObjectReach", () => {
  it("devuelve cada fila y la cuenta, con el workspace de la sesion", async () => {
    metaAnswers(
      { data: [{ campaign_id: "lp1", reach: "18919", frequency: "3.28" }] },
      { data: [{ reach: "150000", frequency: "1.8", impressions: "270000" }] },
    );

    expect(await loadCrmObjectReach(input)).toEqual({
      ok: true,
      byObject: { lp1: { reach: 18919, frequency: 3.28 } },
      account: { reach: 150000, frequency: 1.8 },
    });
    expect(getPermissionAction).toHaveBeenCalledWith("dashboards.ads.view");
    expect(workspaceFilter).toHaveBeenCalledWith("ws-1");
  });

  it("una cuenta que este workspace no sincroniza se rechaza sin llamar a Meta", async () => {
    const fetchMock = metaAnswers({ data: [] }, { data: [] });

    const result = await loadCrmObjectReach({ ...input, adAccountId: "act_de_otro" });

    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getMetaToken).not.toHaveBeenCalled();
  });

  it("sin permiso no lee nada", async () => {
    getPermissionAction.mockResolvedValue(null);
    const fetchMock = metaAnswers({ data: [] }, { data: [] });

    expect(await loadCrmObjectReach(input)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workspaceFilter).not.toHaveBeenCalled();
  });

  it("todo el historial no se le pregunta a Meta", async () => {
    const fetchMock = metaAnswers({ data: [] }, { data: [] });

    expect(await loadCrmObjectReach({ ...input, since: "2000-01-01" })).toMatchObject({ ok: false, reason: "period_too_long" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un error de Meta vuelve como resultado y no lanza", async () => {
    metaAnswers({ error: { message: "Limite de uso", code: 17 } }, { data: [{ reach: "1" }] });

    expect(await loadCrmObjectReach(input)).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("si solo falla la de la cuenta, las filas se muestran y el total queda sin dato en vivo", async () => {
    metaAnswers({ data: [{ campaign_id: "lp1", reach: "18919", frequency: "3.28" }] }, { error: { message: "Limite de uso", code: 17 } });

    expect(await loadCrmObjectReach(input)).toMatchObject({ ok: true, byObject: { lp1: { reach: 18919 } }, account: null });
  });

  it("sin token lo dice", async () => {
    getMetaToken.mockResolvedValue(null);
    expect(await loadCrmObjectReach(input)).toEqual({ ok: false, reason: "unavailable", error: "Falta el token de Meta." });
  });

  it("repetir el pedido no vuelve a gastar cupo", async () => {
    const fetchMock = metaAnswers({ data: [{ campaign_id: "lp1", reach: "18919", frequency: "3.28" }] }, { data: [{ reach: "150000", frequency: "1.8" }] });

    await loadCrmObjectReach(input);
    await loadCrmObjectReach(input);

    expect(fetchMock).toHaveBeenCalledTimes(2); // una por el nivel y una por la cuenta, las dos del primer pedido
  });
});
