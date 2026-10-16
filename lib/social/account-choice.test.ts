import { describe, it, expect } from "vitest";
import { accountName, accountsOfPlatform, defaultAccountOf, resolveNetworkAccount, type ChoosableAccount } from "./account-choice";

const a = (id: string, over: Partial<ChoosableAccount> = {}): ChoosableAccount => ({
  id,
  platform: "instagram",
  is_active: true,
  default_publisher: "zernio",
  created_at: `2026-10-0${id.slice(-1)}T00:00:00Z`,
  ...over,
});

describe("la cuenta por defecto de una red", () => {
  it("es la mas antigua activa con publicador, aunque lleguen desordenadas", () => {
    const accounts = [a("sa-2"), a("sa-1"), a("sa-3")];
    expect(defaultAccountOf(accounts, "instagram")?.id).toBe("sa-1");
  });

  it("saltea la que no tiene por donde publicar, y la inactiva", () => {
    const accounts = [a("sa-1", { default_publisher: null }), a("sa-2", { is_active: false }), a("sa-3")];
    expect(defaultAccountOf(accounts, "instagram")?.id).toBe("sa-3");
  });

  it("si ninguna puede publicar, la mas antigua activa; sin cuentas, null", () => {
    expect(defaultAccountOf([a("sa-1", { default_publisher: null })], "instagram")?.id).toBe("sa-1");
    expect(defaultAccountOf([], "instagram")).toBeNull();
    expect(defaultAccountOf([a("sa-1")], "tiktok")).toBeNull();
  });

  it("no mezcla redes", () => {
    const accounts = [a("sa-1", { platform: "tiktok" }), a("sa-2")];
    expect(accountsOfPlatform(accounts, "instagram").map((x) => x.id)).toEqual(["sa-2"]);
  });
});

describe("resolveNetworkAccount", () => {
  const accounts = [a("sa-1"), a("sa-2")];

  it("sin cuenta pedida, la de siempre (las piezas viejas no cambian)", () => {
    expect(resolveNetworkAccount(accounts, "instagram", null)).toEqual({ ok: true, account: accounts[0] });
    expect(resolveNetworkAccount(accounts, "instagram")).toEqual({ ok: true, account: accounts[0] });
  });

  it("con cuenta pedida, esa", () => {
    expect(resolveNetworkAccount(accounts, "instagram", "sa-2")).toEqual({ ok: true, account: accounts[1] });
  });

  it("una cuenta que ya no existe, o es de otra red, o esta desconectada, NO se reemplaza en silencio", () => {
    expect(resolveNetworkAccount(accounts, "instagram", "borrada").ok).toBe(false);
    expect(resolveNetworkAccount([a("sa-1", { platform: "tiktok" })], "instagram", "sa-1").ok).toBe(false);
    expect(resolveNetworkAccount([a("sa-1", { is_active: false })], "instagram", "sa-1").ok).toBe(false);
  });

  it("una cuenta pedida sin publicador da un error que lo dice", () => {
    const result = resolveNetworkAccount([a("sa-1", { default_publisher: null })], "instagram", "sa-1");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/por donde publicar/) });
  });
});

describe("accountName", () => {
  it("usuario, o nombre, o la red", () => {
    expect(accountName({ platform: "instagram", username: "@marca", display_name: "Marca" })).toBe("@marca");
    expect(accountName({ platform: "instagram", username: null, display_name: "Marca" })).toBe("Marca");
    expect(accountName({ platform: "instagram", username: null, display_name: null })).toBe("instagram");
  });
});
