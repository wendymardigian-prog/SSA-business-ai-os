import { describe, it, expect } from "vitest";
import { buildCardData, type WorkspaceConnectionRow } from "./load";
import { getProvider } from "./providers";

const GOOGLE = getProvider("google")!;
const LINKEDIN = getProvider("linkedin")!;
const RESEND = getProvider("resend")!;

const connectionRow = (over: Partial<WorkspaceConnectionRow> = {}): WorkspaceConnectionRow => ({
  provider: "google",
  status: "active",
  token_expires_at: null,
  refresh_expires_at: null,
  granted_scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
  last_error: null,
  last_refreshed_at: "2026-09-20T00:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("buildCardData (G3)", () => {
  it("sin conexion y sin config, no esta conectada", () => {
    const data = buildCardData({
      provider: RESEND,
      configRow: null,
      config: {},
      storedSecretKeys: [],
      isActive: false,
      usage: null,
      account: null,
      connectionRow: null,
    });
    expect(data.status).toBe("not_connected");
    expect(data.oauth).toBeNull();
    expect(data.connectedAt).toBeNull();
  });

  it("Google con el access token de 1h vencido, pero con scopes completos, sale conectado (hallazgo G3-1)", () => {
    const vencidoHaceRato = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const data = buildCardData({
      provider: GOOGLE,
      configRow: { is_active: true, connected_at: "2026-08-01T00:00:00.000Z", last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: ["client_id", "client_secret"],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({ token_expires_at: vencidoHaceRato, refresh_expires_at: null }),
      calendarPeople: 3,
    });
    expect(data.status).toBe("connected");
    expect(data.oauth).toMatchObject({ tokenExpiresAt: vencidoHaceRato });
    expect(data.calendarPeople).toBe(3);
  });

  it("LinkedIn vence en 3 dias: queda en atencion y lo dice", () => {
    const en3dias = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const data = buildCardData({
      provider: LINKEDIN,
      configRow: { is_active: true, connected_at: null, last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: ["client_id", "client_secret"],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({
        provider: "linkedin",
        token_expires_at: en3dias,
        granted_scopes: ["w_member_social"],
      }),
    });
    expect(data.status).toBe("attention");
    expect(data.reasons.some((r) => r.includes("vence en"))).toBe(true);
  });

  it("falta un scope requerido: lo nombra", () => {
    const data = buildCardData({
      provider: LINKEDIN,
      configRow: { is_active: true, connected_at: null, last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: ["client_id", "client_secret"],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({ provider: "linkedin", granted_scopes: [] }),
    });
    expect(data.status).toBe("attention");
    expect(data.reasons.some((r) => r.includes("Faltan permisos"))).toBe(true);
    expect(data.reasons.join(" ")).toContain("w_member_social");
  });

  it("status = revoked en la conexion deja la integracion en error", () => {
    const data = buildCardData({
      provider: LINKEDIN,
      configRow: { is_active: true, connected_at: null, last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: [],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({ provider: "linkedin", status: "revoked" }),
    });
    expect(data.status).toBe("error");
  });

  it("Client ID y Secret guardados pero sin autorizar la cuenta: oauth queda null", () => {
    const data = buildCardData({
      provider: GOOGLE,
      configRow: { is_active: true, connected_at: "2026-08-01T00:00:00.000Z", last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: ["client_id", "client_secret"],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: null,
    });
    // Preexistente, sin cambiar: con is_active=true queda "Conectada".
    expect(data.status).toBe("connected");
    expect(data.oauth).toBeNull();
  });

  it("connectedAt prefiere integration_configs.connected_at sobre la fecha de la conexion OAuth", () => {
    const data = buildCardData({
      provider: GOOGLE,
      configRow: { is_active: true, connected_at: "2026-01-01T00:00:00.000Z", last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: [],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({ created_at: "2026-08-01T00:00:00.000Z" }),
    });
    expect(data.connectedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sin connected_at en la config, cae al created_at de la conexion OAuth", () => {
    const data = buildCardData({
      provider: GOOGLE,
      configRow: { is_active: true, connected_at: null, last_error: null, updated_at: null },
      config: {},
      storedSecretKeys: [],
      isActive: true,
      usage: null,
      account: null,
      connectionRow: connectionRow({ created_at: "2026-08-01T00:00:00.000Z" }),
    });
    expect(data.connectedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("calendarPeople solo se agrega a la card de google", () => {
    const linkedinData = buildCardData({
      provider: LINKEDIN,
      configRow: null,
      config: {},
      storedSecretKeys: [],
      isActive: false,
      usage: null,
      account: null,
      connectionRow: null,
      calendarPeople: 5,
    });
    expect(linkedinData.calendarPeople).toBeUndefined();
  });
});
