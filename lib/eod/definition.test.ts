import { describe, it, expect } from "vitest";
import { validateDefinition } from "@/lib/forms/definition-schema";
import { newField } from "@/lib/forms/fields";
import { eodPublishChecks } from "./definition";
import { generalTemplate, setterTemplate } from "./templates";
import { toggleChannel } from "./channels";

describe("definición de un EOD", () => {
  it("la plantilla de setters pasa la validación del EOD", () => {
    const result = validateDefinition(setterTemplate(), { formType: "eod" });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.definition.channels).toHaveLength(9);
  });

  it("los canales se conservan al validar (no se pierden por el esquema)", () => {
    const result = validateDefinition(setterTemplate(), { formType: "eod" });
    expect(result.ok && result.definition.channelSelector?.label).toBe("¿Qué canales trabajaste hoy?");
  });

  it("dos canales pueden tener la misma clave; dentro de un canal, no", () => {
    const def = setterTemplate();
    const ig = def.channels!.find((c) => c.key === "instagram")!;
    ig.fields.push({ ...ig.fields[0], id: "f_dup" });
    const result = validateDefinition(def, { formType: "eod" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('Canal "Instagram"') && e.includes("repetida"))).toBe(true);
  });

  it("un EOD solo admite cinco tipos de pregunta", () => {
    for (const type of ["email", "phone", "date", "rating", "nps", "file", "consent", "hidden", "social"] as const) {
      const result = validateDefinition({ fields: [newField(type, "campo")] }, { formType: "eod" });
      expect(result.ok, type).toBe(false);
    }
    for (const type of ["short_text", "long_text", "number", "single_select", "multi_select"] as const) {
      expect(validateDefinition({ fields: [newField(type, "campo")] }, { formType: "eod" }).ok, type).toBe(true);
    }
  });

  it("step entero desde 1 y metricKey válida", () => {
    const n = { ...newField("number", "n"), min: 0 };
    expect(validateDefinition({ fields: [{ ...n, step: 0 }] }, { formType: "eod" }).ok).toBe(false);
    expect(validateDefinition({ fields: [{ ...n, step: 2 }] }, { formType: "eod" }).ok).toBe(true);
    expect(validateDefinition({ fields: [{ ...n, metricKey: "Mala Clave" }] }, { formType: "eod" }).ok).toBe(false);
    expect(validateDefinition({ fields: [{ ...n, metricKey: "mi_metrica" }] }, { formType: "eod" }).ok).toBe(true);
    expect(validateDefinition({ fields: [{ ...newField("short_text", "t"), metricKey: "links_enviados" }] }, { formType: "eod" }).ok).toBe(false);
  });

  it("los otros tipos no aceptan canales, paso ni métrica", () => {
    expect(validateDefinition(setterTemplate()).ok).toBe(false);
    expect(validateDefinition({ fields: [{ ...newField("number", "n"), step: 2 }] }).ok).toBe(false);
  });

  it("CUANDO se publica un EOD de setters sin canales activos, se rechaza con el motivo", () => {
    let def = setterTemplate();
    for (const key of ["instagram", "whatsapp", "linkedin"]) def = { ...def, channels: toggleChannel(def.channels!, key, false) };
    expect(eodPublishChecks("setter")(def)).toEqual(["Un reporte de setters necesita al menos un canal activo (pestaña Canales)"]);
  });

  it("un canal activo sin preguntas no se publica", () => {
    const def = setterTemplate();
    const channels = toggleChannel(def.channels!, "tiktok", true);
    expect(eodPublishChecks("setter")({ ...def, channels })).toEqual(['El canal "TikTok" está activo pero no tiene preguntas']);
  });

  it("la plantilla general se publica; sin preguntas, no", () => {
    expect(eodPublishChecks("general")(generalTemplate())).toEqual([]);
    expect(eodPublishChecks("general")({ fields: [] })).toEqual(["El reporte necesita al menos una pregunta"]);
  });
});
