import { describe, it, expect } from "vitest";
import { accountsOf, activeAccountOf, parseSelection, selectionValue, tileBelongsToAccount, type SocialAccountOption } from "./account-select";

const accounts: SocialAccountOption[] = [
  { id: "a1", platform: "instagram", label: "@marca_principal" },
  { id: "a2", platform: "instagram", label: "@marca_academia" },
  { id: "t1", platform: "tiktok", label: "@marca" },
];

describe("el valor del selector", () => {
  it("una red se elige por su nombre y una cuenta por su id, y vuelven igual", () => {
    expect(selectionValue({ platform: "tiktok", accountId: null })).toBe("tiktok");
    expect(selectionValue({ platform: "instagram", accountId: "a2" })).toBe("acc:a2");
    expect(parseSelection("tiktok", accounts, "instagram")).toEqual({ platform: "tiktok", accountId: null });
    expect(parseSelection("acc:a2", accounts, "instagram")).toEqual({ platform: "instagram", accountId: "a2" });
  });

  it("una cuenta que ya no existe vuelve a la red por defecto, sin romper", () => {
    expect(parseSelection("acc:borrada", accounts, "instagram")).toEqual({ platform: "instagram", accountId: null });
  });
});

describe("la cuenta que se mira", () => {
  it("la elegida, o la primera de la red", () => {
    expect(activeAccountOf(accounts, { platform: "instagram", accountId: "a2" })?.id).toBe("a2");
    expect(activeAccountOf(accounts, { platform: "instagram", accountId: null })?.id).toBe("a1");
    expect(activeAccountOf(accounts, { platform: "instagram", accountId: "t1" })?.id).toBe("a1");
  });

  it("una red sin cuentas no tiene cuenta activa", () => {
    expect(activeAccountOf(accounts, { platform: "youtube", accountId: null })).toBeNull();
    expect(accountsOf(accounts, "instagram")).toHaveLength(2);
  });
});

describe("a que cuenta pertenece una publicacion", () => {
  const active = accounts[1];

  it("con varias cuentas, la que guardo su cuenta; las de antes (sin cuenta) son de la primera", () => {
    expect(tileBelongsToAccount({ socialAccountId: "a2" }, accounts, "instagram", active)).toBe(true);
    expect(tileBelongsToAccount({ socialAccountId: "a1" }, accounts, "instagram", active)).toBe(false);
    expect(tileBelongsToAccount({ socialAccountId: null }, accounts, "instagram", active)).toBe(false);
    expect(tileBelongsToAccount({ socialAccountId: null }, accounts, "instagram", accounts[0])).toBe(true);
  });

  it("con una sola cuenta en la red, todo es de ella", () => {
    expect(tileBelongsToAccount({ socialAccountId: null }, accounts, "tiktok", accounts[2])).toBe(true);
    expect(tileBelongsToAccount({ socialAccountId: "otra" }, accounts, "tiktok", accounts[2])).toBe(true);
  });
});
