import { describe, it, expect } from "vitest";
import {
  instanceNameForNumber,
  isAutoWhatsappName,
  nextWhatsappName,
  pendingWhatsappName,
  phoneFromJid,
  randomInstanceSuffix,
} from "./whatsapp-numbers";

const WS = "12345678-aaaa-bbbb-cccc-ddddeeeeffff";

describe("instanceNameForNumber", () => {
  it("el primer numero conserva el nombre de siempre", () => {
    expect(instanceNameForNumber({ prefix: "ssa", workspaceId: WS, existingCount: 0, suffix: "abc123" })).toBe("ssa-12345678");
  });

  it("los siguientes llevan un sufijo propio, con el prefijo del proyecto", () => {
    const name = instanceNameForNumber({ prefix: "ssa", workspaceId: WS, existingCount: 1, suffix: "AbC-123xyz" });
    expect(name).toBe("ssa-12345678-abc123");
    expect(name.startsWith("ssa-")).toBe(true);
  });

  it("el sufijo al azar es corto y solo letras y numeros", () => {
    expect(randomInstanceSuffix()).toMatch(/^[a-z0-9]{6}$/);
    expect(randomInstanceSuffix(() => 0)).toBe("000000");
  });
});

describe("phoneFromJid", () => {
  it("saca el telefono del JID, con o sin dispositivo", () => {
    expect(phoneFromJid("5491122334455@s.whatsapp.net")).toBe("5491122334455");
    expect(phoneFromJid("5491122334455:12@s.whatsapp.net")).toBe("5491122334455");
  });
  it("lo que no es un telefono es null", () => {
    expect(phoneFromJid(undefined)).toBeNull();
    expect(phoneFromJid("")).toBeNull();
    expect(phoneFromJid("abc@s.whatsapp.net")).toBeNull();
  });
});

describe("el nombre del canal", () => {
  it("mientras no hay numero: WhatsApp, WhatsApp 2, WhatsApp 3", () => {
    expect(pendingWhatsappName(0)).toBe("WhatsApp");
    expect(pendingWhatsappName(1)).toBe("WhatsApp 2");
    expect(pendingWhatsappName(2)).toBe("WhatsApp 3");
  });

  it("un nombre del sistema se reemplaza por el numero; uno escrito por una persona, no", () => {
    expect(isAutoWhatsappName("WhatsApp")).toBe(true);
    expect(isAutoWhatsappName("WhatsApp 2")).toBe(true);
    expect(isAutoWhatsappName("WhatsApp +5491122334455")).toBe(true);
    expect(isAutoWhatsappName("WhatsApp Ventas")).toBe(false);
    expect(nextWhatsappName("WhatsApp 2", "5491122334455")).toBe("WhatsApp +5491122334455");
    expect(nextWhatsappName("WhatsApp Ventas", "5491122334455")).toBeNull();
  });

  it("sin numero o con el mismo nombre no hay nada que cambiar", () => {
    expect(nextWhatsappName("WhatsApp", null)).toBeNull();
    expect(nextWhatsappName("WhatsApp +5491122334455", "5491122334455")).toBeNull();
  });
});
