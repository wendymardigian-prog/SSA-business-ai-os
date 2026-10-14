import { describe, expect, it } from "vitest";
import { editedLabel, formCardView, formatNps, whenLabel } from "./form-card";
import type { FormListRow } from "./list";

const NOW = new Date("2026-10-13T18:00:00Z"); // 12:00 en Costa Rica (UTC-6)
const TZ = "America/Costa_Rica";

const ROW = (over: Partial<FormListRow>): FormListRow => ({
  id: "f1",
  name: "Aplicación al Programa X",
  type: "custom",
  status: "published",
  slug: "aplicacion",
  submissions: 128,
  lastSubmissionAt: "2026-10-13T15:41:00Z",
  updatedAt: "2026-10-13T16:30:00Z",
  publicTitle: "Aplicá al Programa X",
  questionCount: 9,
  conversion: 0.106,
  nps: null,
  average: null,
  people: null,
  ...over,
});

const view = (row: FormListRow, maxSubmissions = 1874) => formCardView(row, { now: NOW, timeZone: TZ, maxSubmissions });

describe("whenLabel y editedLabel (en la zona de quien mira)", () => {
  it("hoy, ayer y una fecha, con el mes como en el prototipo", () => {
    expect(whenLabel("2026-10-13T15:41:00Z", NOW, TZ)).toBe("hoy 09:41");
    expect(whenLabel("2026-10-13T00:20:00Z", NOW, TZ)).toBe("ayer 18:20");
    expect(whenLabel("2026-10-05T18:00:00Z", NOW, TZ)).toBe("5 oct");
    expect(whenLabel("2026-09-24T18:00:00Z", NOW, TZ)).toBe("24 sept");
    expect(whenLabel("2025-03-12T18:00:00Z", NOW, TZ)).toBe("12 mar 2025");
    expect(whenLabel("no es fecha", NOW, TZ)).toBe("");
  });

  it("el dia depende de la zona: 00:30 UTC es todavia el dia anterior en Costa Rica", () => {
    expect(whenLabel("2026-10-13T00:30:00Z", NOW, TZ)).toBe("ayer 18:30");
    expect(whenLabel("2026-10-13T00:30:00Z", NOW, "UTC")).toBe("hoy 00:30");
  });

  it("'hace N min', 'hace N h' y despues la fecha", () => {
    expect(editedLabel("2026-10-13T17:59:50Z", NOW, TZ)).toBe("recién");
    expect(editedLabel("2026-10-13T17:30:00Z", NOW, TZ)).toBe("hace 30 min");
    expect(editedLabel("2026-10-13T16:00:00Z", NOW, TZ)).toBe("hace 2 h");
    expect(editedLabel("2026-10-05T18:00:00Z", NOW, TZ)).toBe("5 oct");
  });

  it("el NPS con su signo", () => {
    expect([formatNps(62), formatNps(-10), formatNps(0)]).toEqual(["+62", "-10", "0"]);
  });
});

describe("formCardView por tipo (F6)", () => {
  it("personalizado: respuestas y conversion, link al editor y pie con la ultima respuesta", () => {
    const v = view(ROW({}));
    expect(v).toMatchObject({
      href: "/dashboard/formularios/f1",
      typeLabel: "Personalizado",
      statusLabel: "Publicado",
      publicLine: { kind: "different", title: "Aplicá al Programa X" },
      footerLeft: "9 preguntas · última hoy 09:41",
      footerRight: "Editado hace 1 h",
      archived: false,
    });
    expect(v.stats).toEqual({ kind: "live", big: "128", unit: "respuestas", side: "10,6 % conversión", barPct: 7 });
  });

  it("encuesta con NPS: lleva el NPS al costado, no la conversion", () => {
    const v = view(ROW({ type: "survey", nps: 62, conversion: null, submissions: 46 }));
    expect(v.typeLabel).toBe("Encuesta");
    expect(v.stats).toMatchObject({ kind: "live", unit: "respuestas", side: "NPS +62" });
  });

  it("encuesta con estrellas: el promedio con coma", () => {
    expect(view(ROW({ type: "survey", nps: null, average: 4.5, submissions: 2 })).stats).toMatchObject({ side: "★ 4,5" });
  });

  it("contrato: 'firmas' y conversion", () => {
    const v = view(ROW({ type: "contract", submissions: 12, conversion: 0.632 }));
    expect(v.stats).toMatchObject({ unit: "firmas", side: "63,2 % conversión" });
    expect(view(ROW({ type: "contract", submissions: 1 })).stats).toMatchObject({ unit: "firma" });
  });

  it("fin de dia: 'reportes', las personas, y sin barra", () => {
    const v = view(ROW({ type: "eod", submissions: 84, people: 3, conversion: null }));
    expect(v.typeLabel).toBe("Fin de día");
    expect(v.stats).toEqual({ kind: "live", big: "84", unit: "reportes", side: "3 personas", barPct: null });
    expect(view(ROW({ type: "eod", submissions: 1, people: 1 })).stats).toMatchObject({ unit: "reporte", side: "1 persona" });
  });

  it("lo que la app no calcula no se inventa: sin conversion, sin NPS, sin personas, no hay nada al costado", () => {
    expect(view(ROW({ conversion: null })).stats).toMatchObject({ side: null });
    expect(view(ROW({ type: "survey", nps: null, average: null, conversion: null })).stats).toMatchObject({ side: null });
    expect(view(ROW({ type: "eod", people: null, conversion: null })).stats).toMatchObject({ side: null });
  });
});

describe("formCardView por estado (F6)", () => {
  it("borrador sin respuestas: 'Sin publicar todavía'", () => {
    expect(view(ROW({ status: "draft", submissions: 0, lastSubmissionAt: null, conversion: null })).stats).toEqual({ kind: "none", text: "Sin publicar todavía" });
  });

  it("publicado, pausado o archivado sin respuestas: 'Sin respuestas'", () => {
    for (const status of ["published", "paused", "archived"] as const) {
      expect(view(ROW({ status, submissions: 0, lastSubmissionAt: null })).stats).toEqual({ kind: "none", text: "Sin respuestas" });
    }
  });

  it("archivado: se ve apagado y conserva su numero", () => {
    const v = view(ROW({ status: "archived", submissions: 1874, conversion: 0.203 }));
    expect(v.archived).toBe(true);
    expect(v.statusLabel).toBe("Archivado");
    expect(v.stats).toMatchObject({ big: "1.874", barPct: 100 });
  });

  it("pausado", () => {
    expect(view(ROW({ status: "paused" })).statusLabel).toBe("Pausado");
  });

  it("un borrador con respuestas (restaurado) muestra su numero: es real", () => {
    expect(view(ROW({ status: "draft", submissions: 5 })).stats).toMatchObject({ kind: "live", big: "5" });
  });
});

describe("el titulo publico y el pie (F6)", () => {
  it("si el titulo publico es igual al nombre interno, o no hay, se dice que es el mismo", () => {
    expect(view(ROW({ name: "Bienvenida", publicTitle: "Bienvenida" })).publicLine).toEqual({ kind: "same", text: "El título público es el mismo" });
    expect(view(ROW({ publicTitle: null })).publicLine).toEqual({ kind: "same", text: "El título público es el mismo" });
  });

  it("singular de 'pregunta' y pie sin ultima respuesta", () => {
    const v = view(ROW({ questionCount: 1, lastSubmissionAt: null, submissions: 0 }));
    expect(v.footerLeft).toBe("1 pregunta");
    expect(view(ROW({ questionCount: 0, lastSubmissionAt: null })).footerLeft).toBe("0 preguntas");
  });

  it("la barra compara con el formulario que mas respuestas tiene (minimo visible 2 %)", () => {
    expect(formCardView(ROW({ submissions: 1 }), { now: NOW, timeZone: TZ, maxSubmissions: 1000 }).stats).toMatchObject({ barPct: 2 });
    expect(formCardView(ROW({ submissions: 500 }), { now: NOW, timeZone: TZ, maxSubmissions: 1000 }).stats).toMatchObject({ barPct: 50 });
  });
});
