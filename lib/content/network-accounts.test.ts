import { describe, it, expect } from "vitest";
import {
  checkNetworkAccounts,
  cleanCollaborators,
  cleanUsername,
  collaboratorsToText,
  formatAllowsCollaborators,
  networkAccountView,
  textToCollaborators,
} from "./network-accounts";
import { parseNetworkOptions } from "./network-options";

describe("colaboradores", () => {
  it("limpia el usuario: sin arroba, en minusculas, solo caracteres validos", () => {
    expect(cleanUsername(" @Marca.Academia ")).toBe("marca.academia");
    expect(cleanUsername("con espacio")).toBeNull();
    expect(cleanUsername("")).toBeNull();
    expect(cleanUsername(5)).toBeNull();
    expect(cleanUsername("a".repeat(31))).toBeNull();
  });

  it("la lista queda sin repetidos, sin invalidos y con 3 como maximo", () => {
    expect(cleanCollaborators(["@A", "a", "b c", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(cleanCollaborators("no es lista")).toEqual([]);
    expect(cleanCollaborators(undefined)).toEqual([]);
  });

  it("las opciones de Instagram limpian los colaboradores en vez de descartar todas las opciones", () => {
    const options = parseNetworkOptions("instagram", { shareToFeed: true, collaborators: ["@Uno", "dos tres", "uno", "cuatro", "cinco", "seis"] });
    expect(options).toEqual({ shareToFeed: true, collaborators: ["uno", "cuatro", "cinco"] });
  });

  it("las historias no admiten colaboradores; sin formato se deja pasar", () => {
    expect(formatAllowsCollaborators("reel")).toBe(true);
    expect(formatAllowsCollaborators("carousel")).toBe(true);
    expect(formatAllowsCollaborators("story")).toBe(false);
    expect(formatAllowsCollaborators(null)).toBe(true);
  });
});

describe("checkNetworkAccounts", () => {
  const accounts = [
    { id: "a1", platform: "instagram", is_active: true },
    { id: "a2", platform: "tiktok", is_active: true },
    { id: "a3", platform: "instagram", is_active: false },
  ];

  it("una red sin cuenta elegida no se mira", () => {
    expect(checkNetworkAccounts([{ platform: "instagram" }, { platform: "tiktok", account_id: null }], accounts)).toBeNull();
  });

  it("una cuenta valida de la misma red pasa", () => {
    expect(checkNetworkAccounts([{ platform: "instagram", account_id: "a1" }], accounts)).toBeNull();
  });

  it("una cuenta inexistente, desconectada o de otra red se rechaza con un mensaje", () => {
    expect(checkNetworkAccounts([{ platform: "instagram", account_id: "nope" }], accounts)).toMatch(/ya no existe/);
    expect(checkNetworkAccounts([{ platform: "instagram", account_id: "a3" }], accounts)).toMatch(/desconectada/);
    expect(checkNetworkAccounts([{ platform: "instagram", account_id: "a2" }], accounts)).toMatch(/no es de instagram/);
  });
});

describe("networkAccountView (el editor)", () => {
  const accounts = [
    { id: "a1", platform: "instagram", label: "@principal", channelId: "c1", defaultPublisher: "zernio", publishers: ["zernio"] },
    { id: "a2", platform: "instagram", label: "@academia", channelId: "c2", defaultPublisher: "zernio", publishers: ["zernio"] },
    { id: "t1", platform: "tiktok", label: "@marca", channelId: null, defaultPublisher: "zernio", publishers: ["zernio"] },
  ];

  it("con varias cuentas ofrece elegir; sin eleccion es la de siempre", () => {
    const view = networkAccountView(accounts, { platform: "instagram" });
    expect(view.options.map((o) => o.id)).toEqual(["a1", "a2"]);
    expect(view.effective?.id).toBe("a1");
    expect(view.stale).toBe(false);
  });

  it("con una cuenta elegida, esa", () => {
    expect(networkAccountView(accounts, { platform: "instagram", account_id: "a2" }).effective?.channelId).toBe("c2");
  });

  it("con una sola cuenta no hay nada que elegir", () => {
    const view = networkAccountView(accounts, { platform: "tiktok" });
    expect(view.options).toEqual([]);
    expect(view.effective?.id).toBe("t1");
  });

  it("una cuenta elegida que ya no esta se avisa y usa la de siempre", () => {
    const view = networkAccountView(accounts, { platform: "instagram", account_id: "borrada" });
    expect(view.stale).toBe(true);
    expect(view.effective?.id).toBe("a1");
  });

  it("una red sin cuentas no tiene cuenta efectiva", () => {
    expect(networkAccountView(accounts, { platform: "youtube" }).effective).toBeNull();
  });
});

describe("el campo de colaboradores", () => {
  it("va y vuelve entre la lista y el texto", () => {
    expect(collaboratorsToText(["uno", "dos"])).toBe("uno, dos");
    expect(textToCollaborators("@Uno, dos  tres;cuatro")).toEqual(["uno", "dos", "tres"]);
    expect(textToCollaborators("")).toEqual([]);
  });
});
