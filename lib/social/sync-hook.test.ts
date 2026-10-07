/**
 * Al sincronizar las cuentas, una red recien conectada se lee en el momento
 * (no a las 3 AM). Y nada de eso puede tumbar el guardado que lo disparo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { syncSocialAccounts, createServiceClient } = vi.hoisted(() => ({
  syncSocialAccounts: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("./accounts", () => ({ syncSocialAccounts }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { syncAccountsAfterChange } from "./sync-hook";

const WS = "ws-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncAccountsAfterChange", () => {
  it("encola la primera lectura de cada cuenta nueva", async () => {
    const mem = memoryDb({ scheduled_jobs: [] });
    createServiceClient.mockResolvedValue(mem.client);
    syncSocialAccounts.mockResolvedValue({
      accounts: [],
      warnings: [],
      zernioHasAnalytics: null,
      newAccountIds: ["sa-yt"],
    });

    const warnings = await syncAccountsAfterChange(mem.client, WS, "prueba");

    expect(warnings).toEqual([]);
    const jobs = mem.rows("scheduled_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "metrics_sync",
      payload: { workspaceId: WS, socialAccountId: "sa-yt" },
    });
  });

  it("sin cuentas nuevas no toca la cola", async () => {
    syncSocialAccounts.mockResolvedValue({
      accounts: [],
      warnings: [],
      zernioHasAnalytics: null,
      newAccountIds: [],
    });

    await syncAccountsAfterChange(memoryDb({}).client, WS, "prueba");

    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("si la cola falla, no lanza ni ensucia los avisos: la cuenta ya quedo conectada", async () => {
    createServiceClient.mockRejectedValue(new Error("sin service role"));
    syncSocialAccounts.mockResolvedValue({
      accounts: [],
      warnings: ["un aviso de la sincronizacion"],
      zernioHasAnalytics: null,
      newAccountIds: ["sa-yt"],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const warnings = await syncAccountsAfterChange(memoryDb({}).client, WS, "prueba");

    expect(warnings).toEqual(["un aviso de la sincronizacion"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
