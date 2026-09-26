import { describe, expect, it } from "vitest";
import { agentUsableTagIds, describeEffect, hasEffect, sortEffectFirst } from "./effects";

const tag = (name: string, disablesAgent = false, assignsTo: string | null = null) => ({
  id: `id-${name}`,
  name,
  color: null,
  disablesAgent,
  assignsTo,
});

describe("etiquetas con efecto", () => {
  it("una etiqueta comun no tiene efecto", () => {
    expect(hasEffect(tag("quiere-aprender"))).toBe(false);
    expect(hasEffect(tag("es-conocido", true))).toBe(true);
    expect(hasEffect(tag("vip", false, "u-1"))).toBe(true);
  });

  it("describe las dos consecuencias en una frase", () => {
    expect(describeEffect(tag("es-conocido", true, "u-1"), "Wendy")).toBe(
      "Apaga el agente en sus conversaciones y lo asigna a Wendy",
    );
    expect(describeEffect(tag("no-es-lead", true), null)).toBe("Apaga el agente en sus conversaciones");
    expect(describeEffect(tag("quiere-aprender"), null)).toBeNull();
  });

  it("avisa si la persona asignada ya no esta en el equipo", () => {
    expect(describeEffect(tag("vip", false, "u-ex"), null)).toMatch(/ya no está en el equipo/);
  });

  it("ordena las de efecto primero y despues por nombre", () => {
    const sorted = sortEffectFirst([tag("tiene-negocio"), tag("no-es-lead", true), tag("alumno-actual"), tag("es-conocido", true)]);
    expect(sorted.map((t) => t.name)).toEqual(["es-conocido", "no-es-lead", "alumno-actual", "tiene-negocio"]);
  });

  it("el agente nunca puede usar una etiqueta con efecto", () => {
    const usable = agentUsableTagIds([tag("es-conocido", true), tag("vip", false, "u-1"), tag("quiere-aprender")]);
    expect([...usable]).toEqual(["id-quiere-aprender"]);
  });
});
