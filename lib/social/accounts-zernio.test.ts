/**
 * F73: las cuentas sociales se arman desde la lista de Zernio.
 *
 * Lo que se prueba es lo que el sistema promete a la persona: que TikTok exista
 * (no tiene canal de bandeja, así que solo puede venir de Zernio), que correr la
 * sincronización dos veces no duplique, que una red desconocida no rompa nada,
 * y que si Zernio no responde no se borre lo que ya estaba guardado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getZernioApiKey, listAccounts } = vi.hoisted(() => ({
  getZernioApiKey: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { listAccounts } }),
}));

import { computeAccounts, syncSocialAccounts } from "./accounts";

const WS = "ws-1";

const zernioAccount = (over: Record<string, unknown>) => ({
  _id: "zr-ig",
  platform: "instagram",
  username: "wendymardigian",
  displayName: "Wendy Mardigian",
  isActive: true,
  ...over,
});

const sources = (over: Partial<Parameters<typeof computeAccounts>[0]> = {}) => ({
  zernioChannels: [],
  postproxyConnected: false,
  google: null,
  linkedin: null,
  threads: null,
  existing: [],
  ...over,
});

describe("computeAccounts con la lista de Zernio (F73)", () => {
  it("Instagram y TikTok: IG queda enlazada a su canal, TikTok sin canal", () => {
    const out = computeAccounts(
      sources({
        zernioAccounts: [
          zernioAccount({}),
          zernioAccount({ _id: "zr-tt", platform: "tiktok", username: "wendy.sistemas" }),
        ],
        zernioChannels: [{ id: "ch-ig", platform: "instagram", late_account_id: "zr-ig", username: null, display_name: null }],
      }),
    );
    const ig = out.accounts.find((a) => a.platform === "instagram");
    const tt = out.accounts.find((a) => a.platform === "tiktok");
    expect(ig?.channelId).toBe("ch-ig");
    expect(tt?.channelId).toBeNull();
    expect(tt?.externalId).toBe("zr-tt");
    expect(tt?.defaultPublisher).toBe("zernio");
  });

  it("una cuenta inactiva no se arma", () => {
    const out = computeAccounts(sources({ zernioAccounts: [zernioAccount({ isActive: false })] }));
    expect(out.accounts).toHaveLength(0);
  });

  it("una red que social_accounts no admite se saltea con aviso, sin fallar", () => {
    const out = computeAccounts(
      sources({ zernioAccounts: [zernioAccount({ _id: "zr-fb", platform: "facebook" })] }),
    );
    expect(out.accounts).toHaveLength(0);
    expect(out.warnings.join(" ")).toMatch(/facebook/);
  });

  it("sin lista (null) usa el respaldo por canales, como antes", () => {
    const out = computeAccounts(
      sources({
        zernioAccounts: null,
        zernioChannels: [{ id: "ch-ig", platform: "instagram", late_account_id: "zr-ig", username: "w", display_name: "W" }],
      }),
    );
    expect(out.accounts.map((a) => a.platform)).toEqual(["instagram"]);
    expect(out.accounts[0].channelId).toBe("ch-ig");
  });
});

describe("syncSocialAccounts contra Zernio simulado (F73)", () => {
  beforeEach(() => {
    getZernioApiKey.mockReset();
    listAccounts.mockReset();
    getZernioApiKey.mockResolvedValue("key-simulada");
  });

  const seed = () => ({
    channels: [
      {
        id: "ch-ig",
        workspace_id: WS,
        platform: "instagram",
        provider: "zernio",
        late_account_id: "zr-ig",
        is_active: true,
        username: "wendymardigian",
        display_name: "Wendy",
      },
    ],
    oauth_connections: [],
    integration_configs: [],
    social_accounts: [],
  });

  it("crea Instagram y TikTok, y dos corridas no duplican filas", async () => {
    listAccounts.mockResolvedValue({
      data: {
        accounts: [zernioAccount({}), zernioAccount({ _id: "zr-tt", platform: "tiktok", username: "wendy.sistemas" })],
        hasAnalyticsAccess: true,
      },
    });
    const db = memoryDb(seed());

    const first = await syncSocialAccounts(db.client as never, WS);
    await syncSocialAccounts(db.client as never, WS);

    const rows = db.rows("social_accounts");
    expect(rows.map((r) => r.platform).sort()).toEqual(["instagram", "tiktok"]);
    expect(rows.find((r) => r.platform === "tiktok")?.channel_id).toBeNull();
    expect(rows.find((r) => r.platform === "instagram")?.channel_id).toBe("ch-ig");
    expect(first.zernioHasAnalytics).toBe(true);
    expect(first.warnings).toEqual([]);
  });

  it("si Zernio falla: aviso, y no se borra ni desactiva lo que ya estaba", async () => {
    listAccounts.mockRejectedValue(new Error("red caída"));
    const db = memoryDb({
      ...seed(),
      social_accounts: [
        { id: "sa-1", workspace_id: WS, platform: "instagram", external_id: "zr-ig", is_active: true, default_publisher: "zernio", publishers: [] },
      ],
    });

    const out = await syncSocialAccounts(db.client as never, WS);

    expect(out.warnings.join(" ")).toMatch(/No pude leer las cuentas de Zernio/);
    const ig = db.rows("social_accounts").find((r) => r.platform === "instagram");
    expect(ig?.is_active).toBe(true);
    expect(ig?.default_publisher).toBe("zernio");
  });

  it("sin clave de Zernio no llama a la API y usa el respaldo por canales", async () => {
    getZernioApiKey.mockResolvedValue(null);
    const db = memoryDb(seed());

    const out = await syncSocialAccounts(db.client as never, WS);

    expect(listAccounts).not.toHaveBeenCalled();
    expect(out.accounts.map((a) => a.platform)).toEqual(["instagram"]);
  });
});
