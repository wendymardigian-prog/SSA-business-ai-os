// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { validateVariantPortalSettings } from "@/lib/portal-admin/settings";
import { excludedModules, invitationHref, readNotIncluded, suggestedInvitation, toggleModule, whatsappDigits, withMode, type InvitationModule } from "./upgrade-invitation";

const mods: InvitationModule[] = [
  { id: "a", title: "Empezar", number: 1, extra: false },
  { id: "x", title: "Taller", number: null, extra: true },
  { id: "b", title: "Construir", number: 2, extra: false },
  { id: "c", title: "Vender", number: 3, extra: false },
];

describe("la invitación para pasarse (00404)", () => {
  it("sin la clave, los no incluidos no se ven", () => {
    expect(readNotIncluded(undefined)).toEqual({ mode: "hidden" });
    expect(readNotIncluded({ section: "program" })).toEqual({ mode: "hidden" });
  });

  it("pasar a «invitación» completa lo que falta con lo sugerido, sin pisar lo escrito", () => {
    const s = suggestedInvitation("Academia");
    expect(withMode({ mode: "hidden" }, "invite", "Academia")).toEqual({ mode: "invite", ...s, on_click: { notify: "owner" } });
    expect(withMode({ mode: "locked", label: "Mío" }, "invite", "Academia").label).toBe("Mío");
    expect(withMode({ mode: "invite", text: "Hola" }, "hidden", "Academia")).toEqual({ mode: "hidden", text: "Hola" });
  });

  it("lo sugerido respeta los largos que acepta la base", () => {
    const s = suggestedInvitation("Un programa con un nombre larguísimo que no entra");
    expect([...s.label].length).toBeLessThanOrEqual(40);
    expect([...s.text].length).toBeLessThanOrEqual(400);
    expect([...s.button].length).toBeLessThanOrEqual(30);
  });

  it("los no incluidos van en el orden del programa, con los extras al final", () => {
    expect(excludedModules(mods, { modules: ["a"] }).map((m) => m.id)).toEqual(["b", "c", "x"]);
    expect(excludedModules(mods, { modules: "all" })).toEqual([]);
    expect(excludedModules(mods, undefined)).toEqual([]);
  });

  it("tildar y destildar módulos: con todos o con ninguno vuelve a «todo el programa»", () => {
    expect(toggleModule({ modules: "all" }, mods, "b", false)).toEqual({ modules: ["a", "x", "c"] });
    expect(toggleModule({ modules: ["a"] }, mods, "c", true)).toEqual({ modules: ["a", "c"] });
    expect(toggleModule({ modules: ["a", "x", "c"] }, mods, "b", true)).toEqual({ modules: "all" });
    expect(toggleModule({ modules: ["a"] }, mods, "a", false)).toEqual({ modules: "all" });
  });

  it("el link del botón, igual que la base", () => {
    expect(invitationHref({ kind: "link", url: "https://pago.example.test/x" })).toBe("https://pago.example.test/x");
    expect(invitationHref({ kind: "form", id: "1", url: "https://example.test/f/a" })).toBe("https://example.test/f/a");
    expect(invitationHref({ kind: "whatsapp", value: "50688887777", prefill: "Hola, quiero pasarme" })).toBe("https://wa.me/50688887777?text=Hola%2C%20quiero%20pasarme");
    expect(invitationHref({ kind: "whatsapp", value: "50688887777" })).toBe("https://wa.me/50688887777");
    expect(invitationHref({ kind: "whatsapp", value: "123" })).toBeNull();
    expect(invitationHref(undefined)).toBeNull();
  });

  it("el WhatsApp se guarda solo con dígitos", () => {
    expect(whatsappDigits("+506 8888-7777")).toBe("50688887777");
  });

  it("una configuración armada con estas funciones pasa la validación", () => {
    const rule = { section: "program", included: true, content: { modules: ["11111111-1111-4111-8111-111111111111"] } };
    const ni = { ...withMode({ mode: "hidden" }, "invite", "Academia"), target: { kind: "whatsapp" as const, value: whatsappDigits("+506 8888 7777") } };
    expect(validateVariantPortalSettings({ v: 1, sections: [{ ...rule, not_included: ni }] })).toEqual([]);
  });
});
