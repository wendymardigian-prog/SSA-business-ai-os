import { describe, it, expect } from "vitest";
import {
  accountFilterLabel,
  accountLabel,
  accountToShow,
  accountsInfo,
  buildAccounts,
  groupAccounts,
  multiAccountPlatforms,
  touchAccountOf,
} from "./accounts";

const ig1 = { id: "c1", platform: "instagram", username: "marca_principal", display_name: "Marca" };
const ig2 = { id: "c2", platform: "instagram", username: "@marca_academia", display_name: null };
const wa = { id: "c3", platform: "whatsapp", username: null, display_name: "WhatsApp" };
const mail = { id: "c4", platform: "email", username: null, display_name: "ventas@marca.com" };

describe("accountLabel", () => {
  it("una red con usuario se dice @usuario, sin duplicar la arroba", () => {
    expect(accountLabel(ig1)).toBe("@marca_principal");
    expect(accountLabel(ig2)).toBe("@marca_academia");
  });

  it("WhatsApp y email se dicen por su nombre, no por un @", () => {
    expect(accountLabel(wa)).toBe("WhatsApp");
    expect(accountLabel(mail)).toBe("ventas@marca.com");
    // Evolution manda el telefono como username: no es un @handle.
    expect(accountLabel({ platform: "whatsapp", username: "5491122334455", display_name: "WhatsApp" })).toBe("WhatsApp");
  });

  it("sin usuario usa el nombre; sin nada, el nombre de la red (nunca vacio)", () => {
    expect(accountLabel({ platform: "instagram", username: null, display_name: "Marca" })).toBe("Marca");
    expect(accountLabel({ platform: "instagram", username: " ", display_name: " " })).toBe("Instagram");
  });
});

describe("buildAccounts / groupAccounts", () => {
  it("ordena por red y despues por nombre, y agrupa por red", () => {
    const accounts = buildAccounts([mail, ig2, wa, ig1]);
    expect(accounts.map((a) => a.label)).toEqual(["ventas@marca.com", "@marca_academia", "@marca_principal", "WhatsApp"]);

    const groups = groupAccounts(accounts);
    expect(groups.map((g) => g.platformLabel)).toEqual(["Email", "Instagram", "WhatsApp"]);
    expect(groups[1].accounts.map((a) => a.id)).toEqual(["c2", "c1"]);
  });

  it("sin cuentas, sin grupos", () => {
    expect(groupAccounts([])).toEqual([]);
  });
});

describe("cuando se muestra la cuenta", () => {
  const accounts = buildAccounts([ig1, ig2, wa]);
  const info = accountsInfo(accounts);

  it("solo las redes con mas de una cuenta cuentan como 'varias'", () => {
    expect(multiAccountPlatforms(accounts)).toEqual(["instagram"]);
  });

  it("con varias cuentas de la red, la conversacion dice de cual es", () => {
    expect(accountToShow(info, { channel_id: "c1", platform: "instagram" })).toBe("@marca_principal");
    expect(accountToShow(info, { channel_id: "c2", platform: "instagram" })).toBe("@marca_academia");
  });

  it("con una sola cuenta de la red no dice nada: no hay que diferenciar", () => {
    expect(accountToShow(info, { channel_id: "c3", platform: "whatsapp" })).toBeNull();
  });

  it("sin informacion, sin canal o con un canal desconocido, no inventa nada", () => {
    expect(accountToShow(undefined, { channel_id: "c1", platform: "instagram" })).toBeNull();
    expect(accountToShow(info, { channel_id: null, platform: "instagram" })).toBeNull();
    expect(accountToShow(info, { channel_id: "otro", platform: "instagram" })).toBeNull();
  });

  it("en el filtro, con varias cuentas se nombra la cuenta junto a la red", () => {
    const [academia] = accounts;
    expect(accountFilterLabel(academia, ["instagram"])).toBe("Instagram @marca_academia");
    expect(accountFilterLabel(accounts[2], ["instagram"])).toBe("WhatsApp");
  });
});

describe("touchAccountOf", () => {
  it("la clave es la de la cuenta en el proveedor, no el uuid del canal", () => {
    expect(touchAccountOf({ late_account_id: "zernio_abc", platform: "instagram", username: "marca_principal" })).toEqual({
      id: "zernio_abc",
      label: "@marca_principal",
    });
    expect(touchAccountOf({ late_account_id: "evolution:ws1", platform: "whatsapp", display_name: "WhatsApp" }).id).toBe("evolution:ws1");
  });
});
