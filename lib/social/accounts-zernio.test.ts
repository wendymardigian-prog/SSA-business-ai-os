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

const { getZernioKeyState, listAccounts } = vi.hoisted(() => ({
  getZernioKeyState: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioKeyState }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { listAccounts } }),
}));

import { computeAccounts, syncSocialAccounts } from "./accounts";

const WS = "ws-1";

const zernioAccount = (over: Record<string, unknown>) => ({
  _id: "zr-ig",
  platform: "instagram",
  username: "cuenta_demo",
  displayName: "Ana Pérez",
  isActive: true,
  profilePicture: null,
  profileUrl: null,
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
          zernioAccount({ _id: "zr-tt", platform: "tiktok", username: "cuenta_demo" }),
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

describe("perfil real de la cuenta (F75)", () => {
  it("foto y link vienen de la lista de Zernio; el perfil queda sellado", () => {
    const out = computeAccounts(
      sources({
        zernioAccounts: [
          zernioAccount({ profilePicture: "https://img.test/ig.jpg", profileUrl: "https://instagram.com/cuenta_demo" }),
        ],
      }),
    );
    const ig = out.accounts[0];
    expect(ig.avatarUrl).toBe("https://img.test/ig.jpg");
    expect(ig.profileUrl).toBe("https://instagram.com/cuenta_demo");
    expect(ig.profileSynced).toBe(true);
  });

  it("un campo que Zernio no trae queda null, no un valor inventado", () => {
    const out = computeAccounts(sources({ zernioAccounts: [zernioAccount({})] }));
    expect(out.accounts[0].avatarUrl).toBeNull();
    expect(out.accounts[0].profileUrl).toBeNull();
  });
});

describe("syncSocialAccounts contra Zernio simulado (F73)", () => {
  beforeEach(() => {
    getZernioKeyState.mockReset();
    listAccounts.mockReset();
    getZernioKeyState.mockResolvedValue({ state: "present", key: "key-simulada" });
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
        username: "cuenta_demo",
        display_name: "Ana",
      },
    ],
    oauth_connections: [],
    integration_configs: [],
    social_accounts: [],
  });

  it("crea Instagram y TikTok, y dos corridas no duplican filas", async () => {
    listAccounts.mockResolvedValue({
      data: {
        accounts: [zernioAccount({}), zernioAccount({ _id: "zr-tt", platform: "tiktok", username: "cuenta_demo" })],
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

  describe("desconectar Zernio (F74)", () => {
    /** Instagram ya armada por Zernio, con su canal y su usuario. */
    const instagramConectada = () => ({
      ...seed(),
      social_accounts: [
        {
          id: "sa-1", workspace_id: WS, platform: "instagram", external_id: "zr-ig", username: "cuenta_demo",
          display_name: "Ana", channel_id: "ch-ig", is_active: true, default_publisher: "zernio",
          publishers: [{ publisher: "zernio", account_ref: "zr-ig", status: "available", status_reason: null, verified_at: null, manually_enabled: false }],
        },
      ],
    });

    it("sin clave no llama a la API, y la cuenta de Instagram queda 'no disponible'", async () => {
      getZernioKeyState.mockResolvedValue({ state: "absent" });
      const db = memoryDb(instagramConectada());

      const out = await syncSocialAccounts(db.client as never, WS);

      expect(listAccounts).not.toHaveBeenCalled();
      const ig = db.rows("social_accounts").find((r) => r.platform === "instagram");
      const zernio = (ig?.publishers as Array<{ publisher: string; status: string; status_reason: string }>)[0];
      expect(zernio.status).toBe("unavailable");
      expect(zernio.status_reason).toMatch(/Zernio no esta conectado/);
      // Sin por donde publicar: programar tiene que decir "elegi por donde".
      expect(ig?.default_publisher).toBeNull();
      expect(out.warnings.join(" ")).toMatch(/instagram ya no queda por donde publicar/);
    });

    it("la cuenta no se borra ni pierde su identidad ni su canal", async () => {
      getZernioKeyState.mockResolvedValue({ state: "absent" });
      const db = memoryDb(instagramConectada());

      await syncSocialAccounts(db.client as never, WS);

      expect(db.rows("social_accounts")).toHaveLength(1);
      const ig = db.rows("social_accounts")[0];
      expect(ig).toMatchObject({ username: "cuenta_demo", display_name: "Ana", channel_id: "ch-ig", external_id: "zr-ig" });
    });

    it("sin clave NO se arma una cuenta nueva desde los canales", async () => {
      getZernioKeyState.mockResolvedValue({ state: "absent" });
      const db = memoryDb(seed()); // hay un canal de Instagram pero ninguna cuenta social

      const out = await syncSocialAccounts(db.client as never, WS);

      expect(out.accounts).toEqual([]);
      expect(db.rows("social_accounts")).toHaveLength(0);
    });

    it("al reconectar la clave, Instagram vuelve a estar disponible", async () => {
      getZernioKeyState.mockResolvedValue({ state: "absent" });
      const db = memoryDb(instagramConectada());
      await syncSocialAccounts(db.client as never, WS);

      getZernioKeyState.mockResolvedValue({ state: "present", key: "key-nueva" });
      listAccounts.mockResolvedValue({ data: { accounts: [zernioAccount({})], hasAnalyticsAccess: true } });
      await syncSocialAccounts(db.client as never, WS);

      const ig = db.rows("social_accounts").find((r) => r.platform === "instagram");
      expect((ig?.publishers as Array<{ status: string }>)[0].status).toBe("available");
      expect(ig?.default_publisher).toBe("zernio");
    });

    it("si Vault FALLA no se desconecta nada: la cuenta sigue disponible y se avisa", async () => {
      getZernioKeyState.mockResolvedValue({ state: "unknown" });
      const db = memoryDb(instagramConectada());

      const out = await syncSocialAccounts(db.client as never, WS);

      const ig = db.rows("social_accounts").find((r) => r.platform === "instagram");
      expect((ig?.publishers as Array<{ status: string }>)[0].status).toBe("available");
      expect(ig?.default_publisher).toBe("zernio");
      expect(out.warnings.join(" ")).toMatch(/No pude verificar la conexion con Zernio/);
    });

    it("una cuenta que no salia por Zernio (YouTube) no se toca", async () => {
      getZernioKeyState.mockResolvedValue({ state: "absent" });
      const db = memoryDb({
        ...seed(),
        social_accounts: [
          {
            id: "sa-yt", workspace_id: WS, platform: "youtube", external_id: "yt-1", is_active: true,
            default_publisher: "postproxy",
            publishers: [{ publisher: "postproxy", account_ref: "pp", status: "available", status_reason: null, verified_at: null, manually_enabled: false }],
          },
        ],
      });

      await syncSocialAccounts(db.client as never, WS);

      expect(db.rows("social_accounts")[0].default_publisher).toBe("postproxy");
    });
  });

});
