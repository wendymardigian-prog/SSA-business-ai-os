import { describe, it, expect } from "vitest";
import { toConnectionRef, requiredScopesFor, type OAuthConnectionRow } from "./connection-ref";
import { integrationStatus } from "./status";

const BASE: OAuthConnectionRow = {
  status: "active",
  token_expires_at: null,
  refresh_expires_at: null,
  granted_scopes: ["a", "b"],
  last_error: null,
};

describe("toConnectionRef", () => {
  it("un adaptador que renueva solo (Google) usa refresh_expires_at, no token_expires_at", () => {
    const row: OAuthConnectionRow = {
      ...BASE,
      // El access token de Google vence cada hora: ya paso.
      token_expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      refresh_expires_at: null,
    };
    const ref = toConnectionRef(row, { refresh: async () => ({ accessToken: "x" }) });
    expect(ref.token_expires_at).toBeNull();
  });

  it("CARACTERIZACION: ese caso no sale en rojo aunque el access token ya haya vencido", () => {
    const row: OAuthConnectionRow = {
      ...BASE,
      token_expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      refresh_expires_at: null,
    };
    const ref = toConnectionRef(row, { refresh: async () => ({ accessToken: "x" }) });
    const result = integrationStatus({ config: { is_active: true }, connection: ref });
    expect(result.status).toBe("connected");
  });

  it("un adaptador que NO renueva (LinkedIn) usa token_expires_at", () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const row: OAuthConnectionRow = { ...BASE, token_expires_at: soon, refresh_expires_at: null };
    const ref = toConnectionRef(row, {});
    expect(ref.token_expires_at).toBe(soon);

    const result = integrationStatus({ config: { is_active: true }, connection: ref });
    expect(result.status).toBe("attention");
    expect(result.reasons[0]).toContain("vence en");
  });

  it("conserva estado, scopes otorgados y el ultimo error tal cual", () => {
    const row: OAuthConnectionRow = {
      ...BASE,
      status: "error",
      last_error: "token invalido",
      granted_scopes: ["x"],
    };
    const ref = toConnectionRef(row, {});
    expect(ref).toMatchObject({ status: "error", last_error: "token invalido", granted_scopes: ["x"] });
  });
});

describe("requiredScopesFor", () => {
  it("un proveedor OAuth trae sus scopes imprescindibles", () => {
    expect(requiredScopesFor("linkedin")).toEqual(["w_member_social"]);
    expect(requiredScopesFor("google")).toContain("https://www.googleapis.com/auth/youtube.readonly");
  });

  it("un proveedor que no es OAuth no tiene scopes que exigir", () => {
    expect(requiredScopesFor("zernio")).toEqual([]);
    expect(requiredScopesFor("no-existe")).toEqual([]);
  });
});
