import { describe, it, expect } from "vitest";
import { parseEmbedParams, normalizeHexColor } from "./embed-params";

describe("parseEmbedParams (F25, F39)", () => {
  it("precarga el email desde ?email=a@b.com y el resto de los campos", () => {
    const p = parseEmbedParams({ email: "a@b.com", name: "Ana", phone: "+50688881234", presupuesto: "1000" });
    expect(p.prefill).toEqual({ name: "Ana", email: "a@b.com", phone: "+50688881234", answers: { presupuesto: "1000" } });
  });

  it("valida tema, color hex y modo embed", () => {
    expect(parseEmbedParams({ theme: "dark", color: "%23aa00ff" }).theme).toBe("dark");
    const p = parseEmbedParams(new URLSearchParams("theme=dark&color=%23aa00ff&embed=1"));
    expect(p).toMatchObject({ theme: "dark", color: "#aa00ff", embed: true });
    expect(parseEmbedParams({ theme: "neon" }).theme).toBe("auto");
    expect(parseEmbedParams({ color: "rojo" }).color).toBeNull();
    expect(parseEmbedParams({ color: "AA00FF" }).color).toBe("#aa00ff");
    expect(parseEmbedParams({}).embed).toBe(false);
  });

  it("captura UTM y click ids, y no los confunde con preguntas", () => {
    const p = parseEmbedParams({ utm_source: "instagram", utm_campaign: "oct", fbclid: "x1", otra: "y" });
    expect(p.utm).toEqual({ utm_source: "instagram", utm_campaign: "oct" });
    expect(p.clickIds).toEqual({ fbclid: "x1" });
    expect(p.prefill.answers).toEqual({ otra: "y" });
  });

  it("ignora claves que no son identificadores válidos y recorta textos largos", () => {
    const p = parseEmbedParams({ "Mal Formada": "x", "1abc": "y", ok_1: "z".repeat(600) });
    expect(Object.keys(p.prefill.answers)).toEqual(["ok_1"]);
    expect(p.prefill.answers.ok_1).toHaveLength(500);
  });

  it("zona, fecha y mes validados; parámetros repetidos toman el primero", () => {
    const p = parseEmbedParams({ tz: "America/Costa_Rica", date: "2026-10-06", month: "2026-13", name: ["Ana", "Otra"] });
    expect(p.timezone).toBe("America/Costa_Rica");
    expect(p.date).toBe("2026-10-06");
    expect(p.month).toBeNull();
    expect(p.prefill.name).toBe("Ana");
    expect(parseEmbedParams({ tz: "Marte/Olympus" }).timezone).toBeNull();
  });

  it("normalizeHexColor", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});
