import { describe, it, expect } from "vitest";
import { addCustomChannel, applyToAllActive, catalogChannels, channelSlug, copyFieldsFrom, EOD_CHANNEL_CATALOG, toggleChannel } from "./channels";
import { setterTemplate } from "./templates";

const setter = () => setterTemplate().channels!;

describe("canales de un EOD", () => {
  it("el catálogo tiene los nueve canales y las etiquetas de la plataforma", () => {
    expect(EOD_CHANNEL_CATALOG.map((c) => c.key)).toEqual(["instagram", "whatsapp", "linkedin", "facebook", "tiktok", "twitter", "email", "telegram", "phone"]);
    expect(EOD_CHANNEL_CATALOG.find((c) => c.key === "linkedin")?.label).toBe("LinkedIn");
    expect(EOD_CHANNEL_CATALOG.find((c) => c.key === "tiktok")?.label).toBe("TikTok");
    expect(catalogChannels().every((c) => !c.enabled && c.fields.length === 0)).toBe(true);
  });

  it("CUANDO se usa 'en todos los activos' desde Instagram, WhatsApp y LinkedIn quedan iguales sin compartir ids", () => {
    let channels = setter().map((c) => (c.key === "instagram" ? { ...c, fields: c.fields.slice(0, 2) } : c));
    channels = applyToAllActive(channels, "instagram");
    const ig = channels.find((c) => c.key === "instagram")!;
    for (const key of ["whatsapp", "linkedin"]) {
      const other = channels.find((c) => c.key === key)!;
      expect(other.fields.map((f) => [f.key, f.metricKey, f.type, f.label])).toEqual(ig.fields.map((f) => [f.key, f.metricKey, f.type, f.label]));
      for (const field of other.fields) expect(ig.fields.some((f) => f.id === field.id)).toBe(false);
    }
    // Un canal apagado no se toca.
    expect(channels.find((c) => c.key === "tiktok")!.fields).toEqual([]);
  });

  it("copiar de un canal a otro mantiene claves y metricKey", () => {
    const channels = copyFieldsFrom(setter(), "instagram", "tiktok");
    const tiktok = channels.find((c) => c.key === "tiktok")!;
    expect(tiktok.fields.map((f) => f.metricKey)).toContain("links_enviados");
    expect(tiktok.fields).toHaveLength(6);
  });

  it("CUANDO se desactiva un canal con preguntas y se lo vuelve a activar, sus preguntas siguen", () => {
    const off = toggleChannel(setter(), "whatsapp", false);
    expect(off.find((c) => c.key === "whatsapp")!.fields).toHaveLength(6);
    const on = toggleChannel(off, "whatsapp", true);
    expect(on.find((c) => c.key === "whatsapp")).toMatchObject({ enabled: true });
    expect(on.find((c) => c.key === "whatsapp")!.fields).toHaveLength(6);
  });

  it("un canal personalizado lleva clave custom_<slug> y no se repite", () => {
    expect(channelSlug("Comunidad de Skool")).toBe("comunidad_de_skool");
    const first = addCustomChannel(catalogChannels(), "Comunidad de Skool");
    expect(first.ok && first.channels.at(-1)).toMatchObject({ key: "custom_comunidad_de_skool", custom: true, enabled: true });
    if (!first.ok) return;
    expect(addCustomChannel(first.channels, "comunidad de skool").ok).toBe(false);
    expect(addCustomChannel(first.channels, "  ").ok).toBe(false);
  });
});
