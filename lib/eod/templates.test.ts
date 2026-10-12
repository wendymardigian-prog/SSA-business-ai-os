import { describe, it, expect } from "vitest";
import { validateDefinition } from "@/lib/forms/definition-schema";
import { validateSuccess } from "@/lib/forms/success";
import { eodPublishChecks } from "./definition";
import { EOD_SUCCESS, eodTemplate, generalTemplate, setterTemplate } from "./templates";

describe("plantillas de EOD", () => {
  it("la de setters pasa la validación y las reglas de publicar", () => {
    const def = setterTemplate();
    expect(validateDefinition(def, { formType: "eod" }).ok).toBe(true);
    expect(eodPublishChecks("setter")(def)).toEqual([]);
  });

  it("generales: horas 0–24 y rendimiento 1–10, obligatorias, con su metricKey", () => {
    const def = setterTemplate();
    expect(def.fields.map((f) => [f.key, f.type, f.required, f.metricKey ?? null])).toEqual([
      ["horas_trabajadas", "number", true, "horas_trabajadas"],
      ["rendimiento", "number", true, "rendimiento"],
      ["mejor_conversacion", "long_text", false, null],
      ["mejorar_rendimiento", "long_text", false, null],
    ]);
    expect(def.fields[0]).toMatchObject({ min: 0, max: 24 });
    expect(def.fields[1]).toMatchObject({ min: 1, max: 10 });
    expect(def.channelSelector).toEqual({ label: "¿Qué canales trabajaste hoy?", required: true });
  });

  it("Instagram, WhatsApp y LinkedIn activos, con las seis preguntas ≥ 0 obligatorias", () => {
    const active = setterTemplate().channels!.filter((c) => c.enabled);
    expect(active.map((c) => c.key)).toEqual(["instagram", "whatsapp", "linkedin"]);
    for (const channel of active) {
      expect(channel.fields.map((f) => f.metricKey)).toEqual(["conv_inbound", "conv_outbound", "seguimientos", "respuestas", "links_enviados", "llamadas_agendadas"]);
      expect(channel.fields.every((f) => f.type === "number" && f.required && f.min === 0)).toBe(true);
    }
  });

  it("la general nace con dos preguntas de texto largo opcionales y sin canales", () => {
    const def = generalTemplate();
    expect(def.fields.map((f) => [f.label, f.type, f.required])).toEqual([
      ["¿Qué lograste hoy?", "long_text", false],
      ["¿Qué te frenó?", "long_text", false],
    ]);
    expect(def.channels).toBeUndefined();
    expect(eodTemplate("general").fields).toHaveLength(2);
  });

  it("la pantalla final es válida", () => {
    expect(validateSuccess(EOD_SUCCESS)).toMatchObject({ ok: true });
  });
});
