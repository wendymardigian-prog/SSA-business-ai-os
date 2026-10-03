/**
 * F74: sincronizar las cuentas sociales al cambiar una integración.
 *
 * Lo que se prueba: que guardar Postproxy o desconectar una red disparan la
 * sincronización, y que si la sincronización falla el guardado igual queda
 * hecho y el aviso viaja en la respuesta. Nunca al revés.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getAdminContext, storeSecret, deleteSecret, listSecretNames, logAudit, fetchMock, syncSocialAccounts } =
  vi.hoisted(() => ({
    getAdminContext: vi.fn(),
    storeSecret: vi.fn(),
    deleteSecret: vi.fn(),
    listSecretNames: vi.fn(),
    logAudit: vi.fn(),
    fetchMock: vi.fn(),
    syncSocialAccounts: vi.fn(),
  }));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, storeSecret, deleteSecret, listSecretNames };
});
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/social/accounts", () => ({ syncSocialAccounts }));

import { saveIntegration, disconnectIntegration } from "./integrations";

const WS = "ws-1";
const USER = "user-1";

function admin(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({ integration_configs: [], ...seed });
  getAdminContext.mockResolvedValue({ workspace: { id: WS }, supabase: db.client, user: { id: USER } });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ profiles: [{ id: "p1", platform: "youtube" }] }),
  });
  storeSecret.mockResolvedValue({ ok: true });
  deleteSecret.mockResolvedValue({ ok: true });
  listSecretNames.mockResolvedValue([]);
  logAudit.mockResolvedValue("audit-1");
  syncSocialAccounts.mockResolvedValue({ accounts: [], warnings: [], zernioHasAnalytics: null });
});

describe("guardar una integracion de red dispara la sincronizacion (F74)", () => {
  it("guardar Postproxy sincroniza las cuentas una vez", async () => {
    admin();
    const result = await saveIntegration({ providerId: "postproxy", secrets: { api_key: "clave-que-si-sirve-1234" } });

    expect(result).toEqual({ ok: true });
    expect(syncSocialAccounts).toHaveBeenCalledTimes(1);
    expect(syncSocialAccounts).toHaveBeenCalledWith(expect.anything(), WS);
  });

  it("si la sincronizacion falla, el guardado queda hecho y el aviso viaja", async () => {
    admin();
    syncSocialAccounts.mockRejectedValue(new Error("base caída"));

    const result = await saveIntegration({ providerId: "postproxy", secrets: { api_key: "clave-que-si-sirve-1234" } });

    expect(storeSecret).toHaveBeenCalledWith(expect.anything(), WS, "postproxy_api_key", "clave-que-si-sirve-1234");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings?.join(" ")).toMatch(/cuentas sociales/);
  });

  it("una integracion que no es de red no sincroniza nada", async () => {
    admin();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await saveIntegration({ providerId: "anthropic", secrets: { api_key: "sk-ant-clave-larga-de-prueba-1234567890" }, config: { default_model: "claude-sonnet-5" } });

    expect(syncSocialAccounts).not.toHaveBeenCalled();
  });
});

describe("desconectar una red dispara la sincronizacion (F74)", () => {
  it("desconectar Postproxy sincroniza las cuentas", async () => {
    admin({
      integration_configs: [
        { id: "cfg-1", workspace_id: WS, type: "publishing_service", provider: "postproxy", is_active: true, vault_secret_name: "postproxy_api_key" },
      ],
    });

    const result = await disconnectIntegration("postproxy");

    expect(result).toEqual({ ok: true });
    expect(syncSocialAccounts).toHaveBeenCalledTimes(1);
  });

  it("si la sincronizacion falla al desconectar, la desconexion queda hecha", async () => {
    admin({
      integration_configs: [
        { id: "cfg-1", workspace_id: WS, type: "publishing_service", provider: "postproxy", is_active: true, vault_secret_name: "postproxy_api_key" },
      ],
    });
    syncSocialAccounts.mockRejectedValue(new Error("base caída"));

    const result = await disconnectIntegration("postproxy");

    expect(deleteSecret).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings?.length).toBe(1);
  });
});
