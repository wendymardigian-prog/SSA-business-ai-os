import { describe, it, expect } from "vitest";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { evaluateCondition } from "@/lib/flow-engine/condition-eval";
import { variablePathValue } from "@/lib/flow-engine/registry/conditions";
import { validateEodReport } from "../submit";
import { setterTemplate } from "../templates";
import { allAnswersText, eodVariables, eodVariableSchema } from "./variables";
import { eodDedupeKey, eodEventMatches, parseEodTriggerConfig } from "./trigger-config";

const def = setterTemplate();
const version = { id: "v1", number: 1, fields: def.fields, channelSelector: def.channelSelector!, channels: def.channels! };
const zeros = { conv_inbound: 0, conv_outbound: 0, seguimientos: 0, respuestas: 0, llamadas_agendadas: 0 };
const validated = validateEodReport(version, {
  answers: { horas_trabajadas: 8, rendimiento: 7, mejor_conversacion: "Una muy buena" },
  channels: { instagram: { selected: true, answers: { ...zeros, links_enviados: 1 } }, whatsapp: { selected: true, answers: { ...zeros, links_enviados: 3 } } },
});
if (!validated.ok) throw new Error("fixture");
const vars = eodVariables({
  form: { id: "f-1", name: "EOD", roleLabel: "Setter" },
  report: { id: "r-1", reportDate: "2026-10-12", editCount: 0, ...validated.report },
  member: { name: "Ana", email: "ana@x.com" },
  baseUrl: "https://app.x/",
});

describe("variables del EOD", () => {
  it("se interpolan en un email", () => {
    expect(interpolateVariables("{{member.name}} ({{eod.role}}) el {{eod.date}}: {{metrics.total.links_enviados}} links, {{metrics.whatsapp.links_enviados}} por WhatsApp", vars)).toBe(
      "Ana (Setter) el 2026-10-12: 4 links, 3 por WhatsApp",
    );
    expect(interpolateVariables("{{channel.instagram.links_enviados}} · {{answer.mejor_conversacion}} · {{eod.channels}}", vars)).toBe("1 · Una muy buena · Instagram, WhatsApp");
    expect(interpolateVariables("{{report.url}}", vars)).toBe("https://app.x/dashboard/formularios/f-1/reportes/r-1");
  });

  it("todas las respuestas, una por línea, con cada canal", () => {
    const text = allAnswersText({ id: "r-1", reportDate: "", editCount: 0, ...validated.report });
    expect(text.split("\n")[0]).toBe("Horas trabajadas hoy: 8");
    expect(text).toContain("\nWhatsApp\n");
    expect(text).toContain("Links enviados: 3");
  });

  it("una condición 'links en total menor que 10' se cumple con 4", () => {
    const actual = variablePathValue(vars, "metrics.total.links_enviados");
    expect(evaluateCondition({ field: "metrics.total.links_enviados", operator: "lt", value: "10", valueType: "number" }, actual)).toBe(true);
    expect(evaluateCondition({ field: "eod.channels", operator: "includes", value: "WhatsApp", valueType: "multi_select" }, variablePathValue(vars, "eod.channels"))).toBe(true);
  });
});

describe("qué se puede comparar", () => {
  it("con un reporte: generales, cada canal y las métricas por canal y total", () => {
    const paths = eodVariableSchema([{ id: "f-1", fields: def.fields, channels: def.channels! }]).map((s) => s.path);
    expect(paths).toEqual(expect.arrayContaining(["member.name", "eod.channels", "answer.horas_trabajadas", "channel.instagram.links_enviados", "metrics.total.links_enviados", "metrics.whatsapp.links_enviados"]));
    expect(paths).not.toContain("channel.tiktok.links_enviados");
  });

  it("sin reportes elegidos: lo común a cualquier EOD", () => {
    const paths = eodVariableSchema([]).map((s) => s.path);
    expect(paths).toContain("metrics.total.links_enviados");
    expect(paths.some((p) => p.startsWith("answer."))).toBe(false);
  });
});

describe("cuándo dispara", () => {
  const first = { report_id: "r-1", form_id: "f-1", report_date: "2026-10-12", edit_count: 0 };
  const edit = { ...first, edit_count: 1 };
  it("first: solo el primer envío; every: también cada corrección", () => {
    expect(eodEventMatches({}, first)).toBe(true);
    expect(eodEventMatches({}, edit)).toBe(false);
    expect(eodEventMatches({ on: "every" }, edit)).toBe(true);
  });
  it("solo los reportes elegidos", () => {
    expect(eodEventMatches({ form_ids: ["f-2"] }, first)).toBe(false);
    expect(eodEventMatches({ form_ids: ["f-1"] }, first)).toBe(true);
  });
  it("una clave por envío y por corrección", () => {
    expect(eodDedupeKey(first, "ev")).toBe("eod:r-1:0");
    expect(eodDedupeKey(edit, "ev")).toBe("eod:r-1:1");
    expect(eodDedupeKey({}, "ev")).toBe("event:ev");
    expect(parseEodTriggerConfig({ on: "raro" }).on).toBe("first");
  });
});
