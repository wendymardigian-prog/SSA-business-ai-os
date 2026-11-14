// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./challenge.cases.json";
import { certificateTemplatePick, challengeWeeks, latePlan, recurrenceWindow, startByDate, type LateConfig, type WeekInput, type WindowAnchors } from "./challenge";

describe("desde y hasta cuándo se repite (casos compartidos con la base)", () => {
  for (const c of cases.window) it(c.name, () => expect(recurrenceWindow(c.recurrence as Record<string, unknown>, c.anchors as WindowAnchors)).toEqual(c.expected));
});
describe("si una repetición se puede cargar ahora (casos compartidos con la base)", () => {
  for (const c of cases.late) it(c.name, () => expect(latePlan(c.late as LateConfig | null, c.occursOn, c.dueOn, c.now)).toEqual(c.expected));
});
describe("el control semanal (casos compartidos con la base)", () => {
  for (const c of cases.weeks) it(c.name, () => expect(challengeWeeks(c.input as WeekInput)).toEqual(c.expected));
});
describe("la fecha límite para empezar (casos compartidos con la base)", () => {
  for (const c of cases.startBy) it(c.name, () => expect(startByDate(c.startBy, c.serviceStart, c.serviceCreated)).toBe(c.expected));
});
describe("la plantilla del certificado según si llegó a tiempo", () => {
  const ref = { templates: [{ if: "on_time", item_key: "it_finala", template_id: "excelencia" }, { else: true, template_id: "comun" }] };
  it("a tiempo", () => expect(certificateTemplatePick(ref, { it_finala: true })).toBe("excelencia"));
  it("tarde o sin completar", () => {
    expect(certificateTemplatePick(ref, { it_finala: false })).toBe("comun");
    expect(certificateTemplatePick(ref, {})).toBe("comun");
  });
  it("sin plantillas por condición, la de siempre", () => expect(certificateTemplatePick({ template_id: "una" }, {})).toBe("una"));
});
