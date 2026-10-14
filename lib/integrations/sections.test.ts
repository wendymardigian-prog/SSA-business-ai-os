import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { CHANNEL_PROVIDER_IDS, hasSharedSections, integrationSections, providerAccess, sectionOfProvider } from "./sections";
import { PROVIDERS } from "./providers";

const canOf = (keys: string[]) => (key: string) => keys.includes(key);

describe("integrationSections (F18)", () => {
  it("un Member de sistema ve solo «Mis conexiones»", () => {
    const can = canOf(SYSTEM_ROLE_PERMISSIONS.member.keys);
    expect(integrationSections(can)).toEqual({ mine: true, channels: null, business: null });
    expect(hasSharedSections(can)).toBe(false);
  });

  it("Owner y Admin tocan canales y negocio", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(integrationSections(canOf(SYSTEM_ROLE_PERMISSIONS[role].keys))).toEqual({ mine: true, channels: "edit", business: "edit" });
    }
  });

  it("integrations.view ve las dos secciones en solo lectura", () => {
    expect(integrationSections(canOf(["integrations.view"]))).toEqual({ mine: true, channels: "view", business: "view" });
  });

  it("channels.manage toca los canales y no ve el negocio", () => {
    expect(integrationSections(canOf(["channels.manage"]))).toEqual({ mine: true, channels: "edit", business: null });
  });

  it("integrations.manage toca el negocio y ve los canales sin tocarlos", () => {
    expect(integrationSections(canOf(["integrations.manage"]))).toEqual({ mine: true, channels: "view", business: "edit" });
  });
});

describe("a qué sección pertenece cada proveedor", () => {
  it("los canales son Zernio, Evolution y el email entrante; el resto es del negocio", () => {
    expect([...CHANNEL_PROVIDER_IDS].sort()).toEqual(["evolution", "resend_inbound", "zernio"]);
    expect(sectionOfProvider("zernio")).toBe("channels");
    expect(sectionOfProvider("openai")).toBe("business");
    expect(sectionOfProvider("meta")).toBe("business");
  });

  it("todo proveedor del catálogo cae en una de las dos", () => {
    for (const p of PROVIDERS) expect(["channels", "business"]).toContain(sectionOfProvider(p.id));
    for (const id of CHANNEL_PROVIDER_IDS) expect(PROVIDERS.map((p) => p.id)).toContain(id);
  });

  it("el detalle de un proveedor: solo con acceso a su sección, y en solo lectura si no puede tocar", () => {
    expect(providerAccess(canOf(["channels.manage"]), "zernio")).toBe("edit");
    expect(providerAccess(canOf(["channels.manage"]), "openai")).toBeNull();
    expect(providerAccess(canOf(["integrations.view"]), "openai")).toBe("view");
    expect(providerAccess(canOf([]), "zernio")).toBeNull();
  });
});
